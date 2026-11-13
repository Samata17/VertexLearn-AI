import crypto from 'node:crypto';
import { cached, invalidatePrefix } from '../../config/redis.js';
import { many, one, query, transaction } from '../../db/pool.js';
import { hasRole, type AuthUser } from '../../middleware/auth.js';
import { audit } from '../../lib/audit.js';
import { deleteObject, displayName, fileUrl, putObject } from '../../lib/storage.js';
import { queueIngest } from '../../jobs/queues.js';
import { conflict, forbidden, notFound } from '../../utils/errors.js';
import { notify, notifyMany } from '../notifications/notify.js';
import { assertCourseManager, courseIdForLecture, courseIdForModule, getCourse, isOwnerOrAdmin } from './access.js';

// ---------------------------------------------------------------------------
// Catalog (public, cached 5 minutes in Redis — PRD 9.4)
// ---------------------------------------------------------------------------
export interface CatalogQuery {
  q?: string;
  category?: string;
  difficulty?: string;
  min_rating?: number;
  price?: 'free' | 'paid';
  sort?: 'popular' | 'rating' | 'newest' | 'price_asc' | 'price_desc';
  page: number;
  limit: number;
}

const COURSE_CARD_SQL = `
  SELECT c.id, c.title, c.description, c.category, c.difficulty, c.thumbnail_url, c.price, c.status, c.created_at,
         json_build_object('id', u.id, 'full_name', u.full_name, 'avatar_url', u.avatar_url) AS instructor,
         COALESCE(r.avg_rating, 0)::float AS rating, COALESCE(r.review_count, 0)::int AS review_count,
         COALESCE(e.enrollment_count, 0)::int AS enrollment_count,
         COALESCE(l.lecture_count, 0)::int AS lecture_count, COALESCE(l.total_seconds, 0)::int AS total_seconds,
         COALESCE(l.module_count, 0)::int AS module_count
  FROM courses c
  JOIN users u ON u.id = c.instructor_id
  LEFT JOIN (SELECT course_id, ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(*) AS review_count
             FROM course_reviews GROUP BY course_id) r ON r.course_id = c.id
  LEFT JOIN (SELECT course_id, COUNT(*) AS enrollment_count FROM enrollments GROUP BY course_id) e ON e.course_id = c.id
  LEFT JOIN (SELECT m.course_id, COUNT(DISTINCT m.id) AS module_count, COUNT(lec.id) AS lecture_count,
                    SUM(COALESCE(lec.duration_seconds, 0)) AS total_seconds
             FROM modules m LEFT JOIN lectures lec ON lec.module_id = m.id GROUP BY m.course_id) l ON l.course_id = c.id`;

export const mapCard = (row: any) => ({
  ...row,
  thumbnail_url: fileUrl(row.thumbnail_url),
  instructor: row.instructor ? { ...row.instructor, avatar_url: fileUrl(row.instructor.avatar_url) } : null,
});

export async function listCatalog(q: CatalogQuery) {
  const key = `catalog:${crypto.createHash('md5').update(JSON.stringify(q)).digest('hex')}`;
  return cached(key, 300, async () => {
    const where: string[] = [`c.status = 'approved'`];
    const params: unknown[] = [];
    const p = (v: unknown) => {
      params.push(v);
      return `$${params.length}`;
    };
    if (q.q) {
      const like = p(`%${q.q}%`);
      where.push(`(c.title ILIKE ${like} OR c.description ILIKE ${like} OR c.category ILIKE ${like} OR u.full_name ILIKE ${like})`);
    }
    if (q.category) where.push(`c.category = ${p(q.category)}`);
    if (q.difficulty) where.push(`c.difficulty = ${p(q.difficulty)}`);
    if (q.min_rating) where.push(`COALESCE(r.avg_rating, 0) >= ${p(q.min_rating)}`);
    if (q.price === 'free') where.push('c.price = 0');
    if (q.price === 'paid') where.push('c.price > 0');

    const order = {
      popular: 'enrollment_count DESC, rating DESC',
      rating: 'rating DESC, review_count DESC',
      newest: 'c.created_at DESC',
      price_asc: 'c.price ASC',
      price_desc: 'c.price DESC',
    }[q.sort ?? 'popular'];

    const base = `${COURSE_CARD_SQL} WHERE ${where.join(' AND ')}`;
    const total = (await one<{ n: number }>(`SELECT COUNT(*) AS n FROM (${base}) t`, params))!.n;
    const rows = await many(`${base} ORDER BY ${order} LIMIT ${p(q.limit)} OFFSET ${p((q.page - 1) * q.limit)}`, params);
    return { data: rows.map(mapCard), page: q.page, limit: q.limit, total, total_pages: Math.ceil(total / q.limit) };
  });
}

export async function listCategories() {
  return cached('catalog:categories', 300, () =>
    many(
      `SELECT category AS name, COUNT(*)::int AS count FROM courses
       WHERE status = 'approved' AND category IS NOT NULL GROUP BY category ORDER BY count DESC, name`,
    ),
  );
}

export const invalidateCatalog = (courseId?: string) =>
  Promise.all([invalidatePrefix('catalog:'), courseId ? invalidatePrefix(`course:${courseId}`) : null]);

// ---------------------------------------------------------------------------
// Course detail
// ---------------------------------------------------------------------------
async function loadCurriculum(courseId: string) {
  const modules = await many(
    `SELECT m.id, m.title, m.order_index,
       COALESCE(json_agg(json_build_object(
         'id', l.id, 'title', l.title, 'duration_seconds', l.duration_seconds, 'order_index', l.order_index,
         'has_video', l.video_url IS NOT NULL, 'resource_count', COALESCE(array_length(l.resource_urls, 1), 0),
         'has_transcript', l.transcript IS NOT NULL AND length(l.transcript) > 0, 'ingest_status', l.ingest_status
       ) ORDER BY l.order_index) FILTER (WHERE l.id IS NOT NULL), '[]') AS lectures
     FROM modules m LEFT JOIN lectures l ON l.module_id = m.id
     WHERE m.course_id = $1 GROUP BY m.id ORDER BY m.order_index`,
    [courseId],
  );
  return modules;
}

export async function getCourseDetail(courseId: string, user?: AuthUser) {
  const base = await one(`${COURSE_CARD_SQL} WHERE c.id = $1`, [courseId]);
  if (!base) throw notFound('Course');
  const manager = user ? isOwnerOrAdmin(user, base.instructor ? { instructor_id: base.instructor.id } : { instructor_id: '' }) : false;
  if (base.status !== 'approved' && !manager) throw notFound('Course');

  const extra = await one(
    `SELECT c.learning_outcomes, u.bio AS instructor_bio,
       (SELECT COUNT(*) FROM courses c2 WHERE c2.instructor_id = c.instructor_id AND c2.status = 'approved')::int AS instructor_courses
     FROM courses c JOIN users u ON u.id = c.instructor_id WHERE c.id = $1`,
    [courseId],
  );
  const modules = await loadCurriculum(courseId);

  let enrollment = null;
  if (user) {
    enrollment = await one(
      `SELECT id, progress_percent, enrolled_at, completed_at, last_lecture_id FROM enrollments WHERE user_id = $1 AND course_id = $2`,
      [user.id, courseId],
    );
    if (enrollment) {
      const done = await many<{ lecture_id: string }>(
        'SELECT lecture_id FROM lecture_progress WHERE enrollment_id = $1 AND completed',
        [enrollment.id],
      );
      const set = new Set(done.map((d) => d.lecture_id));
      for (const m of modules) for (const l of m.lectures) l.completed = set.has(l.id);
    }
  }
  const approval = manager
    ? await one('SELECT decision, comment, reviewed_at FROM course_approvals WHERE course_id = $1 ORDER BY reviewed_at DESC LIMIT 1', [courseId])
    : null;
  const ratingBreakdown = await many(
    'SELECT rating, COUNT(*)::int AS count FROM course_reviews WHERE course_id = $1 GROUP BY rating',
    [courseId],
  );

  return {
    ...mapCard(base),
    learning_outcomes: extra?.learning_outcomes ?? [],
    instructor: { ...mapCard(base).instructor, bio: extra?.instructor_bio, course_count: extra?.instructor_courses },
    modules,
    enrollment,
    is_manager: manager,
    latest_review: approval,
    rating_breakdown: ratingBreakdown,
  };
}

// ---------------------------------------------------------------------------
// Authoring
// ---------------------------------------------------------------------------
export interface CourseInput {
  title: string;
  description?: string;
  category?: string;
  difficulty?: 'beginner' | 'intermediate' | 'advanced';
  price?: number;
  learning_outcomes?: string[];
}

export async function createCourse(user: AuthUser, input: CourseInput) {
  const c = await one(
    `INSERT INTO courses (instructor_id, title, description, category, difficulty, price, learning_outcomes, status)
     VALUES ($1,$2,$3,$4,$5,$6,$7,'pending') RETURNING *`,
    [user.id, input.title, input.description ?? null, input.category ?? null, input.difficulty ?? 'beginner',
     input.price ?? 0, input.learning_outcomes ?? []],
  );
  // Let admins know there's a course to review (PRD FR-AD1).
  const admins = await many<{ user_id: string }>(
    `SELECT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id WHERE r.name = 'admin'`,
  );
  await notifyMany(admins.map((a) => a.user_id), {
    title: 'New course awaiting approval',
    body: `"${input.title}" was submitted for review.`,
    type: 'course',
    link: '/admin/courses',
  });
  await audit(user.id, 'course.create', 'course', c.id, { title: c.title });
  return c;
}

export async function updateCourse(user: AuthUser, courseId: string, input: Partial<CourseInput> & { archived?: boolean; resubmit?: boolean }) {
  const course = await assertCourseManager(user, courseId);
  const fields: string[] = [];
  const params: unknown[] = [];
  const set = (col: string, v: unknown) => {
    params.push(v);
    fields.push(`${col} = $${params.length}`);
  };
  for (const k of ['title', 'description', 'category', 'difficulty', 'price', 'learning_outcomes'] as const) {
    if (input[k] !== undefined) set(k, input[k]);
  }
  // Status transitions an instructor is allowed to make:
  if (input.archived === true) set('status', 'archived');
  else if (input.archived === false && course.status === 'archived') set('status', 'pending'); // re-review on restore
  else if (input.resubmit && course.status === 'rejected') set('status', 'pending');
  if (!fields.length) return getCourse(courseId);

  params.push(courseId);
  const updated = await one(`UPDATE courses SET ${fields.join(', ')}, updated_at = now() WHERE id = $${params.length} RETURNING *`, params);
  await invalidateCatalog(courseId);
  return updated;
}

export async function deleteCourse(user: AuthUser, courseId: string) {
  const course = await assertCourseManager(user, courseId);
  const { n } = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM enrollments WHERE course_id = $1', [courseId]))!;
  if (n > 0 && !hasRole(user, 'admin')) {
    throw conflict(`This course has ${n} enrolled student(s). Archive it instead of deleting.`);
  }
  await query('DELETE FROM courses WHERE id = $1', [courseId]);
  await invalidateCatalog(courseId);
  await audit(user.id, 'course.delete', 'course', courseId, { title: course.title });
}

export async function setThumbnail(user: AuthUser, courseId: string, file: Express.Multer.File) {
  await assertCourseManager(user, courseId);
  const old = await one('SELECT thumbnail_url FROM courses WHERE id = $1', [courseId]);
  const key = await putObject('public/thumbnails', file.originalname, file.buffer, file.mimetype);
  await query('UPDATE courses SET thumbnail_url = $1, updated_at = now() WHERE id = $2', [key, courseId]);
  await deleteObject(old?.thumbnail_url);
  await invalidateCatalog(courseId);
  return { thumbnail_url: fileUrl(key) };
}

export async function listInstructorCourses(user: AuthUser) {
  const rows = await many(
    `${COURSE_CARD_SQL} WHERE c.instructor_id = $1 ORDER BY c.created_at DESC`,
    [user.id],
  );
  return rows.map(mapCard);
}

// ---------------------------------------------------------------------------
// Modules & lectures
// ---------------------------------------------------------------------------
export async function addModule(user: AuthUser, courseId: string, title: string) {
  await assertCourseManager(user, courseId);
  const m = await one(
    `INSERT INTO modules (course_id, title, order_index)
     VALUES ($1, $2, (SELECT COALESCE(MAX(order_index), 0) + 1 FROM modules WHERE course_id = $1)) RETURNING *`,
    [courseId, title],
  );
  await invalidateCatalog(courseId);
  return m;
}

export async function updateModule(user: AuthUser, moduleId: string, title: string) {
  const courseId = await courseIdForModule(moduleId);
  await assertCourseManager(user, courseId);
  await invalidateCatalog(courseId);
  return one('UPDATE modules SET title = $1 WHERE id = $2 RETURNING *', [title, moduleId]);
}

export async function deleteModule(user: AuthUser, moduleId: string) {
  const courseId = await courseIdForModule(moduleId);
  await assertCourseManager(user, courseId);
  await query('DELETE FROM modules WHERE id = $1', [moduleId]);
  await invalidateCatalog(courseId);
}

/** Reorder modules (ids in new order) or lectures within a module. */
export async function reorder(user: AuthUser, kind: 'modules' | 'lectures', parentId: string, ids: string[]) {
  const courseId = kind === 'modules' ? parentId : await courseIdForModule(parentId);
  await assertCourseManager(user, courseId);
  const parentCol = kind === 'modules' ? 'course_id' : 'module_id';
  await transaction(async (c) => {
    for (let i = 0; i < ids.length; i++) {
      await c.query(`UPDATE ${kind} SET order_index = $1 WHERE id = $2 AND ${parentCol} = $3`, [i + 1, ids[i], parentId]);
    }
  });
  await invalidateCatalog(courseId);
}

export interface LectureInput {
  title?: string;
  transcript?: string | null;
  duration_seconds?: number | null;
  video_url?: string | null; // external URL alternative to uploading a file
  remove_resources?: string[];
  remove_video?: boolean;
}

interface LectureFiles {
  video?: Express.Multer.File[];
  resources?: Express.Multer.File[];
}

async function storeLectureFiles(files: LectureFiles) {
  const video = files.video?.[0] ? await putObject('lectures/videos', files.video[0].originalname, files.video[0].buffer, files.video[0].mimetype) : null;
  const resources: string[] = [];
  for (const f of files.resources ?? []) resources.push(await putObject('lectures/resources', f.originalname, f.buffer, f.mimetype));
  return { video, resources };
}

export async function addLecture(user: AuthUser, moduleId: string, input: LectureInput & { title: string }, files: LectureFiles) {
  const courseId = await courseIdForModule(moduleId);
  await assertCourseManager(user, courseId);
  const stored = await storeLectureFiles(files);
  const needsIngest = !!(input.transcript?.trim() || stored.resources.length);
  const lecture = await one(
    `INSERT INTO lectures (module_id, title, video_url, transcript, duration_seconds, order_index, resource_urls, ingest_status)
     VALUES ($1,$2,$3,$4,$5,(SELECT COALESCE(MAX(order_index),0)+1 FROM lectures WHERE module_id = $1),$6,$7) RETURNING *`,
    [moduleId, input.title, stored.video ?? input.video_url ?? null, input.transcript ?? null, input.duration_seconds ?? null,
     stored.resources, needsIngest ? 'queued' : 'none'],
  );
  if (needsIngest) await queueIngest(lecture.id);
  await recalcCourseProgress(courseId);
  await invalidateCatalog(courseId);
  return presentLecture(lecture);
}

export async function updateLecture(user: AuthUser, lectureId: string, input: LectureInput, files: LectureFiles) {
  const courseId = await courseIdForLecture(lectureId);
  await assertCourseManager(user, courseId);
  const current = (await one('SELECT * FROM lectures WHERE id = $1', [lectureId]))!;
  const stored = await storeLectureFiles(files);

  let video = current.video_url;
  if (stored.video || input.remove_video || input.video_url !== undefined) {
    if (video?.startsWith('s3://')) await deleteObject(video);
    video = stored.video ?? (input.remove_video ? null : input.video_url ?? null);
  }
  const removed = new Set(input.remove_resources ?? []);
  const kept = (current.resource_urls ?? []).filter((r: string) => !removed.has(r));
  for (const r of removed) await deleteObject(r);
  const resources = [...kept, ...stored.resources];

  const transcriptChanged = input.transcript !== undefined && input.transcript !== current.transcript;
  const resourcesChanged = removed.size > 0 || stored.resources.length > 0;
  const needsIngest = transcriptChanged || resourcesChanged;

  const lecture = await one(
    `UPDATE lectures SET title = $1, video_url = $2, transcript = $3, duration_seconds = $4, resource_urls = $5,
       ingest_status = CASE WHEN $6 THEN 'queued' ELSE ingest_status END
     WHERE id = $7 RETURNING *`,
    [input.title ?? current.title, video, input.transcript !== undefined ? input.transcript : current.transcript,
     input.duration_seconds !== undefined ? input.duration_seconds : current.duration_seconds, resources, needsIngest, lectureId],
  );
  if (needsIngest) await queueIngest(lectureId);
  await invalidateCatalog(courseId);
  return presentLecture(lecture);
}

export async function deleteLecture(user: AuthUser, lectureId: string) {
  const courseId = await courseIdForLecture(lectureId);
  await assertCourseManager(user, courseId);
  const l = await one('SELECT video_url, resource_urls FROM lectures WHERE id = $1', [lectureId]);
  await query('DELETE FROM lectures WHERE id = $1', [lectureId]);
  await deleteObject(l?.video_url);
  for (const r of l?.resource_urls ?? []) await deleteObject(r);
  await recalcCourseProgress(courseId);
  await invalidateCatalog(courseId);
}

export async function reingestLecture(user: AuthUser, lectureId: string) {
  const courseId = await courseIdForLecture(lectureId);
  await assertCourseManager(user, courseId);
  await query(`UPDATE lectures SET ingest_status = 'queued' WHERE id = $1`, [lectureId]);
  await queueIngest(lectureId);
  return { status: 'queued' };
}

/** Converts DB storage keys into browser-usable (signed) URLs. */
export function presentLecture(l: any) {
  return {
    ...l,
    video_url: fileUrl(l.video_url),
    resources: (l.resource_urls ?? []).map((r: string) => ({ key: r, name: displayName(r), url: fileUrl(r) })),
  };
}

/** Lecture added/removed → everyone's % changes. Keeps enrollment.progress_percent correct. */
export async function recalcCourseProgress(courseId: string) {
  await query(
    `UPDATE enrollments e SET progress_percent = COALESCE((
       SELECT ROUND(100.0 * COUNT(*) FILTER (WHERE lp.completed) / NULLIF((SELECT COUNT(*) FROM lectures l JOIN modules m ON m.id = l.module_id WHERE m.course_id = $1), 0), 2)
       FROM lecture_progress lp JOIN lectures l ON l.id = lp.lecture_id JOIN modules m ON m.id = l.module_id
       WHERE lp.enrollment_id = e.id AND m.course_id = $1), 0)
     WHERE e.course_id = $1`,
    [courseId],
  );
}

// ---------------------------------------------------------------------------
// Approval (admin) — PRD FR-AD1
// ---------------------------------------------------------------------------
export async function reviewCourse(admin: AuthUser, courseId: string, decision: 'approved' | 'rejected', comment?: string) {
  const course = await getCourse(courseId);
  await transaction(async (c) => {
    await c.query('UPDATE courses SET status = $1, updated_at = now() WHERE id = $2', [decision, courseId]);
    await c.query('INSERT INTO course_approvals (course_id, reviewed_by, decision, comment) VALUES ($1,$2,$3,$4)', [
      courseId, admin.id, decision, comment ?? null,
    ]);
  });
  await notify(course.instructor_id, {
    title: decision === 'approved' ? `Course approved: ${course.title}` : `Changes requested: ${course.title}`,
    body: decision === 'approved'
      ? 'Your course is now live in the catalog.'
      : `An admin rejected this course${comment ? `: ${comment}` : '.'} Update it and resubmit.`,
    type: 'course',
    link: `/instructor/courses/${courseId}`,
    email: true,
  });
  await audit(admin.id, `course.${decision}`, 'course', courseId, { comment });
  await invalidateCatalog(courseId);
  return { id: courseId, status: decision };
}

// ---------------------------------------------------------------------------
// Reviews / ratings
// ---------------------------------------------------------------------------
export async function upsertReview(user: AuthUser, courseId: string, rating: number, comment?: string) {
  const enrolled = await one('SELECT 1 FROM enrollments WHERE user_id = $1 AND course_id = $2', [user.id, courseId]);
  if (!enrolled) throw forbidden('Only enrolled students can review a course');
  const r = await one(
    `INSERT INTO course_reviews (course_id, user_id, rating, comment) VALUES ($1,$2,$3,$4)
     ON CONFLICT (course_id, user_id) DO UPDATE SET rating = $3, comment = $4, created_at = now() RETURNING *`,
    [courseId, user.id, rating, comment ?? null],
  );
  await invalidateCatalog(courseId);
  return r;
}

export async function listReviews(courseId: string) {
  const rows = await many(
    `SELECT r.id, r.rating, r.comment, r.created_at, u.full_name, u.avatar_url
     FROM course_reviews r JOIN users u ON u.id = r.user_id WHERE r.course_id = $1 ORDER BY r.created_at DESC LIMIT 50`,
    [courseId],
  );
  return rows.map((r) => ({ ...r, avatar_url: fileUrl(r.avatar_url) }));
}
