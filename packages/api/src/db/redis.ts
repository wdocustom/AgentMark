import Redis from 'ioredis';
import { logger } from '../utils/logger.js';

let _redis: Redis | null = null;

function getRedis(): Redis | null {
  if (_redis) return _redis;

  // Skip Redis in serverless environments without explicit config
  if (process.env.VERCEL && !process.env.REDIS_URL && !process.env.REDIS_HOST) {
    return null;
  }

  if (process.env.REDIS_URL) {
    _redis = new Redis(process.env.REDIS_URL, {
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  } else {
    _redis = new Redis({
      host: process.env.REDIS_HOST || 'localhost',
      port: parseInt(process.env.REDIS_PORT || '6379'),
      password: process.env.REDIS_PASSWORD || undefined,
      maxRetriesPerRequest: 1,
      lazyConnect: true,
    });
  }

  _redis.on('error', (err) => {
    logger.error({ err }, 'Redis connection error');
  });

  _redis.on('connect', () => {
    logger.info('Redis connected');
  });

  return _redis;
}

// Simple cache helpers
export async function cacheGet<T>(key: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  const data = await r.get(key);
  if (!data) return null;
  return JSON.parse(data) as T;
}

export async function cacheSet(
  key: string,
  value: unknown,
  ttlSeconds: number = 300
): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.set(key, JSON.stringify(value), 'EX', ttlSeconds);
}

export async function cacheDel(key: string): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.del(key);
}

// Rate limiting
export async function checkRateLimit(
  key: string,
  limit: number,
  windowSeconds: number
): Promise<{ allowed: boolean; remaining: number; resetAt: number }> {
  const r = getRedis();
  if (!r) {
    // No Redis — allow all requests
    return { allowed: true, remaining: limit, resetAt: Date.now() + windowSeconds * 1000 };
  }
  const current = await r.incr(key);
  if (current === 1) {
    await r.expire(key, windowSeconds);
  }
  const ttl = await r.ttl(key);
  return {
    allowed: current <= limit,
    remaining: Math.max(0, limit - current),
    resetAt: Date.now() + ttl * 1000,
  };
}

// Task queue using Redis lists
export async function enqueue(queue: string, task: unknown): Promise<void> {
  const r = getRedis();
  if (!r) return;
  await r.lpush(`queue:${queue}`, JSON.stringify(task));
}

export async function dequeue<T>(queue: string): Promise<T | null> {
  const r = getRedis();
  if (!r) return null;
  const data = await r.rpop(`queue:${queue}`);
  if (!data) return null;
  return JSON.parse(data) as T;
}

export async function queueLength(queue: string): Promise<number> {
  const r = getRedis();
  if (!r) return 0;
  return r.llen(`queue:${queue}`);
}

// Pub/sub for real-time events
export function createSubscriber(): Redis | null {
  const r = getRedis();
  if (!r) return null;
  return r.duplicate();
}
