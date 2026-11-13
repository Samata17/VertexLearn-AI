/**
 * AI Tutor API (PRD 8.5). Responsibilities here: auth, RBAC, ownership, persistence.
 * The actual RAG + Gemini (Google Cloud Vertex AI) work happens in the Python AI service (ai-service/).
 */
import { Router } from 'express';
import { z } from 'zod';
import { cached } from '../../config/redis.js';
import { many, one, query, transaction } from '../../db/pool.js';
import { hasRole, requireAuth, requireRole } from '../../middleware/auth.js';
import { aiChatLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { badRequest, forbidden, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { awardBadge, recordActivity } from '../gamification/gamification.service.js';
import { assertCourseManager, assertCourseViewer, courseIdForLecture, courseIdForModule, getCourse } from '../courses/access.js';
import { createQuiz } from '../quizzes/quizzes.service.js';
import { callAI } from './aiClient.js';

const mode = z.enum(['beginner', 'intermediate', 'advanced']);
export const aiRouter = Router();
aiRouter.use('/ai', requireAuth);

aiRouter.get('/ai/status', ah(async (_req, res) => {
  try {
    const h = await cached('ai:status', 30, () => callAI('/health', undefined, 5000));
    res.json({ available: true, mode: h.mode, model: h.model });
  } catch {
    res.json({ available: false, mode: 'unavailable', model: null });
  }
}));

// ---------------------------------------------------------------------------
// Chat sessions (FR-A1, FR-A2, FR-A6)
// ---------------------------------------------------------------------------
/** Students (enrolled) and the course's instructor ("as reviewer", PRD 11) may chat. Admins may not. */
async function assertChatAccess(user: Express.Request['user'], courseId: string) {
  if (hasRole(user, 'admin') && !hasRole(user, 'student') && !hasRole(user, 'instructor')) {
    throw forbidden('The AI tutor is available to students and instructors');
  }
  return assertCourseViewer(user!, courseId);
}

async function sessionFor(userId: string, sessionId: string) {
  const s = await one(
    'SELECT s.*, c.title AS course_title FROM ai_chat_sessions s JOIN courses c ON c.id = s.course_id WHERE s.id = $1',
    [sessionId],
  );
  if (!s || s.user_id !== userId) throw notFound('Chat session');
  return s;
}

aiRouter.post('/ai/chat/sessions', validate(z.object({ course_id: z.string().uuid(), mode: mode.optional() })),
  ah(async (req, res) => {
    await assertChatAccess(req.user, req.body.course_id);
    // Default the mode from topic mastery: struggling students start in beginner mode (FR-A8).
    let m = req.body.mode;
    if (!m) {
      const avg = await one<{ avg: number | null }>(
        `SELECT AVG(tm.score)::float AS avg FROM topic_mastery tm JOIN modules mo ON mo.id = tm.module_id
         WHERE tm.user_id = $1 AND mo.course_id = $2 AND tm.score > 0`,
        [req.user!.id, req.body.course_id],
      );
      m = avg?.avg == null ? 'intermediate' : avg.avg < 50 ? 'beginner' : avg.avg >= 85 ? 'advanced' : 'intermediate';
    }
    const s = await one('INSERT INTO ai_chat_sessions (user_id, course_id, mode) VALUES ($1,$2,$3) RETURNING *', [req.user!.id, req.body.course_id, m]);
    res.status(201).json(s);
  }));

aiRouter.get('/ai/chat/sessions', ah(async (req, res) => {
  const rows = await many(
    `SELECT s.id, s.course_id, s.mode, s.title, s.created_at, c.title AS course_title,
       (SELECT MAX(created_at) FROM ai_chat_messages m WHERE m.session_id = s.id) AS last_message_at,
       (SELECT COUNT(*) FROM ai_chat_messages m WHERE m.session_id = s.id)::int AS message_count
     FROM ai_chat_sessions s JOIN courses c ON c.id = s.course_id
     WHERE s.user_id = $1 AND ($2::uuid IS NULL OR s.course_id = $2)
     ORDER BY COALESCE((SELECT MAX(created_at) FROM ai_chat_messages m WHERE m.session_id = s.id), s.created_at) DESC LIMIT 50`,
    [req.user!.id, (req.query.course_id as string) || null],
  );
  res.json({ data: rows });
}));

aiRouter.get('/ai/chat/sessions/:id', ah(async (req, res) => {
  const s = await sessionFor(req.user!.id, req.params.id);
  const messages = await many(
    'SELECT id, sender, content, sources, is_demo, created_at FROM ai_chat_messages WHERE session_id = $1 ORDER BY created_at',
    [s.id],
  );
  res.json({ session: s, messages });
}));

aiRouter.delete('/ai/chat/sessions/:id', ah(async (req, res) => {
  const s = await sessionFor(req.user!.id, req.params.id);
  await query('DELETE FROM ai_chat_sessions WHERE id = $1', [s.id]);
  res.json({ success: true });
}));

aiRouter.put('/ai/chat/sessions/:id/mode', validate(z.object({ mode })), ah(async (req, res) => {
  const s = await sessionFor(req.user!.id, req.params.id);
  res.json(await one('UPDATE ai_chat_sessions SET mode = $1 WHERE id = $2 RETURNING *', [req.body.mode, s.id]));
}));

aiRouter.post('/ai/chat/sessions/:id/messages', aiChatLimiter,
  validate(z.object({ message: z.string().trim().min(1, 'cannot be empty').max(4000), lecture_id: z.string().uuid().optional() })),
  ah(async (req, res) => {
    const s = await sessionFor(req.user!.id, req.params.id);
    await assertChatAccess(req.user, s.course_id);
    const history = await many<{ sender: string; content: string }>(
      'SELECT sender, content FROM ai_chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 8',
      [s.id],
    );
    const mastery = await many<{ module_id: string; score: number }>(
      `SELECT tm.module_id, tm.score FROM topic_mastery tm JOIN modules m ON m.id = tm.module_id
       WHERE tm.user_id = $1 AND m.course_id = $2 AND tm.score > 0`,
      [req.user!.id, s.course_id],
    );

    const userMsg = await one(
      `INSERT INTO ai_chat_messages (session_id, sender, content) VALUES ($1, 'user', $2) RETURNING id, sender, content, created_at`,
      [s.id, req.body.message],
    );
    if (!s.title) await query('UPDATE ai_chat_sessions SET title = $1 WHERE id = $2', [req.body.message.slice(0, 120), s.id]);

    let ai: any;
    try {
      ai = await callAI('/chat', {
        course_id: s.course_id,
        course_title: s.course_title,
        question: req.body.message,
        mode: s.mode,
        lecture_id: req.body.lecture_id,
        history: history.reverse().map((h) => ({ role: h.sender === 'ai' ? 'assistant' : 'user', content: h.content })),
        mastery: Object.fromEntries(mastery.map((m) => [m.module_id, m.score])),
      });
    } catch (err) {
      // Keep the conversation consistent: drop the unanswered question so a retry doesn't duplicate it.
      await query('DELETE FROM ai_chat_messages WHERE id = $1', [userMsg.id]);
      throw err;
    }

    const aiMsg = await one(
      `INSERT INTO ai_chat_messages (session_id, sender, content, source_lecture_ids, sources, is_demo)
       VALUES ($1, 'ai', $2, $3, $4, $5) RETURNING id, sender, content, sources, is_demo, created_at`,
      [s.id, ai.reply, [...new Set(ai.sources.map((x: any) => x.lecture_id))], JSON.stringify(ai.sources), ai.is_demo],
    );

    // PRD 9.2 step 5: update per-topic signals from this interaction.
    const modules = [...new Set(ai.sources.map((x: any) => x.module_id))] as string[];
    for (const moduleId of modules) {
      await query(
        `INSERT INTO topic_mastery (user_id, module_id, questions_asked) VALUES ($1,$2,1)
         ON CONFLICT (user_id, module_id) DO UPDATE SET questions_asked = topic_mastery.questions_asked + 1`,
        [req.user!.id, moduleId],
      );
    }
    const { n } = (await one<{ n: number }>(
      `SELECT COUNT(*) AS n FROM ai_chat_messages m JOIN ai_chat_sessions s ON s.id = m.session_id WHERE s.user_id = $1 AND m.sender = 'user'`,
      [req.user!.id],
    ))!;
    if (n >= 10) await awardBadge(req.user!.id, 'curious_mind');
    if (hasRole(req.user, 'student')) await recordActivity(req.user!.id, 1);

    res.json({ reply: ai.reply, sources: ai.sources, mode: ai.mode, is_demo: ai.is_demo, grounded: ai.grounded, user_message: userMsg, message: aiMsg });
  }));

// ---------------------------------------------------------------------------
// Summaries (FR-A3), quiz generation (FR-A5), flashcards (FR-A7), study plans (FR-A4)
// ---------------------------------------------------------------------------
aiRouter.post('/ai/lectures/:id/summarize', aiChatLimiter, ah(async (req, res) => {
  const courseId = await courseIdForLecture(req.params.id);
  await assertCourseViewer(req.user!, courseId);
  const lec = await one('SELECT ingest_status FROM lectures WHERE id = $1', [req.params.id]);
  // Cache per lecture; the key changes when the material is re-ingested. Demo-mode summaries (no Vertex AI,
  // or a fallback during an outage) are not cached, so a real summary appears as soon as live AI works.
  const data = await cached(
    `ai:summary:${req.params.id}:${lec?.ingest_status}`,
    6 * 3600,
    () => callAI<{ is_demo?: boolean }>('/summarize', { lecture_id: req.params.id }),
    (d) => !d.is_demo,
  );
  res.json(data);
}));

aiRouter.post('/ai/lectures/:id/generate-quiz', requireRole('instructor', 'admin'),
  validate(z.object({ num_questions: z.coerce.number().int().min(3).max(10).default(6), difficulty: mode.default('intermediate') })),
  ah(async (req, res) => {
    const courseId = await courseIdForLecture(req.params.id);
    await assertCourseManager(req.user!, courseId);
    const lec = (await one('SELECT id, module_id, title FROM lectures WHERE id = $1', [req.params.id]))!;
    const draft = await callAI('/generate-quiz', { lecture_id: lec.id, num_questions: req.body.num_questions, difficulty: req.body.difficulty });
    // Saved as a DRAFT: the instructor reviews/edits and then publishes (FR-I4).
    const quiz = await createQuiz(req.user!, {
      module_id: lec.module_id,
      title: draft.title,
      status: 'draft',
      is_ai_generated: true,
      generated_from_lecture_id: lec.id,
      questions: draft.questions,
    });
    res.status(201).json({ ...quiz, is_demo: draft.is_demo });
  }));

aiRouter.get('/ai/modules/:id/flashcards', ah(async (req, res) => {
  const courseId = await courseIdForModule(req.params.id);
  await assertCourseViewer(req.user!, courseId);
  const cards = await many('SELECT id, question, answer, is_demo, created_at FROM flashcards WHERE module_id = $1 ORDER BY created_at, id', [req.params.id]);
  res.json({ data: cards });
}));

aiRouter.post('/ai/modules/:id/flashcards', aiChatLimiter,
  validate(z.object({ count: z.coerce.number().int().min(3).max(25).default(10), regenerate: z.boolean().optional() })),
  ah(async (req, res) => {
    const courseId = await courseIdForModule(req.params.id);
    const { manager } = await assertCourseViewer(req.user!, courseId);
    const existing = await many('SELECT id, question, answer, is_demo, created_at FROM flashcards WHERE module_id = $1 ORDER BY created_at, id', [req.params.id]);
    // Students get the shared deck; only instructors can replace an existing deck.
    if (existing.length && !(manager && req.body.regenerate)) return res.json({ data: existing, generated: false });
    const out = await callAI('/flashcards', { module_id: req.params.id, count: req.body.count });
    if (!out.cards.length) throw badRequest('Not enough material in this module to create flashcards');
    const cards = await transaction(async (c) => {
      await c.query('DELETE FROM flashcards WHERE module_id = $1', [req.params.id]);
      const rows = [];
      for (const card of out.cards) {
        const { rows: r } = await c.query('INSERT INTO flashcards (module_id, question, answer, is_demo) VALUES ($1,$2,$3,$4) RETURNING id, question, answer, is_demo, created_at', [
          req.params.id, card.question, card.answer, out.is_demo,
        ]);
        rows.push(r[0]);
      }
      return rows;
    });
    res.status(201).json({ data: cards, generated: true });
  }));

aiRouter.post('/ai/study-plan', requireRole('student'), aiChatLimiter,
  validate(z.object({
    course_id: z.string().uuid(),
    weeks: z.coerce.number().int().min(1).max(12).default(2),
    hours_per_week: z.coerce.number().int().min(1).max(40).default(5),
    goal: z.string().trim().max(500).optional(),
  })),
  ah(async (req, res) => {
    const { enrollment } = await assertCourseViewer(req.user!, req.body.course_id);
    if (!enrollment) throw forbidden('Enroll in this course to get a study plan');
    const course = await getCourse(req.body.course_id);
    const modules = await many(
      `SELECT m.id, m.title, tm.score AS mastery,
         COALESCE(json_agg(json_build_object('id', l.id, 'title', l.title, 'duration_seconds', l.duration_seconds,
           'completed', COALESCE(lp.completed, false)) ORDER BY l.order_index) FILTER (WHERE l.id IS NOT NULL), '[]') AS lectures
       FROM modules m
       LEFT JOIN lectures l ON l.module_id = m.id
       LEFT JOIN lecture_progress lp ON lp.lecture_id = l.id AND lp.enrollment_id = $2
       LEFT JOIN topic_mastery tm ON tm.module_id = m.id AND tm.user_id = $3
         AND EXISTS (SELECT 1 FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.user_id = $3 AND q.module_id = m.id)
       WHERE m.course_id = $1 GROUP BY m.id, tm.score ORDER BY m.order_index`,
      [req.body.course_id, enrollment.id, req.user!.id],
    );
    const attempts = await many(
      `SELECT q.title AS quiz_title, m.title AS module_title, a.score::float AS score, a.submitted_at::text AS submitted_at
       FROM quiz_attempts a JOIN quizzes q ON q.id = a.quiz_id JOIN modules m ON m.id = q.module_id
       WHERE a.user_id = $1 AND m.course_id = $2 AND a.submitted_at IS NOT NULL ORDER BY a.submitted_at DESC LIMIT 30`,
      [req.user!.id, req.body.course_id],
    );
    const plan = await callAI('/study-plan', {
      course_title: course.title, modules, attempts,
      weeks: req.body.weeks, hours_per_week: req.body.hours_per_week, goal: req.body.goal,
    });
    const saved = await one(
      'INSERT INTO study_plans (user_id, course_id, plan_json, is_demo) VALUES ($1,$2,$3,$4) RETURNING *',
      [req.user!.id, req.body.course_id, JSON.stringify(plan), !!plan.is_demo],
    );
    await recordActivity(req.user!.id);
    res.status(201).json(saved);
  }));

aiRouter.get('/ai/study-plan', requireRole('student'), ah(async (req, res) => {
  const courseId = (req.query.course_id as string) || null;
  const plans = await many(
    `SELECT sp.*, c.title AS course_title FROM study_plans sp JOIN courses c ON c.id = sp.course_id
     WHERE sp.user_id = $1 AND ($2::uuid IS NULL OR sp.course_id = $2) ORDER BY sp.generated_at DESC LIMIT 10`,
    [req.user!.id, courseId],
  );
  res.json({ data: plans });
}));
