import Redis from 'ioredis';
import { logger } from '../util/logging';

class MemoryRedis {
  store = new Map<string, string>();
  async get(key: string) { return this.store.get(key) ?? null; }
  async set(key: string, value: string) { this.store.set(key, value); return 'OK'; }
  async setnx(key: string, value: string) { if (!this.store.has(key)) { this.store.set(key, value); return 1; } return 0; }
  async expire(key: string, _seconds: number) { return 1; }
  async del(key: string) { return this.store.delete(key) ? 1 : 0; }
  async incr(key: string) { const val = Number(this.store.get(key) || '0') + 1; this.store.set(key, String(val)); return val; }
}

let client: any;
if (process.env.REDIS_URL) {
  client = new Redis(process.env.REDIS_URL);
  client.on('error', (err: any) => logger.error({ err }, 'redis error'));
} else {
  logger.warn('REDIS_URL not set, using in-memory store (not for prod)');
  client = new MemoryRedis();
}

export const redis: any = client;
