import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
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
});
