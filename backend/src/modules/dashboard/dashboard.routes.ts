/**
 * Aggregated dashboard endpoints. One request returns everything a dashboard screen needs,
 * instead of the frontend making 10 separate calls.
 */
import { Router } from 'express';
import { many, one } from '../../db/pool.js';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { fileUrl } from '../../lib/storage.js';
import { ah } from '../../utils/http.js';
import { myEnrollments } from '../enrollments/enrollments.service.js';
import { assertCourseManager } from '../courses/access.js';

export const dashboardRouter = Router();
dashboardRouter.use(requireAuth);

// ---------------------------------------------------------------------------
// Student dashboard (PRD 5.1, FR-S2)
// ---------------------------------------------------------------------------
dashboardRouter.get('/dashboard/student', requireRole('student'), ah(async (req, res) => {
  const uid = req.user!.id;
  const enrollments = await myEnrollments(req.user!);
  const stats = await one(
    `SELECT
       (SELECT COUNT(*) FROM enrollments WHERE user_id = $1)::int AS enrolled,
       (SELECT COUNT(*) FROM enrollments WHERE user_id = $1 AND completed_at IS NOT NULL)::int AS completed,
       (SELECT COALESCE(ROUND(AVG(progress_percent), 1), 0) FROM enrollments WHERE user_id = $1)::float AS avg_progress,
       (SELECT COALESCE(SUM(minutes), 0) FROM user_activity_days WHERE user_id = $1)::int AS total_minutes,
       (SELECT COALESCE(SUM(minutes), 0) FROM user_activity_days WHERE user_id = $1 AND day > CURRENT_DATE - 7)::int AS week_minutes,
       (SELECT COUNT(*) FROM user_badges WHERE user_id = $1)::int AS badges,
       (SELECT COUNT(*) FROM badges)::int AS total_badges,
       (SELECT COUNT(*) FROM certificates WHERE user_id = $1)::int AS certificates,
       (SELECT ROUND(AVG(score), 1) FROM quiz_attempts WHERE user_id = $1 AND submitted_at IS NOT NULL)::float AS avg_quiz,
       (SELECT COUNT(*) FROM lecture_progress lp JOIN enrollments e ON e.id = lp.enrollment_id WHERE e.user_id = $1 AND lp.completed)::int AS lectures_completed`,
    [uid],
  );
  const streak = (await one('SELECT current_streak, longest_streak, last_active_date FROM streaks WHERE user_id = $1', [uid])) ?? {
    current_streak: 0, longest_streak: 0, last_active_date: null,
  };
  const activity = await many(
    `SELECT d::date::text AS day, COALESCE(a.minutes, 0)::int AS minutes
     FROM generate_series(CURRENT_DATE - 13, CURRENT_DATE, interval '1 day') d
     LEFT JOIN user_activity_days a ON a.user_id = $1 AND a.day = d::date ORDER BY d`,
    [uid],
  );
  const upcoming = await many(
    `SELECT a.id, a.title, a.due_date, c.id AS course_id, c.title AS course_title,
       EXISTS (SELECT 1 FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.user_id = $1) AS submitted
     FROM assignments a JOIN enrollments e ON e.course_id = a.course_id AND e.user_id = $1 JOIN courses c ON c.id = a.course_id
     WHERE a.due_date > now() ORDER BY a.due_date LIMIT 5`,
    [uid],
  );
  const quizTrend = await many(
    `SELECT a.score, a.submitted_at, q.title AS quiz_title FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id
     WHERE a.user_id = $1 AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC LIMIT 10`,
    [uid],
  );
  // Recent activity feed: a UNION of the different things a student does.
  const recent = await many(
    `SELECT * FROM (
       SELECT 'lecture' AS kind, l.title AS title, c.title AS context, lp.last_watched_at AS at, '/app/learn/' || c.id || '/' || l.id AS link
         FROM lecture_progress lp JOIN enrollments e ON e.id = lp.enrollment_id JOIN lectures l ON l.id = lp.lecture_id
         JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1 AND lp.completed
       UNION ALL
       SELECT 'quiz', q.title, 'Scored ' || ROUND(a.score) || '%', a.submitted_at, '/app/quizzes/results/' || a.id
         FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id WHERE a.user_id = $1 AND a.submitted_at IS NOT NULL
       UNION ALL
       SELECT 'submission', asg.title, CASE WHEN s.grade IS NULL THEN 'Submitted' ELSE 'Graded ' || s.grade || '/' || asg.max_score END,
              s.submitted_at, '/app/assignments/' || asg.id
         FROM assignment_submissions s JOIN assignments asg ON asg.id = s.assignment_id WHERE s.user_id = $1
       UNION ALL
       SELECT 'badge', b.name, b.description, ub.earned_at, '/app/achievements'
         FROM user_badges ub JOIN badges b ON b.id = ub.badge_id WHERE ub.user_id = $1
       UNION ALL
       SELECT 'enroll', c.title, 'Enrolled', e.enrolled_at, '/app/learn/' || c.id
         FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1
     ) t WHERE at IS NOT NULL ORDER BY at DESC LIMIT 8`,
    [uid],
  );
  const announcements = await many(
    `SELECT an.id, an.title, an.content, an.created_at, c.id AS course_id, c.title AS course_title, u.full_name AS author
     FROM announcements an JOIN enrollments e ON e.course_id = an.course_id AND e.user_id = $1
     JOIN courses c ON c.id = an.course_id JOIN users u ON u.id = an.posted_by ORDER BY an.created_at DESC LIMIT 3`,
    [uid],
  );
  const mastery = await many(
    `SELECT m.title AS module_title, c.title AS course_title, tm.score FROM topic_mastery tm
     JOIN modules m ON m.id = tm.module_id JOIN courses c ON c.id = m.course_id
     WHERE tm.user_id = $1 AND EXISTS (SELECT 1 FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.user_id = $1 AND q.module_id = m.id)
     ORDER BY tm.updated_at DESC LIMIT 8`,
    [uid],
  );
  const badges = await many(
    `SELECT b.code, b.name, b.description, b.icon_url, ub.earned_at FROM user_badges ub JOIN badges b ON b.id = ub.badge_id
     WHERE ub.user_id = $1 ORDER BY ub.earned_at DESC LIMIT 4`,
    [uid],
  );
  res.json({
    stats, streak, activity, enrollments,
    continue_learning: enrollments.filter((e: any) => !e.completed_at).slice(0, 3),
    upcoming_assignments: upcoming, quiz_trend: quizTrend.reverse(), recent_activity: recent, announcements, mastery, badges,
  });
}));

// ---------------------------------------------------------------------------
// Instructor dashboard & analytics (FR-I5)
// ---------------------------------------------------------------------------
dashboardRouter.get('/instructor/analytics/overview', requireRole('instructor', 'admin'), ah(async (req, res) => {
  const uid = req.user!.id;
  const stats = await one(
    `SELECT
       (SELECT COUNT(*) FROM courses WHERE instructor_id = $1)::int AS courses,
       (SELECT COUNT(*) FROM courses WHERE instructor_id = $1 AND status = 'approved')::int AS live_courses,
       (SELECT COUNT(*) FROM courses WHERE instructor_id = $1 AND status = 'pending')::int AS pending_courses,
       (SELECT COUNT(DISTINCT e.user_id) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.instructor_id = $1)::int AS students,
       (SELECT COUNT(*) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.instructor_id = $1)::int AS enrollments,
       (SELECT COALESCE(ROUND(AVG(e.progress_percent), 1), 0) FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE c.instructor_id = $1)::float AS avg_progress,
       (SELECT ROUND(AVG(a.score), 1) FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
         WHERE c.instructor_id = $1 AND a.submitted_at IS NOT NULL)::float AS avg_quiz,
       (SELECT COUNT(*) FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id
         WHERE c.instructor_id = $1 AND s.grade IS NULL)::int AS to_grade,
       (SELECT COALESCE(SUM(p.amount), 0) FROM payments p JOIN courses c ON c.id = p.course_id WHERE c.instructor_id = $1 AND p.status = 'success')::float AS revenue,
       (SELECT ROUND(AVG(r.rating)::numeric, 2) FROM course_reviews r JOIN courses c ON c.id = r.course_id WHERE c.instructor_id = $1)::float AS avg_rating`,
    [uid],
  );
  const enrollTrend = await many(
    `SELECT to_char(d, 'YYYY-MM-DD') AS day, COUNT(e.id)::int AS enrollments
     FROM generate_series(CURRENT_DATE - 29, CURRENT_DATE, interval '1 day') d
     LEFT JOIN enrollments e ON e.enrolled_at::date = d::date AND e.course_id IN (SELECT id FROM courses WHERE instructor_id = $1)
     GROUP BY d ORDER BY d`,
    [uid],
  );
  const courses = await many(
    `SELECT c.id, c.title, c.status, c.thumbnail_url,
       (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id)::int AS students,
       (SELECT COALESCE(ROUND(AVG(progress_percent), 1), 0) FROM enrollments e WHERE e.course_id = c.id)::float AS avg_progress,
       (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id AND e.completed_at IS NOT NULL)::int AS completions,
       (SELECT ROUND(AVG(a.score), 1) FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id
         WHERE m.course_id = c.id AND a.submitted_at IS NOT NULL)::float AS avg_quiz
     FROM courses c WHERE c.instructor_id = $1 ORDER BY students DESC`,
    [uid],
  );
  const recentSubmissions = await many(
    `SELECT s.id, s.submitted_at, s.grade, u.full_name, a.title AS assignment_title, c.title AS course_title, a.id AS assignment_id
     FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id JOIN users u ON u.id = s.user_id
     WHERE c.instructor_id = $1 ORDER BY s.submitted_at DESC LIMIT 6`,
    [uid],
  );
  const draftQuizzes = await many(
    `SELECT q.id, q.title, c.id AS course_id, c.title AS course_title FROM quizzes q JOIN modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
     WHERE c.instructor_id = $1 AND q.status = 'draft' ORDER BY q.created_at DESC LIMIT 5`,
    [uid],
  );
  res.json({
    stats, enroll_trend: enrollTrend,
    courses: courses.map((c) => ({ ...c, thumbnail_url: fileUrl(c.thumbnail_url) })),
    recent_submissions: recentSubmissions, draft_quizzes: draftQuizzes,
  });
}));

dashboardRouter.get('/instructor/courses/:id/analytics', requireRole('instructor', 'admin'), ah(async (req, res) => {
  const courseId = req.params.id;
  await assertCourseManager(req.user!, courseId);
  // Per-lecture drop-off: what share of enrolled students started / completed each lecture, plus avg time-on-task.
  const lectures = await many(
    `SELECT l.id, l.title, m.title AS module_title, l.duration_seconds,
       COUNT(lp.id)::int AS started,
       COUNT(lp.id) FILTER (WHERE lp.completed)::int AS completed,
       COALESCE(ROUND(AVG(lp.time_spent_seconds)), 0)::int AS avg_time_seconds,
       COALESCE(ROUND(AVG(CASE WHEN l.duration_seconds > 0 THEN LEAST(100, 100.0 * lp.max_watched_seconds / l.duration_seconds) END), 1), 0)::float AS avg_watch_percent
     FROM lectures l JOIN modules m ON m.id = l.module_id
     LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id
     WHERE m.course_id = $1 GROUP BY l.id, m.order_index, m.title ORDER BY m.order_index, l.order_index`,
    [courseId],
  );
  const total = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM enrollments WHERE course_id = $1', [courseId]))!.n;
  const quizzes = await many(
    `SELECT q.id, q.title, COUNT(a.id)::int AS attempts, ROUND(AVG(a.score), 1)::float AS avg_score,
       MIN(a.score)::float AS min_score, MAX(a.score)::float AS max_score
     FROM quizzes q JOIN modules m ON m.id = q.module_id LEFT JOIN quiz_attempts a ON a.quiz_id = q.id AND a.submitted_at IS NOT NULL
     WHERE m.course_id = $1 GROUP BY q.id, m.order_index ORDER BY m.order_index, q.title`,
    [courseId],
  );
  // Topic-level struggle (PRD 2.2: "where students are struggling, at a topic level")
  const topics = await many(
    `SELECT m.id, m.title, ROUND(AVG(tm.score), 1)::float AS avg_mastery, COALESCE(SUM(tm.questions_asked), 0)::int AS ai_questions,
       COUNT(tm.user_id)::int AS students
     FROM modules m LEFT JOIN topic_mastery tm ON tm.module_id = m.id WHERE m.course_id = $1 GROUP BY m.id ORDER BY m.order_index`,
    [courseId],
  );
  const students = await many(
    `SELECT u.id, u.full_name, u.email, e.progress_percent, e.enrolled_at, e.completed_at,
       (SELECT ROUND(AVG(a.score), 1) FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id
         WHERE m.course_id = $1 AND a.user_id = u.id AND a.submitted_at IS NOT NULL)::float AS avg_quiz,
       (SELECT COALESCE(SUM(lp.time_spent_seconds), 0) FROM lecture_progress lp WHERE lp.enrollment_id = e.id)::int AS time_spent_seconds,
       (SELECT MAX(lp.last_watched_at) FROM lecture_progress lp WHERE lp.enrollment_id = e.id) AS last_active_at
     FROM enrollments e JOIN users u ON u.id = e.user_id WHERE e.course_id = $1 ORDER BY e.progress_percent DESC`,
    [courseId],
  );
  res.json({
    total_students: total,
    lectures: lectures.map((l) => ({ ...l, completion_rate: total ? Math.round((l.completed / total) * 1000) / 10 : 0 })),
    quizzes, topics, students,
  });
}));
