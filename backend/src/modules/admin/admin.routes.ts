import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, transaction } from '../../db/pool.js';
import { requireAuth, requireRole, setBlocked, type Role } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { audit } from '../../lib/audit.js';
import { fileUrl } from '../../lib/storage.js';
import { badRequest, notFound } from '../../utils/errors.js';
import { ah, pagination } from '../../utils/http.js';
import { revokeAllSessions } from '../auth/auth.service.js';
import { mapCard } from '../courses/courses.service.js';
import { flaggedPosts, moderatePost } from '../discussions/discussions.routes.js';
import { notifyMany } from '../notifications/notify.js';

export const adminRouter = Router();
adminRouter.use('/admin', requireAuth, requireRole('admin'));

// ---------------------------------------------------------------------------
// User management (FR-AD2, FR-AD4)
// ---------------------------------------------------------------------------
adminRouter.get('/admin/users', ah(async (req, res) => {
  const { page, limit, offset } = pagination(req.query, 20);
  const q = (req.query.q as string) || null;
  const role = (req.query.role as string) || null;
  const status = (req.query.status as string) || null; // active | suspended
  const where = `u.deleted_at IS NULL
    AND ($1::text IS NULL OR u.full_name ILIKE '%' || $1 || '%' OR u.email ILIKE '%' || $1 || '%')
    AND ($2::text IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = $2))
    AND ($3::text IS NULL OR ($3 = 'active' AND u.is_active) OR ($3 = 'suspended' AND NOT u.is_active))`;
  const total = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM users u WHERE ${where}`, [q, role, status]))!.n;
  const rows = await many(
    `SELECT u.id, u.full_name, u.email, u.avatar_url, u.is_active, u.created_at, u.last_login_at,
       ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id ORDER BY r.id) AS roles,
       (SELECT COUNT(*) FROM enrollments e WHERE e.user_id = u.id)::int AS enrollments,
       (SELECT COUNT(*) FROM courses c WHERE c.instructor_id = u.id)::int AS courses
     FROM users u WHERE ${where} ORDER BY u.created_at DESC LIMIT $4 OFFSET $5`,
    [q, role, status, limit, offset],
  );
  res.json({ data: rows.map((r) => ({ ...r, avatar_url: fileUrl(r.avatar_url) })), page, limit, total, total_pages: Math.ceil(total / limit) });
}));

adminRouter.get('/admin/users/:id', ah(async (req, res) => {
  const u = await one(
    `SELECT u.id, u.full_name, u.email, u.bio, u.avatar_url, u.is_active, u.created_at, u.last_login_at,
       ARRAY(SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id) AS roles
     FROM users u WHERE u.id = $1 AND u.deleted_at IS NULL`,
    [req.params.id],
  );
  if (!u) throw notFound('User');
  const enrollments = await many(
    `SELECT c.id, c.title, e.progress_percent, e.enrolled_at FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 ORDER BY e.enrolled_at DESC`,
    [u.id],
  );
  const courses = await many('SELECT id, title, status, created_at FROM courses WHERE instructor_id = $1 ORDER BY created_at DESC', [u.id]);
  const activity = await many('SELECT action, entity, created_at, metadata FROM audit_logs WHERE entity_id = $1 OR actor_id = $1 ORDER BY created_at DESC LIMIT 20', [u.id]);
  res.json({ ...u, avatar_url: fileUrl(u.avatar_url), enrollments, courses, activity });
}));

adminRouter.put('/admin/users/:id/role',
  validate(z.object({ roles: z.array(z.enum(['student', 'instructor', 'admin'])).min(1, 'a user needs at least one role') })),
  ah(async (req, res) => {
    const target = await one('SELECT id, full_name FROM users WHERE id = $1 AND deleted_at IS NULL', [req.params.id]);
    if (!target) throw notFound('User');
    const roles: Role[] = [...new Set(req.body.roles as Role[])];
    if (target.id === req.user!.id && !roles.includes('admin')) throw badRequest('You cannot remove your own admin role');
    const before = await many<{ name: string }>('SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = $1', [target.id]);
    await transaction(async (c) => {
      await c.query('DELETE FROM user_roles WHERE user_id = $1', [target.id]);
      await c.query('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = ANY($2)', [target.id, roles]);
    });
    // Force a fresh token so the new permissions apply on next request.
    await revokeAllSessions(target.id);
    await audit(req.user!.id, 'user.roles', 'user', target.id, { before: before.map((b) => b.name), after: roles });
    await notifyMany([target.id], { title: 'Your account roles changed', body: `Your roles are now: ${roles.join(', ')}. Please sign in again.`, type: 'system' });
    res.json({ id: target.id, roles });
  }));

adminRouter.put('/admin/users/:id/suspend', validate(z.object({ suspended: z.boolean().default(true), reason: z.string().trim().max(500).optional() })),
  ah(async (req, res) => {
    if (req.params.id === req.user!.id) throw badRequest('You cannot suspend your own account');
    const u = await one('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2 AND deleted_at IS NULL RETURNING id, is_active', [!req.body.suspended, req.params.id]);
    if (!u) throw notFound('User');
    await setBlocked(u.id, req.body.suspended);
    if (req.body.suspended) await revokeAllSessions(u.id);
    await audit(req.user!.id, req.body.suspended ? 'user.suspend' : 'user.reactivate', 'user', u.id, { reason: req.body.reason });
    res.json(u);
  }));

/** Soft delete: personal data is anonymised, the account can't sign in, but payments/audit history stay consistent. */
adminRouter.delete('/admin/users/:id', ah(async (req, res) => {
  if (req.params.id === req.user!.id) throw badRequest('You cannot delete your own account');
  const u = await one(
    `UPDATE users SET deleted_at = now(), is_active = FALSE, full_name = 'Deleted user', email = 'deleted-' || id || '@deleted.local',
       avatar_url = NULL, bio = NULL, updated_at = now()
     WHERE id = $1 AND deleted_at IS NULL RETURNING id`,
    [req.params.id],
  );
  if (!u) throw notFound('User');
  await revokeAllSessions(u.id);
  await setBlocked(u.id, true);
  await audit(req.user!.id, 'user.delete', 'user', u.id);
  res.json({ success: true });
}));

// ---------------------------------------------------------------------------
// Course approval queue (FR-AD1)
// ---------------------------------------------------------------------------
const ADMIN_COURSE_SQL = `
  SELECT c.id, c.title, c.description, c.category, c.difficulty, c.price, c.status, c.thumbnail_url, c.created_at, c.updated_at,
    json_build_object('id', u.id, 'full_name', u.full_name, 'email', u.email, 'avatar_url', u.avatar_url) AS instructor,
    (SELECT COUNT(*) FROM modules m WHERE m.course_id = c.id)::int AS module_count,
    (SELECT COUNT(*) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id)::int AS lecture_count,
    (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id)::int AS enrollment_count,
    (SELECT row_to_json(x) FROM (SELECT ca.decision, ca.comment, ca.reviewed_at FROM course_approvals ca WHERE ca.course_id = c.id ORDER BY ca.reviewed_at DESC LIMIT 1) x) AS last_review
  FROM courses c JOIN users u ON u.id = c.instructor_id`;

adminRouter.get('/admin/courses/pending', ah(async (_req, res) => {
  const rows = await many(`${ADMIN_COURSE_SQL} WHERE c.status = 'pending' ORDER BY c.created_at`);
  res.json({ data: rows.map(mapCard) });
}));

adminRouter.get('/admin/courses', ah(async (req, res) => {
  const rows = await many(
    `${ADMIN_COURSE_SQL} WHERE ($1::text IS NULL OR c.status = $1) AND ($2::text IS NULL OR c.title ILIKE '%' || $2 || '%') ORDER BY c.created_at DESC LIMIT 200`,
    [(req.query.status as string) || null, (req.query.q as string) || null],
  );
  res.json({ data: rows.map(mapCard) });
}));

// ---------------------------------------------------------------------------
// Platform analytics (FR-AD3)
// ---------------------------------------------------------------------------
adminRouter.get('/admin/analytics/overview', ah(async (_req, res) => {
  const totals = await one(
    `SELECT
      (SELECT COUNT(*) FROM users WHERE deleted_at IS NULL)::int AS users,
      (SELECT COUNT(DISTINCT ur.user_id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.name = 'student' AND u.deleted_at IS NULL)::int AS students,
      (SELECT COUNT(DISTINCT ur.user_id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.name = 'instructor' AND u.deleted_at IS NULL)::int AS instructors,
      (SELECT COUNT(DISTINCT ur.user_id) FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id WHERE r.name = 'admin' AND u.deleted_at IS NULL)::int AS admins,
      (SELECT COUNT(*) FROM users WHERE NOT is_active AND deleted_at IS NULL)::int AS suspended,
      (SELECT COUNT(*) FROM courses)::int AS courses,
      (SELECT COUNT(*) FROM courses WHERE status = 'approved')::int AS approved_courses,
      (SELECT COUNT(*) FROM courses WHERE status = 'pending')::int AS pending_courses,
      (SELECT COUNT(*) FROM enrollments)::int AS enrollments,
      (SELECT COALESCE(ROUND(100.0 * COUNT(*) FILTER (WHERE completed_at IS NOT NULL) / NULLIF(COUNT(*), 0), 1), 0) FROM enrollments)::float AS completion_rate,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'success')::float AS revenue,
      (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE status = 'success' AND created_at >= date_trunc('month', now()))::float AS revenue_this_month,
      (SELECT COUNT(*) FROM user_activity_days WHERE day = CURRENT_DATE)::int AS dau,
      (SELECT COUNT(DISTINCT user_id) FROM user_activity_days WHERE day > CURRENT_DATE - 30)::int AS mau,
      (SELECT COUNT(*) FROM discussion_posts WHERE is_flagged)::int AS flagged_posts,
      (SELECT COUNT(*) FROM ai_chat_messages WHERE sender = 'user')::int AS ai_questions,
      (SELECT COUNT(*) FROM certificates)::int AS certificates`,
  );
  const daily = await many(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day,
       (SELECT COUNT(*) FROM user_activity_days a WHERE a.day = d::date)::int AS dau,
       (SELECT COUNT(*) FROM users u WHERE u.created_at::date = d::date)::int AS signups,
       (SELECT COUNT(*) FROM enrollments e WHERE e.enrolled_at::date = d::date)::int AS enrollments
     FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') d ORDER BY d`,
  );
  const categories = await many(
    `SELECT COALESCE(c.category, 'Other') AS name, COUNT(DISTINCT c.id)::int AS courses, COUNT(e.id)::int AS enrollments
     FROM courses c LEFT JOIN enrollments e ON e.course_id = c.id WHERE c.status = 'approved' GROUP BY 1 ORDER BY enrollments DESC`,
  );
  const topCourses = await many(
    `SELECT c.id, c.title, u.full_name AS instructor_name, COUNT(e.id)::int AS enrollments,
       COALESCE(ROUND(100.0 * COUNT(e.completed_at) / NULLIF(COUNT(e.id), 0), 1), 0)::float AS completion_rate,
       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p WHERE p.course_id = c.id AND p.status = 'success')::float AS revenue
     FROM courses c JOIN users u ON u.id = c.instructor_id LEFT JOIN enrollments e ON e.course_id = c.id
     WHERE c.status = 'approved' GROUP BY c.id, u.full_name ORDER BY enrollments DESC LIMIT 6`,
  );
  const recentUsers = await many(
    `SELECT u.id, u.full_name, u.email, u.created_at,
       (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id ORDER BY r.id DESC LIMIT 1) AS role
     FROM users u WHERE u.deleted_at IS NULL ORDER BY u.created_at DESC LIMIT 6`,
  );
  res.json({ totals, daily, categories, top_courses: topCourses, recent_users: recentUsers });
}));

adminRouter.get('/admin/analytics/revenue', ah(async (_req, res) => {
  const monthly = await many(
    `SELECT to_char(m, 'Mon YYYY') AS month, to_char(m, 'YYYY-MM') AS key,
       COALESCE((SELECT SUM(amount) FROM payments p WHERE p.status = 'success' AND date_trunc('month', p.created_at) = m), 0)::float AS revenue,
       COALESCE((SELECT COUNT(*) FROM payments p WHERE p.status = 'success' AND date_trunc('month', p.created_at) = m), 0)::int AS orders,
       COALESCE((SELECT SUM(amount) FROM payments p WHERE p.status = 'refunded' AND date_trunc('month', p.created_at) = m), 0)::float AS refunds
     FROM generate_series(date_trunc('month', now()) - interval '11 months', date_trunc('month', now()), interval '1 month') m ORDER BY m`,
  );
  const byCourse = await many(
    `SELECT c.id, c.title, u.full_name AS instructor_name, COUNT(p.id)::int AS orders, COALESCE(SUM(p.amount), 0)::float AS revenue
     FROM payments p JOIN courses c ON c.id = p.course_id JOIN users u ON u.id = c.instructor_id
     WHERE p.status = 'success' GROUP BY c.id, u.full_name ORDER BY revenue DESC LIMIT 10`,
  );
  const recent = await many(
    `SELECT p.id, p.amount, p.status, p.created_at, u.full_name AS student_name, c.title AS course_title
     FROM payments p LEFT JOIN users u ON u.id = p.user_id LEFT JOIN courses c ON c.id = p.course_id ORDER BY p.created_at DESC LIMIT 15`,
  );
  const totals = await one(
    `SELECT COALESCE(SUM(amount) FILTER (WHERE status = 'success'), 0)::float AS gross,
       COALESCE(SUM(amount) FILTER (WHERE status = 'refunded'), 0)::float AS refunds,
       COUNT(*) FILTER (WHERE status = 'success')::int AS orders,
       COALESCE(ROUND(AVG(amount) FILTER (WHERE status = 'success'), 2), 0)::float AS avg_order
     FROM payments`,
  );
  res.json({ totals, monthly, by_course: byCourse, recent, is_demo_data: true });
}));

// ---------------------------------------------------------------------------
// Moderation (FR-AD5)
// ---------------------------------------------------------------------------
adminRouter.get('/admin/moderation/flagged-posts', ah(async (_req, res) => res.json({ data: await flaggedPosts(null) })));
adminRouter.put('/admin/moderation/posts/:id', validate(z.object({ action: z.enum(['dismiss', 'hide', 'unhide', 'delete']) })),
  ah(async (req, res) => {
    await moderatePost(req.user!, req.params.id, req.body.action);
    res.json({ success: true });
  }));

// ---------------------------------------------------------------------------
// Broadcast notifications & audit log
// ---------------------------------------------------------------------------
adminRouter.post('/admin/notifications',
  validate(z.object({
    title: z.string().trim().min(3).max(150),
    body: z.string().trim().min(1).max(2000),
    audience: z.enum(['all', 'students', 'instructors']),
    email: z.boolean().optional(),
  })),
  ah(async (req, res) => {
    const role = { all: null, students: 'student', instructors: 'instructor' }[req.body.audience as 'all'];
    const users = await many<{ id: string }>(
      `SELECT u.id FROM users u WHERE u.deleted_at IS NULL AND u.is_active
       AND ($1::text IS NULL OR EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id AND r.name = $1))`,
      [role],
    );
    await notifyMany(users.map((u) => u.id), { title: req.body.title, body: req.body.body, type: 'system', email: !!req.body.email });
    await audit(req.user!.id, 'notification.broadcast', 'notification', null, { audience: req.body.audience, count: users.length });
    res.status(201).json({ sent: users.length });
  }));

adminRouter.get('/admin/notifications/history', ah(async (_req, res) => {
  res.json({ data: await many(
    `SELECT a.created_at, a.metadata, u.full_name AS actor FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     WHERE a.action = 'notification.broadcast' ORDER BY a.created_at DESC LIMIT 20`,
  ) });
}));

adminRouter.get('/admin/audit-logs', ah(async (req, res) => {
  const { limit, offset, page } = pagination(req.query, 30);
  const rows = await many(
    `SELECT a.*, u.full_name AS actor_name FROM audit_logs a LEFT JOIN users u ON u.id = a.actor_id
     ORDER BY a.created_at DESC LIMIT $1 OFFSET $2`,
    [limit, offset],
  );
  res.json({ data: rows, page, limit });
}));

export { query };
