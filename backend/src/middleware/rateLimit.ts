import type { Request } from 'express';
import rateLimit from 'express-rate-limit';
import { RedisStore } from 'rate-limit-redis';
import { redis } from '../config/redis.js';
import { env } from '../config/env.js';

/**
 * PRD 8.9 rate limits. Counters live in Redis so limits hold across multiple backend instances.
 *   /auth/*     10 req / min / IP
 *   /ai/chat/*  20 req / min / user
 *   other auth'd endpoints 100 req / min / user
 */
const store = (prefix: string) =>
  new RedisStore({
    prefix: `rl:${prefix}:`,
    // ioredis "call" signature expected by rate-limit-redis
    sendCommand: (command: string, ...args: string[]) => redis.call(command, ...args) as any,
  });

const message = (what: string) => ({
  error: { code: 'RATE_LIMITED', message: `Too many ${what} requests. Please wait a minute and try again.` },
});

const userOrIp = (req: Request) => (req.user?.id ? `u:${req.user.id}` : `ip:${req.ip ?? 'unknown'}`);
const skip = () => env.NODE_ENV === 'test';

/** Credential endpoints (login, register, forgot/reset password): PRD 8.9, 10/min/IP — brute-force protection. */
export const authLimiter = rateLimit({
  windowMs: 60_000,
  limit: env.AUTH_RATE_LIMIT,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: store('auth'),
  message: message('sign-in'),
  skip,
});

/**
 * Session endpoints (refresh, logout, me) are also under /auth but carry no password, and a user with
 * several tabs open refreshes often — so they get a looser 60/min/IP limit instead of 10.
 */
export const sessionLimiter = rateLimit({
  windowMs: 60_000,
  limit: 60,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  store: store('session'),
  message: message('session'),
  skip,
});

export const aiChatLimiter = rateLimit({
  windowMs: 60_000,
  limit: 20,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  store: store('ai'),
  message: message('AI tutor'),
  skip,
});

export const apiLimiter = rateLimit({
  windowMs: 60_000,
  limit: 100,
  standardHeaders: 'draft-7',
  legacyHeaders: false,
  keyGenerator: userOrIp,
  store: store('api'),
  message: message('API'),
  skip,
});
