/**
 * Course discussion forums (threaded) + announcements.
 * Threads belong to a course; posts belong to a thread and may reply to another post (parent_post_id),
 * which is how nested replies work. The frontend builds the tree from the flat list.
 */
import { Router } from 'express';
import { z } from 'zod';
import { many, one, query, transaction } from '../../db/pool.js';
import { hasRole, requireAuth, requireRole, type AuthUser } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { fileUrl } from '../../lib/storage.js';
import { audit } from '../../lib/audit.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { awardBadge } from '../gamification/gamification.service.js';
import { notify, notifyMany } from '../notifications/notify.js';
import { assertCourseManager, assertCourseViewer, getCourse, isOwnerOrAdmin } from '../courses/access.js';

export const discussionsRouter = Router();
discussionsRouter.use(requireAuth);

async function threadCtx(threadId: string) {
  const t = await one('SELECT t.*, c.instructor_id, c.title AS course_title FROM discussion_threads t JOIN courses c ON c.id = t.course_id WHERE t.id = $1', [threadId]);
  if (!t) throw notFound('Thread');
  return t;
}
async function postCtx(postId: string) {
  const p = await one(
    `SELECT p.*, t.course_id, t.title AS thread_title, c.instructor_id FROM discussion_posts p
     JOIN discussion_threads t ON t.id = p.thread_id JOIN courses c ON c.id = t.course_id WHERE p.id = $1`,
    [postId],
  );
  if (!p) throw notFound('Post');
  return p;
}
const canModerate = (user: AuthUser, ctx: { instructor_id: string }) => isOwnerOrAdmin(user, ctx);

// ---- Threads ----
discussionsRouter.get('/courses/:id/threads', ah(async (req, res) => {
  await assertCourseViewer(req.user!, req.params.id);
  const rows = await many(
    `SELECT t.id, t.title, t.created_at, u.full_name AS author_name, u.avatar_url AS author_avatar,
       (SELECT COUNT(*) FROM discussion_posts p WHERE p.thread_id = t.id)::int - 1 AS reply_count,
       (SELECT MAX(p.created_at) FROM discussion_posts p WHERE p.thread_id = t.id) AS last_activity_at,
       (SELECT left(p.content, 220) FROM discussion_posts p WHERE p.thread_id = t.id AND p.parent_post_id IS NULL ORDER BY p.created_at LIMIT 1) AS preview,
       EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = t.created_by AND r.name = 'instructor') AS by_instructor
     FROM discussion_threads t JOIN users u ON u.id = t.created_by
     WHERE t.course_id = $1 AND ($2::text IS NULL OR t.title ILIKE '%' || $2 || '%')
     ORDER BY last_activity_at DESC NULLS LAST`,
    [req.params.id, (req.query.q as string) || null],
  );
  res.json({ data: rows.map((r) => ({ ...r, author_avatar: fileUrl(r.author_avatar) })) });
}));

discussionsRouter.post('/courses/:id/threads',
  validate(z.object({ title: z.string().trim().min(5, 'must be at least 5 characters').max(200), content: z.string().trim().min(1).max(10000) })),
  ah(async (req, res) => {
    const { course } = await assertCourseViewer(req.user!, req.params.id);
    const thread = await transaction(async (c) => {
      const { rows } = await c.query('INSERT INTO discussion_threads (course_id, created_by, title) VALUES ($1,$2,$3) RETURNING *', [req.params.id, req.user!.id, req.body.title]);
      await c.query('INSERT INTO discussion_posts (thread_id, user_id, content) VALUES ($1,$2,$3)', [rows[0].id, req.user!.id, req.body.content]);
      return rows[0];
    });
    if (course.instructor_id !== req.user!.id) {
      await notify(course.instructor_id, {
        title: 'New discussion thread', body: `"${req.body.title}" in ${course.title}`, type: 'info',
        link: `/instructor/courses/${course.id}?tab=discussions&thread=${thread.id}`,
      });
    }
    res.status(201).json(thread);
  }));

discussionsRouter.get('/threads/:id', ah(async (req, res) => {
  const t = await threadCtx(req.params.id);
  const { manager } = await assertCourseViewer(req.user!, t.course_id);
  const posts = await many(
    `SELECT p.id, p.parent_post_id, p.content, p.created_at, p.is_flagged, p.is_hidden, p.user_id,
       u.full_name AS author_name, u.avatar_url AS author_avatar,
       (SELECT r.name FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE ur.user_id = u.id
        ORDER BY CASE r.name WHEN 'admin' THEN 1 WHEN 'instructor' THEN 2 ELSE 3 END LIMIT 1) AS author_role
     FROM discussion_posts p JOIN users u ON u.id = p.user_id WHERE p.thread_id = $1 ORDER BY p.created_at`,
    [req.params.id],
  );
  res.json({
    thread: { id: t.id, title: t.title, course_id: t.course_id, course_title: t.course_title, created_by: t.created_by, created_at: t.created_at },
    can_moderate: manager,
    posts: posts.map((p) => ({
      ...p,
      author_avatar: fileUrl(p.author_avatar),
      content: p.is_hidden && !manager ? '[This post was removed by a moderator]' : p.content,
      is_flagged: manager ? p.is_flagged : undefined,
      is_mine: p.user_id === req.user!.id,
    })),
  });
}));

discussionsRouter.post('/threads/:id/posts',
  validate(z.object({ content: z.string().trim().min(1).max(10000), parent_post_id: z.string().uuid().optional() })),
  ah(async (req, res) => {
    const t = await threadCtx(req.params.id);
    await assertCourseViewer(req.user!, t.course_id);
    let parentAuthor: string | null = null;
    if (req.body.parent_post_id) {
      const parent = await one('SELECT user_id FROM discussion_posts WHERE id = $1 AND thread_id = $2', [req.body.parent_post_id, t.id]);
      if (!parent) throw notFound('Parent post');
      parentAuthor = parent.user_id;
    }
    const post = await one('INSERT INTO discussion_posts (thread_id, user_id, content, parent_post_id) VALUES ($1,$2,$3,$4) RETURNING *', [
      t.id, req.user!.id, req.body.content, req.body.parent_post_id ?? null,
    ]);
    const recipients = new Set([t.created_by, parentAuthor].filter((x): x is string => !!x && x !== req.user!.id));
    await notifyMany([...recipients], {
      title: 'New reply', body: `Someone replied in "${t.title}"`, type: 'info',
      link: `/app/discussions/${t.course_id}/${t.id}`,
    });
    const { n } = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM discussion_posts p JOIN discussion_threads t ON t.id = p.thread_id WHERE p.user_id = $1 AND p.id <> (SELECT id FROM discussion_posts WHERE thread_id = t.id ORDER BY created_at LIMIT 1)', [req.user!.id]))!;
    if (n >= 5) await awardBadge(req.user!.id, 'helpful_peer');
    res.status(201).json(post);
  }));

discussionsRouter.put('/posts/:id', validate(z.object({ content: z.string().trim().min(1).max(10000) })), ah(async (req, res) => {
  const p = await postCtx(req.params.id);
  if (p.user_id !== req.user!.id) throw forbidden('You can only edit your own posts');
  res.json(await one('UPDATE discussion_posts SET content = $1 WHERE id = $2 RETURNING *', [req.body.content, p.id]));
}));

discussionsRouter.delete('/posts/:id', ah(async (req, res) => {
  const p = await postCtx(req.params.id);
  if (p.user_id !== req.user!.id && !canModerate(req.user!, p)) throw forbidden();
  await query('DELETE FROM discussion_posts WHERE id = $1', [p.id]);
  if (p.user_id !== req.user!.id) await audit(req.user!.id, 'post.delete', 'discussion_post', p.id, { thread: p.thread_title });
  res.json({ success: true });
}));

discussionsRouter.delete('/threads/:id', ah(async (req, res) => {
  const t = await threadCtx(req.params.id);
  if (t.created_by !== req.user!.id && !canModerate(req.user!, t)) throw forbidden();
  await query('DELETE FROM discussion_threads WHERE id = $1', [t.id]);
  res.json({ success: true });
}));

// ---- Reporting & moderation (FR-AD5) ----
discussionsRouter.post('/posts/:id/report', validate(z.object({ reason: z.string().trim().min(3).max(500) })), ah(async (req, res) => {
  const p = await postCtx(req.params.id);
  await assertCourseViewer(req.user!, p.course_id);
  await query('UPDATE discussion_posts SET is_flagged = TRUE, flag_reason = $1, flagged_by = $2 WHERE id = $3', [req.body.reason, req.user!.id, p.id]);
  const admins = await many<{ user_id: string }>(`SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'`);
  await notifyMany([...new Set([p.instructor_id, ...admins.map((a) => a.user_id)])], {
    title: 'Post reported', body: `A post in "${p.thread_title}" was reported: ${req.body.reason}`, type: 'system', link: '/admin/moderation',
  });
  res.json({ success: true, message: 'Thanks — a moderator will review this post.' });
}));

/** Course instructor (own course) or admin (any course): dismiss report, hide, or delete. */
export async function moderatePost(user: AuthUser, postId: string, action: 'dismiss' | 'hide' | 'unhide' | 'delete') {
  const p = await postCtx(postId);
  if (!canModerate(user, p)) throw forbidden('Only the course instructor or an admin can moderate');
  if (action === 'delete') await query('DELETE FROM discussion_posts WHERE id = $1', [postId]);
  else if (action === 'hide') await query('UPDATE discussion_posts SET is_hidden = TRUE, is_flagged = FALSE WHERE id = $1', [postId]);
  else if (action === 'unhide') await query('UPDATE discussion_posts SET is_hidden = FALSE WHERE id = $1', [postId]);
  else await query('UPDATE discussion_posts SET is_flagged = FALSE, flag_reason = NULL WHERE id = $1', [postId]);
  await audit(user.id, `post.${action}`, 'discussion_post', postId, { thread: p.thread_title });
  if (action === 'hide' || action === 'delete') {
    await notify(p.user_id, { title: 'A post of yours was moderated', body: `Your post in "${p.thread_title}" was ${action === 'hide' ? 'hidden' : 'removed'} by a moderator.`, type: 'system' });
  }
}

discussionsRouter.put('/posts/:id/moderate', requireRole('instructor', 'admin'),
  validate(z.object({ action: z.enum(['dismiss', 'hide', 'unhide', 'delete']) })),
  ah(async (req, res) => {
    await moderatePost(req.user!, req.params.id, req.body.action);
    res.json({ success: true });
  }));

discussionsRouter.get('/instructor/flagged-posts', requireRole('instructor', 'admin'), ah(async (req, res) => {
  res.json({ data: await flaggedPosts(hasRole(req.user, 'admin') ? null : req.user!.id) });
}));

export async function flaggedPosts(instructorId: string | null) {
  return many(
    `SELECT p.id, p.content, p.flag_reason, p.created_at, p.is_hidden, t.id AS thread_id, t.title AS thread_title,
       c.id AS course_id, c.title AS course_title, u.full_name AS author_name, u.email AS author_email, fb.full_name AS reported_by
     FROM discussion_posts p JOIN discussion_threads t ON t.id = p.thread_id JOIN courses c ON c.id = t.course_id
     JOIN users u ON u.id = p.user_id LEFT JOIN users fb ON fb.id = p.flagged_by
     WHERE p.is_flagged AND ($1::uuid IS NULL OR c.instructor_id = $1) ORDER BY p.created_at DESC`,
    [instructorId],
  );
}

// ---- Announcements (FR-I6) ----
discussionsRouter.get('/courses/:id/announcements', ah(async (req, res) => {
  await assertCourseViewer(req.user!, req.params.id);
  res.json({ data: await many(
    `SELECT a.*, u.full_name AS author FROM announcements a JOIN users u ON u.id = a.posted_by WHERE a.course_id = $1 ORDER BY a.created_at DESC`,
    [req.params.id],
  ) });
}));

discussionsRouter.post('/courses/:id/announcements', requireRole('instructor', 'admin'),
  validate(z.object({ title: z.string().trim().min(3).max(200), content: z.string().trim().min(1).max(10000), email: z.boolean().optional() })),
  ah(async (req, res) => {
    const course = await assertCourseManager(req.user!, req.params.id);
    const a = await one('INSERT INTO announcements (course_id, posted_by, title, content) VALUES ($1,$2,$3,$4) RETURNING *', [
      course.id, req.user!.id, req.body.title, req.body.content,
    ]);
    const students = await many<{ user_id: string }>('SELECT user_id FROM enrollments WHERE course_id = $1', [course.id]);
    await notifyMany(students.map((s) => s.user_id), {
      title: `${course.title}: ${req.body.title}`, body: req.body.content.slice(0, 280), type: 'announcement',
      link: `/app/learn/${course.id}?tab=announcements`, email: req.body.email ?? true,
    });
    res.status(201).json({ ...a, notified: students.length });
  }));

discussionsRouter.delete('/announcements/:id', requireRole('instructor', 'admin'), ah(async (req, res) => {
  const a = await one('SELECT course_id FROM announcements WHERE id = $1', [req.params.id]);
  if (!a) throw notFound('Announcement');
  await assertCourseManager(req.user!, a.course_id);
  await query('DELETE FROM announcements WHERE id = $1', [req.params.id]);
  res.json({ success: true });
}));

discussionsRouter.get('/announcements/me', ah(async (req, res) => {
  res.json({ data: await many(
    `SELECT a.*, c.title AS course_title, u.full_name AS author FROM announcements a
     JOIN enrollments e ON e.course_id = a.course_id AND e.user_id = $1 JOIN courses c ON c.id = a.course_id JOIN users u ON u.id = a.posted_by
     ORDER BY a.created_at DESC LIMIT 50`,
    [req.user!.id],
  ) });
}));

export { getCourse };
