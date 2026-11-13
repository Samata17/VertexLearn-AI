/**
 * Health endpoints (PRD 6 "health-check endpoints per service", PRD 13 monitoring).
 *
 *   GET /health/live   liveness  — the process is up and answering. Never touches dependencies,
 *                                   so a database blip doesn't make Docker/Kubernetes restart the API.
 *   GET /health        readiness — can this instance serve traffic?
 *   GET /health/ready  (same)
 *
 * Readiness rules:
 *   - database + redis are REQUIRED  → if either is down: HTTP 503, status "down"
 *   - object storage + AI service are OPTIONAL → if down: HTTP 200, status "degraded"
 *     (PRD 14.4: a slow/broken AI service must not take the core LMS offline)
 * Every check has a short timeout so the health endpoint itself can never hang.
 */
import { HeadBucketCommand } from '@aws-sdk/client-s3';
import type { Request, Response } from 'express';
import { env } from './config/env.js';
import { redis } from './config/redis.js';
import { pool } from './db/pool.js';
import { s3 } from './lib/storage.js';

const TIMEOUT_MS = 2000;
const startedAt = Date.now();

function withTimeout<T>(p: Promise<T>, ms = TIMEOUT_MS): Promise<T> {
  return Promise.race([p, new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms))]);
}

async function check(fn: () => Promise<unknown>): Promise<boolean> {
  try {
    await withTimeout(fn());
    return true;
  } catch {
    return false;
  }
}

export function liveness(_req: Request, res: Response) {
  res.json({ status: 'ok', service: 'backend', version: env.APP_VERSION });
}

export async function readiness(_req: Request, res: Response) {
  const [database, redisOk, storage, aiService] = await Promise.all([
    check(() => pool.query('SELECT 1')),
    check(async () => {
      if ((await redis.ping()) !== 'PONG') throw new Error('bad ping');
    }),
    check(() => s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }))),
    check(async () => {
      const r = await fetch(`${env.AI_SERVICE_URL}/health`, { signal: AbortSignal.timeout(TIMEOUT_MS) });
      if (!r.ok) throw new Error(`AI service ${r.status}`);
    }),
  ]);
  const ready = database && redisOk;
  const status = !ready ? 'down' : storage && aiService ? 'ok' : 'degraded';
  res.status(ready ? 200 : 503).json({
    status,
    service: 'backend',
    version: env.APP_VERSION,
    uptime_s: Math.round((Date.now() - startedAt) / 1000),
    checks: { database, redis: redisOk, storage, ai_service: aiService },
    // Kept for backward compatibility with older monitors that read these top-level fields.
    database,
    redis: redisOk,
    time: new Date().toISOString(),
  });
}
