import Fastify from 'fastify';
import formbody from '@fastify/formbody';
import { inboundSmsRoute } from './routes/inboundSms';
import { longReplyRoute } from './routes/longReply';
import { healthRoute } from './routes/health';
import { logger } from './util/logging';

const port = Number(process.env.PORT) || 8080;

export async function buildServer() {
  const fastify: any = Fastify({ logger: logger as any });
  await fastify.register(formbody);
  await inboundSmsRoute(fastify as any);
  await longReplyRoute(fastify as any);
  await healthRoute(fastify as any);
  return fastify;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildServer().then(f => {
    f.listen({ port, host: '0.0.0.0' }).catch((err: any) => {
      f.log.error(err);
      process.exit(1);
    });
  });
}
