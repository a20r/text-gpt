import OpenAI from 'openai';
import { logger } from '../util/logging';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function chatCompletion(messages: ChatMessage[]): Promise<string> {
  const model = process.env.OPENAI_CHAT_MODEL || 'gpt-4o-mini';
  try {
    const res = await client.chat.completions.create({
      model,
      messages,
      temperature: Number(process.env.OPENAI_TEMPERATURE) || 0.3,
      max_tokens: Number(process.env.OPENAI_MAX_TOKENS) || 1024,
    });
    return res.choices[0]?.message?.content?.trim() ?? '';
  } catch (err) {
    logger.error({ err }, 'openai error');
    throw err;
  }
}

export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4); // rough
}
