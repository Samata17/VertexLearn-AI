/**
 * HTTP client for the internal Python AI service.
 * The browser never talks to the AI service directly: the backend authenticates the user,
 * checks permissions, then calls the AI service with a shared internal key.
 * Google Cloud credentials for Vertex AI live only in the AI service's container.
 * The AI service finishes (or gives up on) its own retries within VERTEX_TOTAL_TIMEOUT_SECONDS (default 100 s),
 * inside this 120 s timeout.
 */
import { env } from '../../config/env.js';
import { AppError } from '../../utils/errors.js';
import { logger } from '../../utils/logger.js';

export async function callAI<T = any>(path: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(`${env.AI_SERVICE_URL}${path}`, {
      method: body === undefined ? 'GET' : 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Internal-Key': env.AI_SERVICE_KEY },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
    });
    const data = (await res.json().catch(() => ({}))) as any;
    if (!res.ok) {
      const detail = typeof data?.detail === 'string' ? data.detail : 'The AI service could not complete this request';
      const status = res.status === 422 || res.status === 413 ? 422 : 502;
      throw new AppError(status, 'AI_ERROR', detail);
    }
    return data as T;
  } catch (err) {
    if (err instanceof AppError) throw err;
    logger.warn('AI service unreachable', { path, error: (err as Error).message });
    throw new AppError(503, 'AI_UNAVAILABLE', 'The AI tutor is temporarily unavailable. Please try again shortly.');
  } finally {
    clearTimeout(timer);
  }
}
