/**
 * Quiz engine (FR-S7): MCQ, multi-select and short-answer questions with automatic grading.
 *  - mcq:          correct if the single selected option is the correct one
 *  - multi_select: correct only if the selected set exactly equals the correct set
 *  - short_answer: correct if the normalised text equals any accepted answer
 *                  (case, extra spaces and punctuation are ignored)
 * After grading, the module's topic-mastery score is updated (FR-A8).
 */
import type pg from 'pg';
import { many, one, query, transaction } from '../../db/pool.js';
import { hasRole, type AuthUser } from '../../middleware/auth.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { awardBadge, recordActivity } from '../gamification/gamification.service.js';
import { notifyMany } from '../notifications/notify.js';
import { assertCourseManager, assertCourseViewer, courseIdForModule, getCourse, isOwnerOrAdmin } from '../courses/access.js';

export type QuestionType = 'mcq' | 'multi_select' | 'short_answer';
export interface QuestionInput {
  question_text: string;
  question_type: QuestionType;
  explanation?: string;
  options: { option_text: string; is_correct: boolean }[];
}
export interface QuizInput {
  module_id: string;
  title: string;
  time_limit_minutes?: number | null;
  status?: 'draft' | 'published';
  is_ai_generated?: boolean;
  generated_from_lecture_id?: string | null;
  questions: QuestionInput[];
}

export function validateQuestions(questions: QuestionInput[]) {
  questions.forEach((q, i) => {
    const n = i + 1;
    const correct = q.options.filter((o) => o.is_correct).length;
    if (q.question_type === 'short_answer') {
      if (correct < 1) throw badRequest(`Question ${n}: add at least one accepted answer`, `questions.${i}`);
    } else {
      if (q.options.length < 2) throw badRequest(`Question ${n}: needs at least 2 options`, `questions.${i}`);
      if (q.question_type === 'mcq' && correct !== 1) throw badRequest(`Question ${n}: multiple-choice needs exactly 1 correct option`, `questions.${i}`);
      if (q.question_type === 'multi_select' && correct < 1) throw badRequest(`Question ${n}: mark at least 1 correct option`, `questions.${i}`);
    }
  });
}

export async function insertQuestions(c: pg.PoolClient, quizId: string, questions: QuestionInput[]) {
  for (let i = 0; i < questions.length; i++) {
    const q = questions[i];
    const { rows } = await c.query(
      'INSERT INTO quiz_questions (quiz_id, question_text, question_type, order_index, explanation) VALUES ($1,$2,$3,$4,$5) RETURNING id',
      [quizId, q.question_text, q.question_type, i + 1, q.explanation ?? null],
    );
    for (const o of q.options) {
      await c.query('INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES ($1,$2,$3)', [rows[0].id, o.option_text, o.is_correct]);
    }
  }
}

export async function createQuiz(user: AuthUser, input: QuizInput) {
  const courseId = await courseIdForModule(input.module_id);
  const course = await assertCourseManager(user, courseId);
  validateQuestions(input.questions);
  const status = input.status ?? 'published';
  const quiz = await transaction(async (c) => {
    const { rows } = await c.query(
      `INSERT INTO quizzes (module_id, title, time_limit_minutes, status, is_ai_generated, generated_from_lecture_id)
       VALUES ($1,$2,$3,$4,$5,$6) RETURNING *`,
      [input.module_id, input.title, input.time_limit_minutes ?? null, status, !!input.is_ai_generated, input.generated_from_lecture_id ?? null],
    );
    await insertQuestions(c, rows[0].id, input.questions);
    return rows[0];
  });
  if (status === 'published') await announceQuiz(courseId, course.title, quiz);
  return getQuizFull(quiz.id);
}

async function announceQuiz(courseId: string, courseTitle: string, quiz: { id: string; title: string }) {
  const students = await many<{ user_id: string }>('SELECT user_id FROM enrollments WHERE course_id = $1', [courseId]);
  await notifyMany(students.map((s) => s.user_id), {
    title: `New quiz: ${quiz.title}`,
    body: courseTitle,
    type: 'course',
    link: `/app/quizzes/${quiz.id}`,
  });
}

async function quizContext(quizId: string) {
  const q = await one(
    `SELECT q.*, m.course_id, m.title AS module_title FROM quizzes q JOIN modules m ON m.id = q.module_id WHERE q.id = $1`,
    [quizId],
  );
  if (!q) throw notFound('Quiz');
  return q;
}

/** Full quiz including correct answers — managers only. */
export async function getQuizFull(quizId: string) {
  const quiz = await quizContext(quizId);
  const questions = await many(
    `SELECT qq.id, qq.question_text, qq.question_type, qq.order_index, qq.explanation,
       COALESCE(json_agg(json_build_object('id', o.id, 'option_text', o.option_text, 'is_correct', o.is_correct)) FILTER (WHERE o.id IS NOT NULL), '[]') AS options
     FROM quiz_questions qq LEFT JOIN quiz_options o ON o.question_id = qq.id
     WHERE qq.quiz_id = $1 GROUP BY qq.id ORDER BY qq.order_index`,
    [quizId],
  );
  return { ...quiz, questions };
}

/** Student-safe quiz: no is_correct flags; short-answer accepted answers are hidden entirely. */
async function getQuizForStudent(quizId: string) {
  const full = await getQuizFull(quizId);
  return {
    ...full,
    questions: full.questions.map((q: any) => ({
      ...q,
      explanation: undefined,
      options: q.question_type === 'short_answer' ? [] : q.options.map((o: any) => ({ id: o.id, option_text: o.option_text })),
    })),
  };
}

export async function getQuiz(user: AuthUser, quizId: string) {
  const quiz = await quizContext(quizId);
  const { manager } = await assertCourseViewer(user, quiz.course_id);
  if (manager) return { ...(await getQuizFull(quizId)), is_manager: true };
  if (quiz.status !== 'published') throw notFound('Quiz');
  const attempts = await many(
    'SELECT id, score, started_at, submitted_at FROM quiz_attempts WHERE quiz_id = $1 AND user_id = $2 ORDER BY started_at DESC',
    [quizId, user.id],
  );
  const q = await getQuizForStudent(quizId);
  return { ...q, questions: undefined, question_count: q.questions.length, attempts, is_manager: false };
}

export async function updateQuiz(user: AuthUser, quizId: string, input: Partial<QuizInput>) {
  const quiz = await quizContext(quizId);
  const course = await assertCourseManager(user, quiz.course_id);
  if (input.questions) validateQuestions(input.questions);
  await transaction(async (c) => {
    await c.query(
      `UPDATE quizzes SET title = COALESCE($1, title), time_limit_minutes = CASE WHEN $2::boolean THEN $3::int ELSE time_limit_minutes END,
         status = COALESCE($4, status) WHERE id = $5`,
      [input.title ?? null, input.time_limit_minutes !== undefined, input.time_limit_minutes ?? null, input.status ?? null, quizId],
    );
    if (input.questions) {
      await c.query('DELETE FROM quiz_questions WHERE quiz_id = $1', [quizId]);
      await insertQuestions(c, quizId, input.questions);
    }
  });
  // An AI draft being approved (draft → published) is announced to students (FR-I4).
  if (quiz.status === 'draft' && input.status === 'published') await announceQuiz(quiz.course_id, course.title, quiz);
  return getQuizFull(quizId);
}

export async function deleteQuiz(user: AuthUser, quizId: string) {
  const quiz = await quizContext(quizId);
  await assertCourseManager(user, quiz.course_id);
  await query('DELETE FROM quizzes WHERE id = $1', [quizId]);
}

export async function listCourseQuizzes(user: AuthUser, courseId: string) {
  const { manager } = await assertCourseViewer(user, courseId);
  return many(
    `SELECT q.id, q.title, q.status, q.is_ai_generated, q.time_limit_minutes, q.created_at, q.module_id, m.title AS module_title,
       (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id)::int AS question_count,
       (SELECT MAX(score) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = $2 AND a.submitted_at IS NOT NULL) AS best_score,
       (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = $2 AND a.submitted_at IS NOT NULL)::int AS my_attempts,
       (SELECT ROUND(AVG(score), 1) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.submitted_at IS NOT NULL) AS avg_score,
       (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.submitted_at IS NOT NULL)::int AS attempt_count
     FROM quizzes q JOIN modules m ON m.id = q.module_id
     WHERE m.course_id = $1 AND ($3::boolean OR q.status = 'published')
     ORDER BY m.order_index, q.created_at`,
    [courseId, user.id, manager],
  );
}

/** Student quizzes across all enrolled courses. */
export async function myQuizzes(user: AuthUser) {
  return many(
    `SELECT q.id, q.title, q.time_limit_minutes, m.title AS module_title, c.id AS course_id, c.title AS course_title,
       (SELECT COUNT(*) FROM quiz_questions qq WHERE qq.quiz_id = q.id)::int AS question_count,
       (SELECT MAX(score) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = $1 AND a.submitted_at IS NOT NULL) AS best_score,
       (SELECT COUNT(*) FROM quiz_attempts a WHERE a.quiz_id = q.id AND a.user_id = $1 AND a.submitted_at IS NOT NULL)::int AS my_attempts
     FROM quizzes q JOIN modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
     JOIN enrollments e ON e.course_id = c.id AND e.user_id = $1
     WHERE q.status = 'published' ORDER BY c.title, m.order_index, q.created_at`,
    [user.id],
  );
}

export async function startAttempt(user: AuthUser, quizId: string) {
  const quiz = await quizContext(quizId);
  if (quiz.status !== 'published') throw notFound('Quiz');
  const { manager } = await assertCourseViewer(user, quiz.course_id);
  if (manager && !hasRole(user, 'student')) throw forbidden('Only students attempt quizzes');
  const attempt = await one('INSERT INTO quiz_attempts (quiz_id, user_id) VALUES ($1,$2) RETURNING *', [quizId, user.id]);
  return { attempt, quiz: await getQuizForStudent(quizId) };
}

const normalise = (s: string) => s.toLowerCase().replace(/[^\p{L}\p{N}\s.]/gu, '').replace(/\s+/g, ' ').trim();

export async function submitAttempt(
  user: AuthUser,
  attemptId: string,
  answers: { question_id: string; selected_option_ids?: string[]; text_answer?: string }[],
) {
  const attempt = await one('SELECT * FROM quiz_attempts WHERE id = $1', [attemptId]);
  if (!attempt || attempt.user_id !== user.id) throw notFound('Attempt');
  if (attempt.submitted_at) throw badRequest('This attempt was already submitted');
  const quiz = await getQuizFull(attempt.quiz_id);
  const byId = new Map(answers.map((a) => [a.question_id, a]));

  let correctCount = 0;
  const graded = quiz.questions.map((q: any) => {
    const a = byId.get(q.id);
    const correctIds = q.options.filter((o: any) => o.is_correct).map((o: any) => o.id as string);
    let isCorrect = false;
    if (q.question_type === 'short_answer') {
      const given = normalise(a?.text_answer ?? '');
      isCorrect = !!given && q.options.some((o: any) => o.is_correct && normalise(o.option_text) === given);
    } else {
      const selected = new Set(a?.selected_option_ids ?? []);
      isCorrect = selected.size === correctIds.length && correctIds.every((id: string) => selected.has(id));
      if (q.question_type === 'mcq') isCorrect = selected.size === 1 && isCorrect;
    }
    if (isCorrect) correctCount++;
    return { q, a, isCorrect, correctIds };
  });
  const score = quiz.questions.length ? Math.round((correctCount / quiz.questions.length) * 10000) / 100 : 0;

  await transaction(async (c) => {
    for (const g of graded) {
      await c.query(
        'INSERT INTO quiz_answers (attempt_id, question_id, selected_option_ids, text_answer, is_correct) VALUES ($1,$2,$3,$4,$5)',
        [attemptId, g.q.id, g.a?.selected_option_ids ?? [], g.a?.text_answer ?? null, g.isCorrect],
      );
    }
    await c.query('UPDATE quiz_attempts SET score = $1, submitted_at = now() WHERE id = $2', [score, attemptId]);
  });

  await updateMastery(user.id, quiz.module_id, score);
  if (score === 100) await awardBadge(user.id, 'perfect_quiz');
  const minutes = (Date.now() - new Date(attempt.started_at).getTime()) / 60000;
  await recordActivity(user.id, Math.min(minutes, 120));
  return getAttemptResult(user, attemptId);
}

/** Topic mastery = exponential moving average of quiz scores for that module (recent attempts weigh more). */
export async function updateMastery(userId: string, moduleId: string, score: number) {
  // The attempt being graded is already submitted, so "1" means this is the first quiz result for the module.
  const { n } = (await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM quiz_attempts qa JOIN quizzes qz ON qz.id = qa.quiz_id
     WHERE qa.user_id = $1 AND qz.module_id = $2 AND qa.submitted_at IS NOT NULL`,
    [userId, moduleId],
  ))!;
  const prev = await one<{ score: number }>('SELECT score FROM topic_mastery WHERE user_id = $1 AND module_id = $2', [userId, moduleId]);
  const next = n <= 1 || !prev ? score : Math.round((prev.score * 0.6 + score * 0.4) * 100) / 100;
  await query(
    `INSERT INTO topic_mastery (user_id, module_id, score, updated_at) VALUES ($1,$2,$3,now())
     ON CONFLICT (user_id, module_id) DO UPDATE SET score = $3, updated_at = now()`,
    [userId, moduleId, next],
  );
}

export async function getAttemptResult(user: AuthUser, attemptId: string) {
  const attempt = await one(
    `SELECT a.*, q.title AS quiz_title, q.module_id, m.course_id, c.title AS course_title, c.instructor_id
     FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
     WHERE a.id = $1`,
    [attemptId],
  );
  if (!attempt) throw notFound('Attempt');
  if (attempt.user_id !== user.id && !isOwnerOrAdmin(user, attempt)) throw forbidden();
  if (!attempt.submitted_at) throw badRequest('Attempt not submitted yet');
  const quiz = await getQuizFull(attempt.quiz_id);
  const answers = await many('SELECT * FROM quiz_answers WHERE attempt_id = $1', [attemptId]);
  const byQ = new Map(answers.map((a) => [a.question_id, a]));
  return {
    attempt: { id: attempt.id, score: attempt.score, started_at: attempt.started_at, submitted_at: attempt.submitted_at },
    quiz: { id: quiz.id, title: quiz.title, course_id: attempt.course_id, course_title: attempt.course_title },
    correct_count: answers.filter((a) => a.is_correct).length,
    total: quiz.questions.length,
    questions: quiz.questions.map((q: any) => ({ ...q, answer: byQ.get(q.id) ?? null })),
  };
}

/** Quiz score history (dashboard chart + study plan input). */
export async function myAttempts(user: AuthUser, courseId?: string) {
  return many(
    `SELECT a.id, a.score, a.started_at, a.submitted_at, q.id AS quiz_id, q.title AS quiz_title, m.title AS module_title,
            c.id AS course_id, c.title AS course_title
     FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id JOIN courses c ON c.id = m.course_id
     WHERE a.user_id = $1 AND a.submitted_at IS NOT NULL AND ($2::uuid IS NULL OR c.id = $2)
     ORDER BY a.submitted_at DESC LIMIT 200`,
    [user.id, courseId ?? null],
  );
}

export async function myMastery(user: AuthUser, courseId?: string) {
  return many(
    `SELECT tm.module_id, m.title AS module_title, c.id AS course_id, c.title AS course_title, tm.score, tm.questions_asked, tm.updated_at
     FROM topic_mastery tm JOIN modules m ON m.id = tm.module_id JOIN courses c ON c.id = m.course_id
     WHERE tm.user_id = $1 AND ($2::uuid IS NULL OR c.id = $2) ORDER BY tm.score`,
    [user.id, courseId ?? null],
  );
}

export { getCourse };
