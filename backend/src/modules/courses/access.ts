/**
 * Ownership & access checks (PRD Section 11: "ownership checks happen at the service layer").
 * Route middleware decides *which roles* may call an endpoint; these helpers decide
 * whether *this* user may touch *this* course.
 */
import { one } from '../../db/pool.js';
import { hasRole, type AuthUser } from '../../middleware/auth.js';
import { forbidden, notFound } from '../../utils/errors.js';

export interface CourseRow {
  id: string;
  instructor_id: string;
  title: string;
  status: string;
  price: number;
}

export async function getCourse(courseId: string) {
  const c = await one<CourseRow>('SELECT id, instructor_id, title, status, price FROM courses WHERE id = $1', [courseId]);
  if (!c) throw notFound('Course');
  return c;
}

export const isOwnerOrAdmin = (user: AuthUser, course: { instructor_id: string }) =>
  hasRole(user, 'admin') || course.instructor_id === user.id;

/** Throws 403 unless the user is the course's instructor or an admin. */
export async function assertCourseManager(user: AuthUser, courseId: string) {
  const course = await getCourse(courseId);
  if (!isOwnerOrAdmin(user, course)) throw forbidden('Only the course instructor or an admin can do this');
  return course;
}

export async function courseIdForModule(moduleId: string) {
  const r = await one<{ course_id: string }>('SELECT course_id FROM modules WHERE id = $1', [moduleId]);
  if (!r) throw notFound('Module');
  return r.course_id;
}

export async function courseIdForLecture(lectureId: string) {
  const r = await one<{ course_id: string }>(
    'SELECT m.course_id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE l.id = $1',
    [lectureId],
  );
  if (!r) throw notFound('Lecture');
  return r.course_id;
}

export async function getEnrollment(userId: string, courseId: string) {
  return one<{ id: string; progress_percent: number; completed_at: string | null }>(
    'SELECT id, progress_percent, completed_at FROM enrollments WHERE user_id = $1 AND course_id = $2',
    [userId, courseId],
  );
}

/** Student must be enrolled; instructors/admins managing the course are also allowed (preview). */
export async function assertCourseViewer(user: AuthUser, courseId: string) {
  const course = await getCourse(courseId);
  if (isOwnerOrAdmin(user, course)) return { course, enrollment: null, manager: true };
  const enrollment = await getEnrollment(user.id, courseId);
  if (!enrollment) throw forbidden('Enroll in this course to access its content');
  return { course, enrollment, manager: false };
}

export async function assertEnrolled(user: AuthUser, courseId: string) {
  const enrollment = await getEnrollment(user.id, courseId);
  if (!enrollment) throw forbidden('Enroll in this course first');
  return enrollment;
}
