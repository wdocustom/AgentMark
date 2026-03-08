import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

export const redis = new Redis({
  host: process.env.REDIS_HOST || 'localhost',
  port: parseInt(process.env.REDIS_PORT || '6379'),
  password: process.env.REDIS_PASSWORD || undefined,
  maxRetriesPerRequest: 3,
  retryStrategy(times) {
    const delay = Math.min(times * 200, 5000);
    return delay;
  },
});

redis.on('error', (err) => {
  logger.error({ err }, 'Redis connection error');
});

redis.on('connect', () => {
  logger.info('Redis connected');
});

// Simple cache helpers
export async function cacheGet<T>(key: string): Promise<T | null> {
  const data = await redis.get(key);
  if (!data) return null;
  return JSON.parse(data) as T;
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = 300
): Promise<void> {
  await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  await redis.del(key);
}

// Rate limiting
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const current = await redis.incr(key);
  if (current === 1) {
    await redis.expire(key, windowSeconds);
  }
  const ttl = await redis.ttl(key);
  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt: Date.now() + ttl * 1000,
  };
}

// Task queue using Redis lists
export async function enqueue(queue: string, task: unknown): Promise<void> {
  await redis.lpush(`queue:${queue}`, JSON.stringify(task));
}

export async function dequeue<T>(queue: string): Promise<T | null> {
  const data = await redis.rpop(`queue:${queue}`);
  if (!data) return null;
  return JSON.parse(data) as T;
}

export async function queueLength(queue: string): Promise<number> {
  return redis.llen(`queue:${queue}`);
}

// Pub/sub for real-time events
export function createSubscriber(): Redis {
  return redis.duplicate();
}
