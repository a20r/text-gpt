import { FastifyInstance } from 'fastify';
import { redis } from '../adapters/redis';

export async function longReplyRoute(fastify: FastifyInstance) {
  fastify.get('/m/:id', async (req, reply) => {
    const id = (req.params as any).id;
    const key = `longreply:${id}`;
    const text = await redis.get(key);
    if (!text) {
      return reply.code(404).send('Not found');
    }
    reply.header('Content-Type', 'text/plain; charset=utf-8');
    return reply.send(text);
  });
}
