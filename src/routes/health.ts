import { FastifyInstance } from 'fastify';
import { redis } from '../adapters/redis';
import OpenAI from 'openai';

export async function healthRoute(fastify: FastifyInstance) {
  fastify.get('/healthz', async (_req, reply) => {
    const res: any = { ok: true };
    try {
      await redis.get('healthz');
      res.redis = 'ok';
    } catch (err) {
      res.redis = 'down';
    }
    try {
      const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
      await client.models.list();
      res.openai = 'ok';
    } catch (err) {
      res.openai = 'down';
    }
    return reply.send(res);
  });
}
