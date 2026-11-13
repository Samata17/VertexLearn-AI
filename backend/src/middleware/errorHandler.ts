import type { NextFunction, Request, Response } from 'express';
import multer from 'multer';
import { AppError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

/** Converts every error into the PRD 8.8 error format. Internal details are never sent to clients. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, _next: NextFunction) {
  if (err instanceof AppError) {
    return res.status(err.status).json({ error: { code: err.code, message: err.message, field: err.field } });
  }
  if (err instanceof multer.MulterError) {
    const msg = err.code === 'LIMIT_FILE_SIZE' ? 'File is too large' : err.message;
    return res.status(400).json({ error: { code: 'UPLOAD_ERROR', message: msg, field: err.field } });
  }
  const pgErr = err as { code?: string; detail?: string };
  if (pgErr.code === '23505') {
    return res.status(409).json({ error: { code: 'CONFLICT', message: 'This record already exists' } });
  }
  if (pgErr.code === '22P02') {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Invalid identifier format' } });
  }
  if ((err as SyntaxError)?.name === 'SyntaxError' && 'body' in (err as object)) {
    return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Malformed JSON body' } });
  }
  logger.error('Unhandled error', {
    requestId: res.locals.requestId,
    path: req.path,
    error: (err as Error)?.message,
    stack: (err as Error)?.stack,
  });
  res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Something went wrong. Please try again.' } });
}

export function notFoundHandler(req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: `Route ${req.method} ${req.path} not found` } });
}
