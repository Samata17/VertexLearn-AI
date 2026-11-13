import type { NextFunction, Request, RequestHandler, Response } from 'express';

/** Wraps async route handlers so thrown errors reach the error middleware (Express 4 doesn't do this itself). */
export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) => {
    fn(req, res, next).catch(next);
  };

/** Reads ?page & ?limit with safe bounds. */
export function pagination(q: Record<string, unknown>, defaultLimit = 12) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || defaultLimit));
  return { page, limit, offset: (page - 1) * limit };
}
