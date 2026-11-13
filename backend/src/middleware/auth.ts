import type { NextFunction, Request, Response } from 'express';
import jwt from 'jsonwebtoken';
import { env } from '../config/env.js';
import { redis } from '../config/redis.js';
import { AppError, forbidden, unauthorized } from '../utils/errors.js';

export type Role = 'student' | 'instructor' | 'admin';

export interface AuthUser {
  id: string;
  email: string;
  roles: Role[];
  role: Role; // primary role (highest privilege) — used for dashboard redirects
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: AuthUser;
    }
  }
}

function readUser(req: Request): AuthUser | undefined {
  const header = req.headers.authorization;
  if (!header?.startsWith('Bearer ')) return undefined;
  try {
    const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as jwt.JwtPayload;
    return { id: payload.sub!, email: payload.email, roles: payload.roles, role: payload.role };
  } catch {
    throw unauthorized('Access token is invalid or expired');
  }
}

/**
 * Requires a valid access token. Sets req.user.
 * Also checks a Redis blocklist so a suspended/deleted user is locked out immediately,
 * not only when their 15-minute access token expires.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const user = readUser(req);
    if (!user) return next(unauthorized());
    if (await isBlocked(user.id)) return next(new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended'));
    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

async function isBlocked(userId: string) {
  try {
    return (await redis.exists(`blocked:${userId}`)) === 1;
  } catch {
    return false;
  }
}

export async function setBlocked(userId: string, blocked: boolean) {
  if (blocked) await redis.set(`blocked:${userId}`, '1', 'EX', 60 * 60 * 24); // > access token lifetime
  else await redis.del(`blocked:${userId}`);
}

/** Sets req.user if a valid token is present, but doesn't require one (public endpoints). */
export function optionalAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    req.user = readUser(req);
  } catch {
    req.user = undefined;
  }
  next();
}

/**
 * RBAC gate (PRD Section 11): `requireRole('instructor', 'admin')` lets a user through
 * if they hold ANY of the listed roles. Ownership checks happen in the service layer.
 */
export function requireRole(...allowed: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(unauthorized());
    if (!req.user.roles.some((r) => allowed.includes(r))) {
      return next(forbidden(`This action requires role: ${allowed.join(' or ')}`));
    }
    next();
  };
}

export const hasRole = (user: AuthUser | undefined, role: Role) => !!user?.roles.includes(role);
