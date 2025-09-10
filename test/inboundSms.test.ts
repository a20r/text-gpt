import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import { buildServer } from '../src/index';
import { redis } from '../src/adapters/redis';
import { createHmac } from 'crypto';

vi.mock('../src/adapters/openai', () => ({
  chatCompletion: vi.fn().mockResolvedValue('hello from bot')
}));
import { chatCompletion } from '../src/adapters/openai';

function sign(url: string, params: Record<string, string>): string {
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  return createHmac('sha1', token).update(data).digest('base64');
}

describe('inbound sms', () => {
  let server: any;
  beforeAll(async () => {
    process.env.TWILIO_AUTH_TOKEN = 'testtoken';
    process.env.PUBLIC_BASE_URL = 'https://example.com';
    server = await buildServer();
    await server.ready();
  });
  afterAll(async () => {
    await server.close();
  });

  beforeEach(() => {
    (redis as any).store?.clear?.();
  });

  it('rejects invalid signature', async () => {
    const params = { MessageSid: '1', From: '+10000000000', To: '+1', Body: 'hi', NumMedia: '0' };
    const res = await request(server.server)
      .post('/twilio/inbound-sms')
      .set('X-Twilio-Signature', 'bad')
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(params).toString());
    expect(res.status).toBe(403);
  });

  it('/new rotates chat', async () => {
    (chatCompletion as any).mockClear();
    const baseUrl = 'https://example.com/twilio/inbound-sms';
    const params1 = { MessageSid: '2', From: '+12223334444', To: '+1', Body: 'hello', NumMedia: '0' };
    const sig1 = sign(baseUrl, params1);
    await request(server.server).post('/twilio/inbound-sms').set('X-Twilio-Signature', sig1).set('Content-Type', 'application/x-www-form-urlencoded').send(new URLSearchParams(params1).toString());
    const chatId1 = await redis.get(`user:${params1.From}:currentChatId`);
    expect(chatCompletion).toHaveBeenCalledTimes(1);

    const params2 = { MessageSid: '3', From: params1.From, To: '+1', Body: '/new', NumMedia: '0' };
    const sig2 = sign(baseUrl, params2);
    const res2 = await request(server.server).post('/twilio/inbound-sms').set('X-Twilio-Signature', sig2).set('Content-Type', 'application/x-www-form-urlencoded').send(new URLSearchParams(params2).toString());
    expect(res2.text).toContain('New chat started');
    expect(chatCompletion).toHaveBeenCalledTimes(1); // no new call

    const params3 = { MessageSid: '4', From: params1.From, To: '+1', Body: 'again', NumMedia: '0' };
    const sig3 = sign(baseUrl, params3);
    await request(server.server).post('/twilio/inbound-sms').set('X-Twilio-Signature', sig3).set('Content-Type', 'application/x-www-form-urlencoded').send(new URLSearchParams(params3).toString());
    const chatId2 = await redis.get(`user:${params1.From}:currentChatId`);
    expect(chatId2 && chatId1 && chatId2 !== chatId1).toBe(true);
    expect(chatCompletion).toHaveBeenCalledTimes(2);
  });

  it('dedupes MessageSid', async () => {
    (chatCompletion as any).mockClear();
    const baseUrl = 'https://example.com/twilio/inbound-sms';
    const params = { MessageSid: '5', From: '+13334445555', To: '+1', Body: 'test', NumMedia: '0' };
    const sig = sign(baseUrl, params);
    await request(server.server).post('/twilio/inbound-sms').set('X-Twilio-Signature', sig).set('Content-Type', 'application/x-www-form-urlencoded').send(new URLSearchParams(params).toString());
    await request(server.server).post('/twilio/inbound-sms').set('X-Twilio-Signature', sig).set('Content-Type', 'application/x-www-form-urlencoded').send(new URLSearchParams(params).toString());
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('handles STOP and START opt-out flow', async () => {
    (chatCompletion as any).mockClear();
    const baseUrl = 'https://example.com/twilio/inbound-sms';
    const from = '+14445556666';

    const stopParams = { MessageSid: '6', From: from, To: '+1', Body: 'STOP', NumMedia: '0' };
    const stopSig = sign(baseUrl, stopParams);
    const stopRes = await request(server.server)
      .post('/twilio/inbound-sms')
      .set('X-Twilio-Signature', stopSig)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(stopParams).toString());
    expect(stopRes.text).toContain('opted out');

    const msgParams = { MessageSid: '7', From: from, To: '+1', Body: 'hello', NumMedia: '0' };
    const msgSig = sign(baseUrl, msgParams);
    const msgRes = await request(server.server)
      .post('/twilio/inbound-sms')
      .set('X-Twilio-Signature', msgSig)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(msgParams).toString());
    expect(msgRes.text).toBe('<Response></Response>');
    expect(chatCompletion).not.toHaveBeenCalled();

    const startParams = { MessageSid: '8', From: from, To: '+1', Body: 'START', NumMedia: '0' };
    const startSig = sign(baseUrl, startParams);
    const startRes = await request(server.server)
      .post('/twilio/inbound-sms')
      .set('X-Twilio-Signature', startSig)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(startParams).toString());
    expect(startRes.text).toContain('opted back in');

    const afterParams = { MessageSid: '9', From: from, To: '+1', Body: 'hi again', NumMedia: '0' };
    const afterSig = sign(baseUrl, afterParams);
    await request(server.server)
      .post('/twilio/inbound-sms')
      .set('X-Twilio-Signature', afterSig)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(afterParams).toString());
    expect(chatCompletion).toHaveBeenCalledTimes(1);
  });

  it('rate limits excessive messages', async () => {
    (chatCompletion as any).mockClear();
    const baseUrl = 'https://example.com/twilio/inbound-sms';
    const from = '+15556667777';

    for (let i = 0; i < 3; i++) {
      const params = { MessageSid: String(10 + i), From: from, To: '+1', Body: 'ping', NumMedia: '0' };
      const sig = sign(baseUrl, params);
      await request(server.server)
        .post('/twilio/inbound-sms')
        .set('X-Twilio-Signature', sig)
        .set('Content-Type', 'application/x-www-form-urlencoded')
        .send(new URLSearchParams(params).toString());
    }
    expect(chatCompletion).toHaveBeenCalledTimes(3);

    const params4 = { MessageSid: '13', From: from, To: '+1', Body: 'ping', NumMedia: '0' };
    const sig4 = sign(baseUrl, params4);
    const res4 = await request(server.server)
      .post('/twilio/inbound-sms')
      .set('X-Twilio-Signature', sig4)
      .set('Content-Type', 'application/x-www-form-urlencoded')
      .send(new URLSearchParams(params4).toString());
    expect(res4.text).toContain('Slow down');
    expect(chatCompletion).toHaveBeenCalledTimes(3);
  });
});
