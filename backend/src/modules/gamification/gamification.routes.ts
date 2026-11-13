import { Router } from 'express';
import { cached } from '../../config/redis.js';
import { many, one } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { issueCertificate } from '../../lib/certificate.js';
import { fileUrl, getObjectBuffer } from '../../lib/storage.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { hasRole } from '../../middleware/auth.js';
import { getRecommendations } from './recommendations.service.js';
import { assertCourseViewer } from '../courses/access.js';

export const gamificationPublicRouter = Router();
export const gamificationRouter = Router();
gamificationRouter.use(requireAuth);

gamificationRouter.get('/users/me/badges', ah(async (req, res) => {
  const rows = await many(
    `SELECT b.id, b.code, b.name, b.description, b.icon_url, ub.earned_at
     FROM badges b LEFT JOIN user_badges ub ON ub.badge_id = b.id AND ub.user_id = $1 ORDER BY ub.earned_at NULLS LAST, b.id`,
    [req.user!.id],
  );
  res.json({ data: rows.map((r) => ({ ...r, earned: !!r.earned_at })) });
}));

gamificationRouter.get('/users/me/streak', ah(async (req, res) => {
  const s = await one('SELECT current_streak, longest_streak, last_active_date FROM streaks WHERE user_id = $1', [req.user!.id]);
  const days = await many(
    `SELECT day, minutes FROM user_activity_days WHERE user_id = $1 AND day > CURRENT_DATE - 91 ORDER BY day`,
    [req.user!.id],
  );
  res.json({ ...(s ?? { current_streak: 0, longest_streak: 0, last_active_date: null }), activity: days });
}));

gamificationRouter.get('/recommendations/me', requireRole('student'), ah(async (req, res) => res.json(await getRecommendations(req.user!.id))));

/**
 * Leaderboard points = 10 per completed lecture + best score of each quiz + 50 per completed course.
 * Cached 60s in Redis (PRD 9.4).
 */
const POINTS_SQL = `
  SELECT u.id AS user_id, u.full_name, u.avatar_url,
    (COALESCE(lec.cnt, 0) * 10 + COALESCE(qz.pts, 0) + COALESCE(done.cnt, 0) * 50)::int AS points,
    COALESCE(lec.cnt, 0)::int AS lectures_completed, COALESCE(qz.avg, 0)::float AS avg_quiz, COALESCE(st.current_streak, 0) AS streak
  FROM users u
  JOIN (SELECT DISTINCT e.user_id FROM enrollments e WHERE ($1::uuid IS NULL OR e.course_id = $1)) eu ON eu.user_id = u.id
  LEFT JOIN (SELECT e.user_id, COUNT(*) AS cnt FROM lecture_progress lp JOIN enrollments e ON e.id = lp.enrollment_id
             WHERE lp.completed AND ($1::uuid IS NULL OR e.course_id = $1) GROUP BY e.user_id) lec ON lec.user_id = u.id
  LEFT JOIN (SELECT b.user_id, SUM(b.best) AS pts, ROUND(AVG(b.best), 1) AS avg FROM (
               SELECT a.user_id, a.quiz_id, MAX(a.score) AS best FROM quiz_attempts a
               JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id
               WHERE a.submitted_at IS NOT NULL AND ($1::uuid IS NULL OR m.course_id = $1) GROUP BY a.user_id, a.quiz_id) b
             GROUP BY b.user_id) qz ON qz.user_id = u.id
  LEFT JOIN (SELECT user_id, COUNT(*) AS cnt FROM enrollments WHERE completed_at IS NOT NULL AND ($1::uuid IS NULL OR course_id = $1) GROUP BY user_id) done ON done.user_id = u.id
  LEFT JOIN streaks st ON st.user_id = u.id
  WHERE u.is_active AND u.deleted_at IS NULL
  ORDER BY points DESC, u.full_name LIMIT 50`;

async function leaderboard(courseId: string | null) {
  const rows = await cached(`leaderboard:${courseId ?? 'global'}`, 60, () => many(POINTS_SQL, [courseId]));
  return rows.map((r, i) => ({ ...r, rank: i + 1, avatar_url: fileUrl(r.avatar_url) }));
}

gamificationRouter.get('/leaderboard', ah(async (req, res) => {
  const data = await leaderboard(null);
  res.json({ data, me: data.find((r) => r.user_id === req.user!.id) ?? null });
}));
gamificationRouter.get('/leaderboard/:courseId', ah(async (req, res) => {
  await assertCourseViewer(req.user!, req.params.courseId);
  const data = await leaderboard(req.params.courseId);
  res.json({ data, me: data.find((r) => r.user_id === req.user!.id) ?? null });
}));

// ---- Certificates (FR-S8) ----
gamificationRouter.get('/certificates/me', ah(async (req, res) => {
  const rows = await many(
    `SELECT ct.id, ct.certificate_code, ct.issued_at, ct.certificate_url IS NOT NULL AS ready, c.id AS course_id, c.title AS course_title,
       u.full_name AS instructor_name
     FROM certificates ct JOIN courses c ON c.id = ct.course_id JOIN users u ON u.id = c.instructor_id
     WHERE ct.user_id = $1 ORDER BY ct.issued_at DESC`,
    [req.user!.id],
  );
  // Completed courses whose certificate the worker hasn't produced yet show as "generating".
  const pending = await many(
    `SELECT e.course_id, c.title AS course_title FROM enrollments e JOIN courses c ON c.id = e.course_id
     WHERE e.user_id = $1 AND e.completed_at IS NOT NULL AND NOT EXISTS (SELECT 1 FROM certificates ct WHERE ct.user_id = e.user_id AND ct.course_id = e.course_id)`,
    [req.user!.id],
  );
  res.json({ data: rows, pending });
}));

gamificationRouter.get('/certificates/:id/download', ah(async (req, res) => {
  const cert = await one('SELECT * FROM certificates WHERE id = $1', [req.params.id]);
  if (!cert) throw notFound('Certificate');
  if (cert.user_id !== req.user!.id && !hasRole(req.user, 'admin')) throw forbidden();
  const ready = cert.certificate_url ? cert : await issueCertificate(cert.user_id, cert.course_id);
  const pdf = await getObjectBuffer(ready.certificate_url.slice(5));
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="VertexLearn-Certificate-${cert.certificate_code}.pdf"`);
  res.send(pdf);
}));

/** Generate on demand if the background job hasn't run yet (e.g. worker not started). */
gamificationRouter.post('/certificates/generate/:courseId', ah(async (req, res) => {
  const e = await one('SELECT completed_at FROM enrollments WHERE user_id = $1 AND course_id = $2', [req.user!.id, req.params.courseId]);
  if (!e?.completed_at) throw forbidden('Complete the course to earn its certificate');
  res.json(await issueCertificate(req.user!.id, req.params.courseId));
}));

// Public verification page data
gamificationPublicRouter.get('/certificates/verify/:code', ah(async (req, res) => {
  const c = await one(
    `SELECT ct.certificate_code, ct.issued_at, u.full_name AS student_name, c.title AS course_title, i.full_name AS instructor_name
     FROM certificates ct JOIN users u ON u.id = ct.user_id JOIN courses c ON c.id = ct.course_id JOIN users i ON i.id = c.instructor_id
     WHERE ct.certificate_code = $1`,
    [req.params.code.toUpperCase()],
  );
  if (!c) throw notFound('Certificate');
  res.json({ valid: true, ...c });
}));
