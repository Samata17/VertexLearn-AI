import type { NextFunction, Request, Response } from 'express';
import { ZodError, type ZodTypeAny } from 'zod';
import { badRequest } from '../utils/errors.js';

/**
 * Validates req.body / req.query against a zod schema and replaces it with the parsed
 * (typed, trimmed, coerced) value. Unknown fields are stripped.
 */
export function validate(schema: ZodTypeAny, source: 'body' | 'query' = 'body') {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const parsed = schema.parse(req[source]);
      if (source === 'body') req.body = parsed;
      else Object.assign(req.query, parsed);
      next();
    } catch (err) {
      if (err instanceof ZodError) {
        const issue = err.issues[0];
        const field = issue.path.join('.') || undefined;
        return next(badRequest(field ? `${field}: ${issue.message}` : issue.message, field));
      }
      next(err);
    }
  };
}
