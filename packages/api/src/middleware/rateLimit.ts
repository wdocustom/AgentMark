import { Request, Response, NextFunction } from 'express';
import { checkRateLimit } from '../db/redis.js';
import type { AuthRequest } from './auth.js';

interface RateLimitOptions {
  windowMs: number;
  max: number;
  keyPrefix?: string;
}

export function rateLimit(options: RateLimitOptions) {
  const { windowMs, max, keyPrefix = 'rl' } = options;
  const windowSeconds = Math.ceil(windowMs / 1000);

  return async (req: Request, res: Response, next: NextFunction): Promise<void> => {
    const authReq = req as AuthRequest;
    const identifier = authReq.auth?.userId || req.ip || 'anonymous';
    const key = `${keyPrefix}:${identifier}`;

    try {
      const result = await checkRateLimit(key, max, windowSeconds);

      res.setHeader('X-RateLimit-Limit', max);
      res.setHeader('X-RateLimit-Remaining', result.remaining);
      res.setHeader('X-RateLimit-Reset', result.resetAt);

      if (!result.allowed) {
        res.status(429).json({
          success: false,
          error: { code: 'RATE_LIMITED', message: 'Too many requests' },
        });
        return;
      }

      next();
    } catch {
      // If Redis is down, allow the request through
      next();
    }
  };
}
