import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { uploader } from '../../lib/storage.js';
import { ah } from '../../utils/http.js';
import * as svc from './assignments.service.js';

const rubric = z.array(z.object({ criterion: z.string().trim().min(1).max(200), points: z.coerce.number().min(0).max(1000) })).max(20);
const assignmentSchema = z.object({
  course_id: z.string().uuid(),
  title: z.string().trim().min(3).max(200),
  instructions: z.string().trim().max(20000).optional(),
  rubric: rubric.optional(),
  due_date: z.string().datetime({ offset: true }).nullable().optional(),
  max_score: z.coerce.number().min(1).max(1000).optional(),
});

const submissionUpload = uploader({ file: 'submission' }, 50).single('file');

export const assignmentsRouter = Router();
assignmentsRouter.use(requireAuth);

assignmentsRouter.post('/assignments', requireRole('instructor', 'admin'), validate(assignmentSchema),
  ah(async (req, res) => res.status(201).json(await svc.createAssignment(req.user!, req.body))));
assignmentsRouter.get('/assignments/me', requireRole('student'),
  ah(async (req, res) => res.json({ data: await svc.myAssignments(req.user!) })));
assignmentsRouter.get('/assignments/:id', ah(async (req, res) => res.json(await svc.getAssignment(req.user!, req.params.id))));
assignmentsRouter.put('/assignments/:id', requireRole('instructor', 'admin'), validate(assignmentSchema.omit({ course_id: true }).partial()),
  ah(async (req, res) => res.json(await svc.updateAssignment(req.user!, req.params.id, req.body))));
assignmentsRouter.delete('/assignments/:id', requireRole('instructor', 'admin'), ah(async (req, res) => {
  await svc.deleteAssignment(req.user!, req.params.id);
  res.json({ success: true });
}));
assignmentsRouter.get('/courses/:id/assignments', ah(async (req, res) => res.json({ data: await svc.listCourseAssignments(req.user!, req.params.id) })));

assignmentsRouter.post('/assignments/:id/submit', requireRole('student'), submissionUpload,
  validate(z.object({ comment: z.string().trim().max(2000).optional() })),
  ah(async (req, res) => res.status(201).json(await svc.submit(req.user!, req.params.id, req.file, req.body.comment))));

assignmentsRouter.get('/assignments/:id/submissions', requireRole('instructor', 'admin'),
  ah(async (req, res) => res.json({ data: await svc.listSubmissions(req.user!, req.params.id) })));

assignmentsRouter.get('/instructor/submissions', requireRole('instructor', 'admin'),
  validate(z.object({ status: z.enum(['pending', 'graded', 'all']).default('pending'), assignment: z.string().uuid().optional() }), 'query'),
  ah(async (req, res) => res.json({ data: await svc.gradingQueue(req.user!, req.query.status as any, req.query.assignment as string | undefined) })));

assignmentsRouter.put('/submissions/:id/grade', requireRole('instructor', 'admin'),
  validate(z.object({ grade: z.coerce.number().min(0).max(1000), feedback: z.string().trim().max(10000).optional() })),
  ah(async (req, res) => res.json(await svc.grade(req.user!, req.params.id, req.body.grade, req.body.feedback))));
