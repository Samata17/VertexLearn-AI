/**
 * Unit tests — no database, Redis or network needed:  npm test
 * (End-to-end API coverage lives in scripts/smoke-test.mjs and frontend/e2e.)
 */
import { describe, expect, it } from 'vitest';
import jwt from 'jsonwebtoken';
import { displayName, fileUrl, verifySignature } from '../src/lib/storage.js';
import { requireRole, type AuthUser } from '../src/middleware/auth.js';
import { AppError, badRequest } from '../src/utils/errors.js';
import { pagination } from '../src/utils/http.js';

describe('signed file URLs', () => {
  it('leaves external URLs untouched and makes public keys unsigned', () => {
    expect(fileUrl('https://example.com/v.mp4')).toBe('https://example.com/v.mp4');
    expect(fileUrl('s3://public/thumbnails/a.png')).toBe('/api/v1/files/public/thumbnails/a.png');
    expect(fileUrl(null)).toBeNull();
  });

  it('signs private keys and rejects tampering', () => {
    const url = new URL(fileUrl('s3://lectures/videos/1-abcdef12-intro.mp4')!, 'http://x');
    const key = url.searchParams.get('key')!;
    const exp = Number(url.searchParams.get('exp'));
    const sig = url.searchParams.get('sig')!;
    expect(verifySignature(key, exp, sig)).toBe(true);
    expect(verifySignature('lectures/videos/other.mp4', exp, sig)).toBe(false);
    expect(verifySignature(key, exp + 1, sig)).toBe(false);
    expect(verifySignature(key, Math.floor(Date.now() / 1000) - 10, sig)).toBe(false); // expired
  });

  it('recovers the original filename from a storage key', () => {
    expect(displayName('s3://lectures/resources/1730000000000-0a1b2c3d-notes.pdf')).toBe('notes.pdf');
  });
});

describe('RBAC middleware', () => {
  const run = (user: AuthUser | undefined, ...roles: AuthUser['role'][]) =>
    new Promise<unknown>((resolve) => requireRole(...roles)({ user } as any, {} as any, (err?: unknown) => resolve(err)));

  it('allows a matching role and blocks others', async () => {
    const student: AuthUser = { id: '1', email: 's@x.io', roles: ['student'], role: 'student' };
    expect(await run(student, 'student')).toBeUndefined();
    const err = (await run(student, 'admin')) as AppError;
    expect(err.status).toBe(403);
    expect(((await run(undefined, 'student')) as AppError).status).toBe(401);
  });
});

describe('helpers', () => {
  it('clamps pagination', () => {
    expect(pagination({ page: '0', limit: '1000' })).toEqual({ page: 1, limit: 100, offset: 0 });
    expect(pagination({ page: '3' }, 10)).toEqual({ page: 3, limit: 10, offset: 20 });
  });

  it('builds PRD-style validation errors', () => {
    const e = badRequest('email must be valid', 'email');
    expect(e).toMatchObject({ status: 400, code: 'VALIDATION_ERROR', field: 'email' });
  });

  it('access tokens carry role claims', () => {
    const token = jwt.sign({ email: 'a@b.c', roles: ['instructor'], role: 'instructor' }, 'test-secret-1234567890', { subject: 'u1', expiresIn: '15m' });
    const payload = jwt.verify(token, 'test-secret-1234567890') as jwt.JwtPayload;
    expect(payload.sub).toBe('u1');
    expect(payload.role).toBe('instructor');
  });
});
