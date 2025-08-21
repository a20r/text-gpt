import { FastifyInstance } from 'fastify';
import { verifySignature, buildTwiML, chunkSms } from '../adapters/twilio';
import { parseCommand } from '../core/commands';
import { chatCompletion } from '../adapters/openai';
import { appendMessage, createChat, getCurrentChatId, getWindowedMessages, rotateChat } from '../core/chat';
import { redis } from '../adapters/redis';
import { userHash, logger } from '../util/logging';

export async function inboundSmsRoute(fastify: FastifyInstance) {
  fastify.post('/twilio/inbound-sms', async (req, reply) => {
    const params = req.body as any as Record<string, string>;
    const signature = (req.headers['x-twilio-signature'] as string) || '';
    const url = `${process.env.PUBLIC_BASE_URL}${req.raw.url}`;
    if (!verifySignature(url, params, signature)) {
      return reply.code(403).send('Invalid signature');
    }

    const messageSid = params['MessageSid'];
    const from = params['From'];
    const to = params['To'];
    const body = params['Body'] || '';
    const numMedia = Number(params['NumMedia'] || 0);

    // idempotency
    const idemKey = `sms:idempotency:${messageSid}`;
    if (await redis.setnx(idemKey, '1') === 0) {
      return reply.type('text/xml').send(buildTwiML([]));
    }
    await redis.expire(idemKey, 60 * 60 * 24);

    const cmd = parseCommand(body);
    const optKey = `user:${from}:optedOut`;

    if (cmd === 'STOP') {
      await redis.set(optKey, '1');
      return reply.type('text/xml').send(buildTwiML(['You have been opted out. Reply START to resume.']));
    }
    if (cmd === 'START') {
      await redis.del(optKey);
      return reply.type('text/xml').send(buildTwiML(['You have been opted back in.']));
    }
    const opted = (await redis.get(optKey)) === '1';
    if (opted) {
      return reply.type('text/xml').send(buildTwiML([]));
    }

    if (cmd === 'HELP') {
      return reply.type('text/xml').send(buildTwiML(['Send a message to talk with the assistant.\nSend /new to start a fresh chat. Send STOP to opt out.']));
    }

    if (cmd === 'NEW') {
      await rotateChat(from);
      return reply.type('text/xml').send(buildTwiML(["New chat started. Your previous context won't be used going forward."]));
    }

    if (numMedia > 0) {
      return reply.type('text/xml').send(buildTwiML(["I can't process media yet—please send text only."]));
    }

    const trimmed = body.trim();
    if (!trimmed) {
      return reply.type('text/xml').send(buildTwiML(['Send a message to talk with the assistant.\nSend /new to start a fresh chat. Send STOP to opt out.']));
    }

    // rate limiting
    const rlKey = `ratelimit:${from}`;
    const count = await redis.incr(rlKey);
    await redis.expire(rlKey, 2);
    if (count > 3) {
      return reply.type('text/xml').send(buildTwiML(['Slow down—try again shortly.']));
    }

    let chatId = await getCurrentChatId(from);
    if (!chatId) chatId = await createChat(from);

    await appendMessage(chatId, { role: 'user', content: trimmed, createdAt: new Date().toISOString() });

    let replyText: string;
    try {
      const history = await getWindowedMessages(chatId, Number(process.env.CONTEXT_MAX_TURNS) || 24);
      history.push({ role: 'user', content: trimmed });
      replyText = await chatCompletion(history);
    } catch (err) {
      logger.error({ err }, 'openai call failed');
      replyText = 'Temporary error reaching assistant. Try again.';
    }

    await appendMessage(chatId, { role: 'assistant', content: replyText, createdAt: new Date().toISOString() });

    const chunks = await chunkSms(replyText, Number(process.env.REPLY_MAX_SEGMENTS) || 6);
    const twiml = buildTwiML(chunks.segments);
    return reply.type('text/xml').send(twiml);
  });
}
