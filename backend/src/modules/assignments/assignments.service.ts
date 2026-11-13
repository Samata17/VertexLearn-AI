import { many, one, query } from '../../db/pool.js';
import { hasRole, type AuthUser } from '../../middleware/auth.js';
import { fileUrl, putObject } from '../../lib/storage.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { awardBadge, recordActivity } from '../gamification/gamification.service.js';
import { notify, notifyMany } from '../notifications/notify.js';
import { assertCourseManager, assertCourseViewer, getCourse, isOwnerOrAdmin } from '../courses/access.js';

export interface AssignmentInput {
  course_id: string;
  title: string;
  instructions?: string;
  rubric?: { criterion: string; points: number }[];
  due_date?: string | null;
  max_score?: number;
}

async function assignmentCourse(assignmentId: string) {
  const a = await one('SELECT * FROM assignments WHERE id = $1', [assignmentId]);
  if (!a) throw notFound('Assignment');
  return a;
}

export async function createAssignment(user: AuthUser, input: AssignmentInput) {
  const course = await assertCourseManager(user, input.course_id);
  const rubricTotal = input.rubric?.reduce((s, r) => s + r.points, 0);
  const a = await one(
    `INSERT INTO assignments (course_id, title, instructions, rubric, due_date, max_score) VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
    [input.course_id, input.title, input.instructions ?? null, JSON.stringify(input.rubric ?? []), input.due_date ?? null,
     input.max_score ?? rubricTotal ?? 100],
  );
  const students = await many<{ user_id: string }>('SELECT user_id FROM enrollments WHERE course_id = $1', [input.course_id]);
  await notifyMany(students.map((s) => s.user_id), {
    title: `New assignment: ${input.title}`,
    body: `${course.title}${input.due_date ? ` — due ${new Date(input.due_date).toUTCString().slice(0, 16)}` : ''}`,
    type: 'assignment',
    link: `/app/assignments/${a.id}`,
  });
  return a;
}

export async function updateAssignment(user: AuthUser, id: string, input: Partial<AssignmentInput>) {
  const a = await assignmentCourse(id);
  await assertCourseManager(user, a.course_id);
  return one(
    `UPDATE assignments SET title = COALESCE($1, title), instructions = COALESCE($2, instructions),
       rubric = COALESCE($3, rubric), due_date = CASE WHEN $4::boolean THEN $5::timestamptz ELSE due_date END,
       max_score = COALESCE($6, max_score)
     WHERE id = $7 RETURNING *`,
    [input.title ?? null, input.instructions ?? null, input.rubric ? JSON.stringify(input.rubric) : null,
     input.due_date !== undefined, input.due_date ?? null, input.max_score ?? null, id],
  );
}

export async function deleteAssignment(user: AuthUser, id: string) {
  const a = await assignmentCourse(id);
  await assertCourseManager(user, a.course_id);
  await query('DELETE FROM assignments WHERE id = $1', [id]);
}

const presentSubmission = (s: any) => (s ? { ...s, file_url: fileUrl(s.file_url) } : null);

export async function listCourseAssignments(user: AuthUser, courseId: string) {
  const { manager } = await assertCourseViewer(user, courseId);
  const rows = await many(
    `SELECT a.*,
       (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id)::int AS submission_count,
       (SELECT COUNT(*) FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.grade IS NULL)::int AS ungraded_count,
       (SELECT row_to_json(s) FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.user_id = $2) AS my_submission
     FROM assignments a WHERE a.course_id = $1 ORDER BY a.due_date NULLS LAST, a.created_at`,
    [courseId, user.id],
  );
  return rows.map((r) => ({
    ...r,
    my_submission: presentSubmission(r.my_submission),
    ...(manager ? {} : { submission_count: undefined, ungraded_count: undefined }),
  }));
}

/** Student view: assignments across all enrolled courses (dashboard "upcoming assignments"). */
export async function myAssignments(user: AuthUser) {
  const rows = await many(
    `SELECT a.*, c.title AS course_title,
       (SELECT row_to_json(s) FROM assignment_submissions s WHERE s.assignment_id = a.id AND s.user_id = $1) AS my_submission
     FROM assignments a JOIN enrollments e ON e.course_id = a.course_id AND e.user_id = $1
     JOIN courses c ON c.id = a.course_id
     ORDER BY a.due_date NULLS LAST`,
    [user.id],
  );
  return rows.map((r) => ({ ...r, my_submission: presentSubmission(r.my_submission) }));
}

export async function getAssignment(user: AuthUser, id: string) {
  const a = await assignmentCourse(id);
  const { course, manager } = await assertCourseViewer(user, a.course_id);
  const mine = await one('SELECT * FROM assignment_submissions WHERE assignment_id = $1 AND user_id = $2', [id, user.id]);
  return { ...a, course_title: course.title, is_manager: manager, my_submission: presentSubmission(mine) };
}

/** FR-S6: student uploads a file before the deadline. Resubmitting replaces the previous file and clears the grade. */
export async function submit(user: AuthUser, id: string, file: Express.Multer.File | undefined, comment?: string) {
  const a = await assignmentCourse(id);
  await assertCourseViewer(user, a.course_id);
  if (!hasRole(user, 'student')) throw forbidden('Only students submit assignments');
  if (a.due_date && new Date(a.due_date) < new Date()) throw badRequest('The deadline for this assignment has passed');
  if (!file) throw badRequest('Attach a file to submit', 'file');

  const key = await putObject(`submissions/${id}`, file.originalname, file.buffer, file.mimetype);
  const s = await one(
    `INSERT INTO assignment_submissions (assignment_id, user_id, file_url, file_name, comment) VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (assignment_id, user_id) DO UPDATE SET file_url = $3, file_name = $4, comment = $5,
       submitted_at = now(), grade = NULL, feedback = NULL, graded_at = NULL, graded_by = NULL
     RETURNING *`,
    [id, user.id, key, file.originalname, comment ?? null],
  );
  await awardBadge(user.id, 'first_submission');
  await recordActivity(user.id);
  const course = await getCourse(a.course_id);
  await notify(course.instructor_id, {
    title: 'New submission',
    body: `A student submitted "${a.title}".`,
    type: 'assignment',
    link: `/instructor/grading?assignment=${id}`,
  });
  return presentSubmission(s);
}

export async function listSubmissions(user: AuthUser, assignmentId: string) {
  const a = await assignmentCourse(assignmentId);
  await assertCourseManager(user, a.course_id);
  const rows = await many(
    `SELECT s.*, u.full_name, u.email FROM assignment_submissions s JOIN users u ON u.id = s.user_id
     WHERE s.assignment_id = $1 ORDER BY s.grade IS NOT NULL, s.submitted_at`,
    [assignmentId],
  );
  return rows.map(presentSubmission);
}

/** Instructor grading queue across all of their courses (admins see everything). */
export async function gradingQueue(user: AuthUser, status: 'pending' | 'graded' | 'all', assignmentId?: string) {
  const rows = await many(
    `SELECT s.*, u.full_name, u.email, a.title AS assignment_title, a.max_score, a.rubric, a.due_date, c.id AS course_id, c.title AS course_title
     FROM assignment_submissions s
     JOIN assignments a ON a.id = s.assignment_id JOIN courses c ON c.id = a.course_id JOIN users u ON u.id = s.user_id
     WHERE ($1::boolean OR c.instructor_id = $2)
       AND ($3 = 'all' OR ($3 = 'pending' AND s.grade IS NULL) OR ($3 = 'graded' AND s.grade IS NOT NULL))
       AND ($4::uuid IS NULL OR a.id = $4)
     ORDER BY s.submitted_at DESC LIMIT 300`,
    [hasRole(user, 'admin'), user.id, status, assignmentId ?? null],
  );
  return rows.map(presentSubmission);
}

export async function grade(user: AuthUser, submissionId: string, gradeValue: number, feedback?: string) {
  const s = await one(
    `SELECT s.*, a.course_id, a.title, a.max_score FROM assignment_submissions s JOIN assignments a ON a.id = s.assignment_id WHERE s.id = $1`,
    [submissionId],
  );
  if (!s) throw notFound('Submission');
  const course = await getCourse(s.course_id);
  if (!isOwnerOrAdmin(user, course)) throw forbidden('Only the course instructor or an admin can grade this');
  if (gradeValue > s.max_score) throw badRequest(`Grade cannot exceed ${s.max_score}`, 'grade');
  const updated = await one(
    `UPDATE assignment_submissions SET grade = $1, feedback = $2, graded_at = now(), graded_by = $3 WHERE id = $4 RETURNING *`,
    [gradeValue, feedback ?? null, user.id, submissionId],
  );
  await notify(s.user_id, {
    title: `Graded: ${s.title}`,
    body: `You scored ${gradeValue}/${s.max_score}.${feedback ? ' Your instructor left feedback.' : ''}`,
    type: 'grade',
    link: `/app/assignments/${s.assignment_id}`,
    email: true,
  });
  return presentSubmission(updated);
}
