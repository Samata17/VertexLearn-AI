import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ah } from '../../utils/http.js';
import * as svc from './quizzes.service.js';

export const questionSchema = z.object({
  question_text: z.string().trim().min(3).max(2000),
  question_type: z.enum(['mcq', 'multi_select', 'short_answer']),
  explanation: z.string().trim().max(2000).optional().nullable().transform((v) => v ?? undefined),
  options: z.array(z.object({ option_text: z.string().trim().min(1).max(500), is_correct: z.boolean() })).min(1).max(8),
});
const quizSchema = z.object({
  module_id: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  time_limit_minutes: z.coerce.number().int().min(1).max(300).nullable().optional(),
  status: z.enum(['draft', 'published']).optional(),
  questions: z.array(questionSchema).min(1, 'add at least one question').max(50),
});

export const quizzesRouter = Router();
quizzesRouter.use(requireAuth);

quizzesRouter.post('/quizzes', requireRole('instructor', 'admin'), validate(quizSchema),
  ah(async (req, res) => res.status(201).json(await svc.createQuiz(req.user!, req.body))));
quizzesRouter.get('/quizzes/me', requireRole('student'), ah(async (req, res) => res.json({ data: await svc.myQuizzes(req.user!) })));
quizzesRouter.get('/quizzes/:id', ah(async (req, res) => res.json(await svc.getQuiz(req.user!, req.params.id))));
quizzesRouter.put('/quizzes/:id', requireRole('instructor', 'admin'), validate(quizSchema.omit({ module_id: true }).partial()),
  ah(async (req, res) => res.json(await svc.updateQuiz(req.user!, req.params.id, req.body))));
quizzesRouter.delete('/quizzes/:id', requireRole('instructor', 'admin'), ah(async (req, res) => {
  await svc.deleteQuiz(req.user!, req.params.id);
  res.json({ success: true });
}));
quizzesRouter.get('/courses/:id/quizzes', ah(async (req, res) => res.json({ data: await svc.listCourseQuizzes(req.user!, req.params.id) })));

quizzesRouter.post('/quizzes/:id/attempt', requireRole('student'), ah(async (req, res) => res.status(201).json(await svc.startAttempt(req.user!, req.params.id))));
quizzesRouter.post('/attempts/:id/submit', requireRole('student'),
  validate(z.object({
    answers: z.array(z.object({
      question_id: z.string().uuid(),
      selected_option_ids: z.array(z.string().uuid()).optional(),
      text_answer: z.string().max(2000).optional(),
    })).max(100),
  })),
  ah(async (req, res) => res.json(await svc.submitAttempt(req.user!, req.params.id, req.body.answers))));
quizzesRouter.get('/attempts/me', ah(async (req, res) => res.json({ data: await svc.myAttempts(req.user!, req.query.course_id as string | undefined) })));
quizzesRouter.get('/attempts/:id', ah(async (req, res) => res.json(await svc.getAttemptResult(req.user!, req.params.id))));
quizzesRouter.get('/mastery/me', ah(async (req, res) => res.json({ data: await svc.myMastery(req.user!, req.query.course_id as string | undefined) })));
