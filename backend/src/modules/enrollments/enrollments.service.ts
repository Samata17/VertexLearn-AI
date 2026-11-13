import { many, one, query, transaction } from '../../db/pool.js';
import type { AuthUser } from '../../middleware/auth.js';
import { fileUrl } from '../../lib/storage.js';
import { queueCertificate } from '../../jobs/queues.js';
import { AppError, badRequest, conflict, forbidden, notFound } from '../../utils/errors.js';
import { awardBadge, recordActivity } from '../gamification/gamification.service.js';
import { notify } from '../notifications/notify.js';
import { assertCourseViewer, courseIdForLecture, getCourse } from '../courses/access.js';
import { invalidateCatalog, presentLecture } from '../courses/courses.service.js';

/**
 * Enroll a student. Paid courses go through a DEMO checkout: the payment gateway is out of scope
 * (PRD 3.2), so we record a "success" payment row to keep the revenue dashboard meaningful,
 * and the UI clearly labels it as a demo — no real money is taken.
 */
export async function enroll(user: AuthUser, courseId: string, confirmDemoPayment: boolean) {
  const course = await getCourse(courseId);
  if (course.status !== 'approved') throw notFound('Course');
  const existing = await one('SELECT id FROM enrollments WHERE user_id = $1 AND course_id = $2', [user.id, courseId]);
  if (existing) throw conflict('You are already enrolled in this course');
  if (course.price > 0 && !confirmDemoPayment) {
    throw new AppError(402, 'PAYMENT_REQUIRED', 'This is a paid course. Confirm the demo checkout to enroll.');
  }
  const enrollment = await transaction(async (c) => {
    if (course.price > 0) {
      await c.query(`INSERT INTO payments (user_id, course_id, amount, status) VALUES ($1,$2,$3,'success')`, [
        user.id, courseId, course.price,
      ]);
    }
    const { rows } = await c.query('INSERT INTO enrollments (user_id, course_id) VALUES ($1,$2) RETURNING *', [user.id, courseId]);
    return rows[0];
  });
  await notify(user.id, {
    title: `Enrolled: ${course.title}`,
    body: 'Start your first lecture whenever you are ready. The AI tutor is available for this course.',
    type: 'course',
    link: `/app/learn/${courseId}`,
  });
  await recordActivity(user.id);
  await invalidateCatalog(courseId);
  return enrollment;
}

export async function myEnrollments(user: AuthUser) {
  const rows = await many(
    `SELECT e.id, e.course_id, e.enrolled_at, e.progress_percent, e.completed_at, e.last_lecture_id,
            c.title, c.category, c.difficulty, c.thumbnail_url, u.full_name AS instructor_name,
            (SELECT COUNT(*) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = c.id)::int AS lecture_count,
            (SELECT COUNT(*) FROM lecture_progress lp WHERE lp.enrollment_id = e.id AND lp.completed)::int AS completed_count,
            ll.title AS last_lecture_title,
            (SELECT MAX(lp.last_watched_at) FROM lecture_progress lp WHERE lp.enrollment_id = e.id) AS last_activity_at,
            cert.id AS certificate_id
     FROM enrollments e
     JOIN courses c ON c.id = e.course_id
     JOIN users u ON u.id = c.instructor_id
     LEFT JOIN lectures ll ON ll.id = e.last_lecture_id
     LEFT JOIN certificates cert ON cert.user_id = e.user_id AND cert.course_id = e.course_id
     WHERE e.user_id = $1
     ORDER BY COALESCE((SELECT MAX(lp.last_watched_at) FROM lecture_progress lp WHERE lp.enrollment_id = e.id), e.enrolled_at) DESC`,
    [user.id],
  );
  // "Next lecture" = the first not-yet-completed lecture in curriculum order.
  for (const r of rows) {
    const next = await one(
      `SELECT l.id, l.title FROM lectures l JOIN modules m ON m.id = l.module_id
       LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.enrollment_id = $1
       WHERE m.course_id = $2 AND COALESCE(lp.completed, false) = false
       ORDER BY m.order_index, l.order_index LIMIT 1`,
      [r.id, r.course_id],
    );
    r.next_lecture = next ?? null;
    r.thumbnail_url = fileUrl(r.thumbnail_url);
  }
  return rows;
}

/** Everything the course player needs for one lecture. */
export async function getLectureForPlayer(user: AuthUser, lectureId: string) {
  const courseId = await courseIdForLecture(lectureId);
  const { course, enrollment } = await assertCourseViewer(user, courseId);
  const lecture = await one(
    `SELECT l.*, m.title AS module_title, m.id AS module_id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE l.id = $1`,
    [lectureId],
  );
  const ordered = await many<{ id: string }>(
    `SELECT l.id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1 ORDER BY m.order_index, l.order_index`,
    [courseId],
  );
  const idx = ordered.findIndex((o) => o.id === lectureId);
  const progress = enrollment
    ? await one('SELECT watched_seconds, max_watched_seconds, completed, time_spent_seconds FROM lecture_progress WHERE enrollment_id = $1 AND lecture_id = $2', [enrollment.id, lectureId])
    : null;
  const notes = await many('SELECT * FROM notes WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds NULLS LAST, created_at', [user.id, lectureId]);
  const bookmarks = await many('SELECT * FROM bookmarks WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds', [user.id, lectureId]);
  return {
    lecture: presentLecture(lecture),
    course: { id: course.id, title: course.title },
    prev_lecture_id: idx > 0 ? ordered[idx - 1].id : null,
    next_lecture_id: idx >= 0 && idx < ordered.length - 1 ? ordered[idx + 1].id : null,
    progress: progress ?? { watched_seconds: 0, max_watched_seconds: 0, completed: false, time_spent_seconds: 0 },
    notes,
    bookmarks,
    is_preview: !enrollment,
  };
}

/**
 * Progress update, called by the player every ~10s and on pause/end.
 *  position_seconds — current playback position (used to resume later, FR-S4)
 *  delta_seconds    — seconds actually watched since the last update (time-on-task, FR-I5)
 *  completed        — explicit "mark complete" (e.g. lectures with no video)
 * A lecture auto-completes once 90% of it has been watched.
 */
export async function updateProgress(user: AuthUser, lectureId: string, body: { position_seconds?: number; delta_seconds?: number; completed?: boolean }) {
  const courseId = await courseIdForLecture(lectureId);
  const enrollment = await one<{ id: string; completed_at: string | null }>(
    'SELECT id, completed_at FROM enrollments WHERE user_id = $1 AND course_id = $2',
    [user.id, courseId],
  );
  if (!enrollment) throw forbidden('Enroll in this course to track progress');
  const lecture = (await one<{ duration_seconds: number | null }>('SELECT duration_seconds FROM lectures WHERE id = $1', [lectureId]))!;

  const pos = Math.max(0, Math.round(body.position_seconds ?? 0));
  const delta = Math.min(60, Math.max(0, Math.round(body.delta_seconds ?? 0))); // clamp: ignore bogus jumps
  const autoComplete = lecture.duration_seconds ? pos >= lecture.duration_seconds * 0.9 : false;

  const before = await one<{ completed: boolean }>('SELECT completed FROM lecture_progress WHERE enrollment_id = $1 AND lecture_id = $2', [enrollment.id, lectureId]);
  const row = await one(
    `INSERT INTO lecture_progress (enrollment_id, lecture_id, watched_seconds, max_watched_seconds, time_spent_seconds, completed, last_watched_at)
     VALUES ($1, $2, $3, $3, $4, $5, now())
     ON CONFLICT (enrollment_id, lecture_id) DO UPDATE SET
       watched_seconds = $3,
       max_watched_seconds = GREATEST(lecture_progress.max_watched_seconds, $3),
       time_spent_seconds = lecture_progress.time_spent_seconds + $4,
       completed = lecture_progress.completed OR $5,
       last_watched_at = now()
     RETURNING *`,
    [enrollment.id, lectureId, pos, delta, !!body.completed || autoComplete],
  );
  await query('UPDATE enrollments SET last_lecture_id = $1 WHERE id = $2', [lectureId, enrollment.id]);

  const justCompleted = row.completed && !before?.completed;
  let progressPercent: number | undefined;
  if (justCompleted) {
    const p = (await one<{ pct: number }>(
      `SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE lp.completed) / NULLIF(t.total, 0), 2) AS pct
       FROM (SELECT COUNT(*) AS total FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = $2) t
       LEFT JOIN lecture_progress lp ON lp.enrollment_id = $1
       GROUP BY t.total`,
      [enrollment.id, courseId],
    ))!;
    progressPercent = Number(p?.pct ?? 0);
    await query('UPDATE enrollments SET progress_percent = $1 WHERE id = $2', [progressPercent, enrollment.id]);
    await awardBadge(user.id, 'first_lecture');
    if (progressPercent >= 100 && !enrollment.completed_at) await completeCourse(user.id, courseId, enrollment.id);
  }
  await recordActivity(user.id, delta / 60);
  return { ...row, just_completed: justCompleted, progress_percent: progressPercent };
}

/** 100% complete → certificate (PDF generated by the worker), badge, notification (FR-S8). */
async function completeCourse(userId: string, courseId: string, enrollmentId: string) {
  await query('UPDATE enrollments SET completed_at = now() WHERE id = $1', [enrollmentId]);
  await queueCertificate(userId, courseId);
  await awardBadge(userId, 'first_course');
  const c = await one<{ title: string }>('SELECT title FROM courses WHERE id = $1', [courseId]);
  await notify(userId, {
    title: `Course completed: ${c?.title}`,
    body: 'Congratulations! Your certificate is being generated and will appear in Achievements shortly.',
    type: 'course',
    link: '/app/achievements',
    email: true,
  });
}

// ---------------------------------------------------------------------------
// Notes & bookmarks (FR-S5)
// ---------------------------------------------------------------------------
async function assertLectureAccess(user: AuthUser, lectureId: string) {
  const courseId = await courseIdForLecture(lectureId);
  await assertCourseViewer(user, courseId);
}

export async function addNote(user: AuthUser, lectureId: string, content: string, ts?: number) {
  await assertLectureAccess(user, lectureId);
  return one('INSERT INTO notes (user_id, lecture_id, content, timestamp_seconds) VALUES ($1,$2,$3,$4) RETURNING *', [user.id, lectureId, content, ts ?? null]);
}

export async function listNotes(user: AuthUser, lectureId: string) {
  return many('SELECT * FROM notes WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds NULLS LAST, created_at', [user.id, lectureId]);
}

export async function updateNote(user: AuthUser, noteId: string, content: string) {
  const n = await one('UPDATE notes SET content = $1 WHERE id = $2 AND user_id = $3 RETURNING *', [content, noteId, user.id]);
  if (!n) throw notFound('Note');
  return n;
}

export async function deleteNote(user: AuthUser, noteId: string) {
  const r = await query('DELETE FROM notes WHERE id = $1 AND user_id = $2', [noteId, user.id]);
  if (!r.rowCount) throw notFound('Note');
}

export async function myNotes(user: AuthUser, q?: string) {
  return many(
    `SELECT n.*, l.title AS lecture_title, c.id AS course_id, c.title AS course_title
     FROM notes n JOIN lectures l ON l.id = n.lecture_id JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
     WHERE n.user_id = $1 AND ($2::text IS NULL OR n.content ILIKE '%' || $2 || '%')
     ORDER BY n.created_at DESC LIMIT 200`,
    [user.id, q || null],
  );
}

export async function addBookmark(user: AuthUser, lectureId: string, ts: number, label?: string) {
  await assertLectureAccess(user, lectureId);
  if (ts < 0) throw badRequest('timestamp_seconds must be positive', 'timestamp_seconds');
  return one('INSERT INTO bookmarks (user_id, lecture_id, timestamp_seconds, label) VALUES ($1,$2,$3,$4) RETURNING *', [user.id, lectureId, ts, label ?? null]);
}

export async function listBookmarks(user: AuthUser, lectureId: string) {
  return many('SELECT * FROM bookmarks WHERE user_id = $1 AND lecture_id = $2 ORDER BY timestamp_seconds', [user.id, lectureId]);
}

export async function deleteBookmark(user: AuthUser, id: string) {
  const r = await query('DELETE FROM bookmarks WHERE id = $1 AND user_id = $2', [id, user.id]);
  if (!r.rowCount) throw notFound('Bookmark');
}

export async function myBookmarks(user: AuthUser) {
  return many(
    `SELECT b.*, l.title AS lecture_title, c.id AS course_id, c.title AS course_title
     FROM bookmarks b JOIN lectures l ON l.id = b.lecture_id JOIN modules m ON m.id = l.module_id JOIN courses c ON c.id = m.course_id
     WHERE b.user_id = $1 ORDER BY b.created_at DESC LIMIT 200`,
    [user.id],
  );
}
