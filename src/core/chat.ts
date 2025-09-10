import { redis } from '../adapters/redis';
import { newId } from '../util/ids';
import type { ChatMessage } from '../adapters/openai';

export interface StoredMessage extends ChatMessage {
  createdAt: string;
}

export async function getCurrentChatId(userId: string): Promise<string | null> {
  return await redis.get(`user:${userId}:currentChatId`);
}

export async function createChat(userId: string): Promise<string> {
  const chatId = newId();
  await redis.set(`user:${userId}:currentChatId`, chatId);
  const meta = { chatId, userId, createdAt: new Date().toISOString(), isCurrent: true };
  await redis.set(`chat:${chatId}:meta`, JSON.stringify(meta));
  await redis.set(`chat:${chatId}:messages`, JSON.stringify([]));
  return chatId;
}

export async function rotateChat(userId: string): Promise<string> {
  return createChat(userId);
}

export async function appendMessage(chatId: string, msg: StoredMessage): Promise<void> {
  const key = `chat:${chatId}:messages`;
  const raw = await redis.get(key);
  const arr: StoredMessage[] = raw ? JSON.parse(raw) : [];
  arr.push(msg);
  await redis.set(key, JSON.stringify(arr));
}

export async function getWindowedMessages(chatId: string, turns: number): Promise<ChatMessage[]> {
  const key = `chat:${chatId}:messages`;
  const raw = await redis.get(key);
  const arr: StoredMessage[] = raw ? JSON.parse(raw) : [];
  return arr.slice(-turns * 2);
}
