import { Redis } from 'ioredis';
import { env } from './env.js';
import { logger } from '../utils/logger.js';

/** Shared Redis connection for caching and rate limiting. BullMQ creates its own connections. */
export const redis = new Redis(env.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
redis.on('error', (err) => logger.warn('Redis error', { error: err.message }));

/** Read-through cache helper: return cached JSON if present, otherwise compute, store with TTL, return. */
/** Read-through cache. `shouldCache` can veto storing a value (e.g. a demo-mode fallback during an AI outage). */
export async function cached<T>(
  key: string,
  ttlSeconds: number,
  compute: () => Promise<T>,
  shouldCache: (value: T) => boolean = () => true,
): Promise<T> {
  try {
    const hit = await redis.get(key);
    if (hit) return JSON.parse(hit) as T;
  } catch {
    /* cache is optional — fall through to the database */
  }
  const value = await compute();
  if (!shouldCache(value)) return value;
  try {
    await redis.set(key, JSON.stringify(value), 'EX', ttlSeconds);
  } catch {
    /* ignore */
  }
  return value;
}

/** Delete every key matching a prefix (used to invalidate catalog caches after course changes). */
export async function invalidatePrefix(prefix: string) {
  try {
    let cursor = '0';
    do {
      const [next, keys] = await redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
      cursor = next;
      if (keys.length) await redis.del(...keys);
    } while (cursor !== '0');
  } catch {
    /* ignore */
  }
}
