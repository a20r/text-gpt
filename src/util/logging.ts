import pino from 'pino';
import { createHash } from 'crypto';

function hashLast4(phone: string): string {
  const last4 = phone.slice(-4);
  return createHash('sha256').update(last4).digest('hex').slice(0, 8);
}

export const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: ['req.headers.authorization', 'OPENAI_API_KEY', 'TWILIO_AUTH_TOKEN'],
  formatters: {
    bindings(bindings) {
      return { pid: bindings.pid, host: bindings.hostname };
    },
  },
});

export function userHash(phone: string): string {
  return hashLast4(phone);
}
