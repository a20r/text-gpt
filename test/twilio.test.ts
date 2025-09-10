import { describe, it, expect, beforeEach } from 'vitest';
import { chunkSms } from '../src/adapters/twilio';
import { redis } from '../src/adapters/redis';

function clearRedis() {
  (redis as any).store?.clear?.();
}

describe('chunkSms', () => {
  beforeEach(() => clearRedis());

  it('splits GSM-7 text into segments with prefixes', async () => {
    const text = 'a'.repeat(200); // exceeds single segment
    const res = await chunkSms(text, 6);
    expect(res.segments.length).toBe(2);
    expect(res.segments[0].startsWith('(1/2) ')).toBe(true);
  });

  it('stores overflow when exceeding max segments', async () => {
    const text = 'a'.repeat(1000); // enough for >6 segments
    const res = await chunkSms(text, 6);
    expect(res.segments.length).toBe(1);
    expect(res.segments[0]).toContain('Reply truncated');
    expect(res.overflowId).toBeTruthy();
    const stored = await redis.get(`longreply:${res.overflowId}`);
    expect(stored).toBe(text);
  });
});
