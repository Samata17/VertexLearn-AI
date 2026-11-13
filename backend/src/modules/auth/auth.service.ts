/**
 * Authentication.
 *
 * Tokens:
 *  - Access token: a JWT valid for 15 minutes. Sent as "Authorization: Bearer <token>" on every request.
 *  - Refresh token: a long random string valid for 7 days. Only its SHA-256 hash is stored in the DB.
 *    It's exchanged at /auth/refresh for a new pair ("rotation": the old one is revoked on use),
 *    so a stolen refresh token stops working as soon as the real user refreshes.
 *  - Passwords are hashed with bcrypt (cost 12). Plain passwords are never stored or logged.
 */
import crypto from 'node:crypto';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { env } from '../../config/env.js';
import { many, one, query, transaction } from '../../db/pool.js';
import type { AuthUser, Role } from '../../middleware/auth.js';
import { AppError, badRequest, conflict, unauthorized } from '../../utils/errors.js';
import { emailLayout } from '../../lib/mailer.js';
import { queueEmail } from '../../jobs/queues.js';
import { fileUrl } from '../../lib/storage.js';
import { recordActivity } from '../gamification/gamification.service.js';

const ROLE_RANK: Role[] = ['admin', 'instructor', 'student'];
export const primaryRole = (roles: Role[]): Role => ROLE_RANK.find((r) => roles.includes(r)) ?? 'student';

const hashToken = (t: string) => crypto.createHash('sha256').update(t).digest('hex');

export async function getRoles(userId: string): Promise<Role[]> {
  const rows = await many<{ name: Role }>(
    'SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1',
    [userId],
  );
  return rows.map((r) => r.name);
}

async function issueTokens(user: { id: string; email: string }, roles: Role[]) {
  const role = primaryRole(roles);
  const access_token = jwt.sign({ email: user.email, roles, role }, env.JWT_ACCESS_SECRET, {
    subject: user.id,
    expiresIn: env.JWT_ACCESS_TTL as jwt.SignOptions['expiresIn'],
  });
  const refresh_token = crypto.randomBytes(48).toString('base64url');
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + ($3 || ' days')::interval)`,
    [user.id, hashToken(refresh_token), String(env.JWT_REFRESH_TTL_DAYS)],
  );
  return { access_token, refresh_token };
}

export async function publicProfile(userId: string) {
  const u = await one(
    `SELECT id, full_name, email, avatar_url, bio, created_at FROM users WHERE id = $1 AND deleted_at IS NULL`,
    [userId],
  );
  if (!u) throw unauthorized('Account not found');
  const roles = await getRoles(userId);
  return { ...u, avatar_url: fileUrl(u.avatar_url), roles, role: primaryRole(roles) };
}

export async function register(input: { full_name: string; email: string; password: string; role?: 'student' | 'instructor' }) {
  const email = input.email.toLowerCase();
  const existing = await one('SELECT id FROM users WHERE email = $1', [email]);
  if (existing) throw conflict('An account with this email already exists', 'email');

  const password_hash = await bcrypt.hash(input.password, 12);
  const role = input.role ?? 'student'; // PRD 8.1: default role is student. Admin can never be self-assigned.
  const user = await transaction(async (c) => {
    const { rows } = await c.query(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id, email',
      [input.full_name, email, password_hash],
    );
    await c.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [rows[0].id, role]);
    await c.query(
      `INSERT INTO notifications (user_id, title, body, type, link) VALUES ($1, $2, $3, 'system', $4)`,
      [
        rows[0].id,
        'Welcome to VertexLearn AI',
        role === 'instructor'
          ? 'Create your first course from the instructor dashboard. New courses are reviewed by an admin before going live.'
          : 'Browse the catalog, enroll in a course, and ask the AI tutor whenever you get stuck.',
        role === 'instructor' ? '/instructor/courses/new' : '/courses',
      ],
    );
    return rows[0] as { id: string; email: string };
  });
  const tokens = await issueTokens(user, [role]);
  return { ...tokens, user: await publicProfile(user.id) };
}

export async function login(emailRaw: string, password: string) {
  const email = emailRaw.toLowerCase();
  const user = await one<{ id: string; email: string; password_hash: string; is_active: boolean }>(
    'SELECT id, email, password_hash, is_active FROM users WHERE email = $1 AND deleted_at IS NULL',
    [email],
  );
  // Same error for "no such user" and "wrong password" so attackers can't discover which emails exist.
  const ok = user ? await bcrypt.compare(password, user.password_hash) : await bcrypt.compare(password, DUMMY_HASH);
  if (!user || !ok) throw new AppError(401, 'INVALID_CREDENTIALS', 'Incorrect email or password');
  if (!user.is_active) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended. Contact support.');

  await query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  const roles = await getRoles(user.id);
  if (roles.includes('student')) await recordActivity(user.id);
  const tokens = await issueTokens(user, roles);
  return { ...tokens, user: await publicProfile(user.id) };
}
// Comparing against a dummy hash keeps response time similar whether or not the email exists.
const DUMMY_HASH = bcrypt.hashSync('dummy-password-for-timing', 12);

/**
 * A refresh token stays usable for a few seconds after it was rotated. Without this, reloading the page
 * while a refresh is in flight (or two tabs refreshing at once) signs the user out: the server already
 * revoked the old token, but the browser never received the new one.
 * Tokens revoked by logout / password reset get `revoked_reason` set and never get this grace period.
 */
const ROTATION_GRACE_SECONDS = 30;

export async function refresh(refreshToken: string) {
  const row = await one<{ id: string; user_id: string; email: string; is_active: boolean }>(
    `SELECT rt.id, rt.user_id, u.email, u.is_active FROM refresh_tokens rt JOIN users u ON u.id = rt.user_id
     WHERE rt.token_hash = $1 AND rt.expires_at > now() AND u.deleted_at IS NULL
       AND (rt.revoked_at IS NULL
            OR (rt.revoked_reason = 'rotated' AND rt.revoked_at > now() - make_interval(secs => $2)))`,
    [hashToken(refreshToken), ROTATION_GRACE_SECONDS],
  );
  if (!row) throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Session expired. Please sign in again.');
  if (!row.is_active) throw new AppError(403, 'ACCOUNT_SUSPENDED', 'This account is suspended');
  await query(
    `UPDATE refresh_tokens SET revoked_at = now(), revoked_reason = 'rotated' WHERE id = $1 AND revoked_at IS NULL`,
    [row.id],
  );
  const roles = await getRoles(row.user_id);
  const tokens = await issueTokens({ id: row.user_id, email: row.email }, roles);
  return { ...tokens, user: await publicProfile(row.user_id) };
}

// Hard revocation: also ends the rotation grace period of recently rotated tokens.
const HARD_REVOKE = `SET revoked_at = COALESCE(revoked_at, now()), revoked_reason = 'revoked'
  WHERE (revoked_at IS NULL OR revoked_reason = 'rotated')`;

/**
 * Ends this session. Also closes the grace window of the user's recently rotated tokens: otherwise the
 * token this one replaced (seconds ago) could still be exchanged after sign-out.
 */
export async function logout(refreshToken?: string) {
  if (!refreshToken) return;
  await query(
    `UPDATE refresh_tokens ${HARD_REVOKE}
       AND (token_hash = $1
            OR (revoked_reason = 'rotated'
                AND user_id = (SELECT user_id FROM refresh_tokens WHERE token_hash = $1)))`,
    [hashToken(refreshToken)],
  );
}

export async function revokeAllSessions(userId: string) {
  await query(`UPDATE refresh_tokens ${HARD_REVOKE} AND user_id = $1`, [userId]);
}

export async function forgotPassword(emailRaw: string) {
  const user = await one<{ id: string; full_name: string; email: string }>(
    'SELECT id, full_name, email FROM users WHERE email = $1 AND deleted_at IS NULL AND is_active',
    [emailRaw.toLowerCase()],
  );
  if (!user) return; // Don't reveal whether the email exists.
  const token = crypto.randomBytes(32).toString('base64url');
  await query(
    `INSERT INTO password_reset_tokens (user_id, token_hash, expires_at) VALUES ($1, $2, now() + interval '30 minutes')`,
    [user.id, hashToken(token)],
  );
  const url = `${env.APP_URL}/reset-password?token=${token}`;
  await queueEmail({
    to: user.email,
    subject: 'Reset your VertexLearn AI password',
    html: emailLayout(
      'Reset your password',
      `<p>Hi ${user.full_name.split(' ')[0]},</p><p>We received a request to reset your password. This link expires in 30 minutes. If you didn't ask for this, you can ignore this email.</p>`,
      { label: 'Choose a new password', url },
    ),
  });
}

export async function resetPassword(token: string, password: string) {
  const row = await one<{ id: string; user_id: string }>(
    `SELECT id, user_id FROM password_reset_tokens WHERE token_hash = $1 AND used_at IS NULL AND expires_at > now()`,
    [hashToken(token)],
  );
  if (!row) throw badRequest('This reset link is invalid or has expired', 'token');
  const hash = await bcrypt.hash(password, 12);
  await transaction(async (c) => {
    await c.query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [hash, row.user_id]);
    await c.query('UPDATE password_reset_tokens SET used_at = now() WHERE id = $1', [row.id]);
    await c.query(`UPDATE refresh_tokens ${HARD_REVOKE} AND user_id = $1`, [row.user_id]);
  });
}

export async function changePassword(user: AuthUser, current: string, next: string) {
  const row = await one<{ password_hash: string }>('SELECT password_hash FROM users WHERE id = $1', [user.id]);
  if (!row || !(await bcrypt.compare(current, row.password_hash))) {
    throw badRequest('Current password is incorrect', 'current_password');
  }
  await query('UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2', [await bcrypt.hash(next, 12), user.id]);
}
