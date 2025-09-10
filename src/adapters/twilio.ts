import { createHmac } from 'crypto';
import { newId } from '../util/ids';
import { redis } from './redis';

const GSM7_REGEX = /^[\x00-\x7F]*$/;

export function isGsm7(text: string): boolean {
  return GSM7_REGEX.test(text);
}

export function verifySignature(url: string, params: Record<string, string>, signature: string): boolean {
  const token = process.env.TWILIO_AUTH_TOKEN || '';
  const data = url + Object.keys(params).sort().map(k => k + params[k]).join('');
  const expected = createHmac('sha1', token).update(data).digest('base64');
  return expected === signature;
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;','"':'&quot;',"'":"&apos;"}[c]!));
}

export function buildTwiML(messages: string[]): string {
  const body = messages.map(m => `<Message>${escapeXml(m)}</Message>`).join('');
  return `<Response>${body}</Response>`;
}

export interface ChunkResult { segments: string[]; overflowId?: string }

export async function chunkSms(text: string, maxSegments: number): Promise<ChunkResult> {
  const isGsm = isGsm7(text);
  const segSize = isGsm ? 153 : 67;
  // iterative calculation including prefix
  let total = Math.ceil(text.length / segSize);
  if (total === 0) total = 1;
  while (true) {
    const prefixLen = total > 1 ? `(${total}/${total}) `.length : 0;
    const realSize = segSize - prefixLen;
    const newTotal = Math.ceil(text.length / realSize);
    if (newTotal === total) break;
    total = newTotal;
  }
  const prefixLen = total > 1 ? `(${total}/${total}) `.length : 0;
  const realSize = segSize - prefixLen;
  const segments: string[] = [];
  for (let i = 0; i < total; i++) {
    const part = text.slice(i * realSize, (i + 1) * realSize);
    if (!part) break;
    const prefix = total > 1 ? `(${i + 1}/${total}) ` : '';
    segments.push(prefix + part);
  }
  if (segments.length > maxSegments) {
    const overflowText = text;
    const id = newId();
    await redis.set(`longreply:${id}`, overflowText);
    await redis.expire(`longreply:${id}`, 600); // 10min
    return { segments: [`Reply truncated (too long). Full reply: ${process.env.PUBLIC_BASE_URL}/m/${id}\nTip: Ask more specific questions. Send /new to start fresh.`], overflowId: id };
  }
  return { segments };
}
