/**
 * AppError carries an HTTP status and a machine-readable code.
 * The error handler turns it into the PRD 8.8 format:
 *   { "error": { "code": "VALIDATION_ERROR", "message": "...", "field": "email" } }
 */
export class AppError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, field?: string) => new AppError(400, 'VALIDATION_ERROR', message, field);
export const unauthorized = (message = 'Authentication required') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'You do not have permission to do this') => new AppError(403, 'FORBIDDEN', message);
export const notFound = (what = 'Resource') => new AppError(404, 'NOT_FOUND', `${what} not found`);
export const conflict = (message: string, field?: string) => new AppError(409, 'CONFLICT', message, field);
