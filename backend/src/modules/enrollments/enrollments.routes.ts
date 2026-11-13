import { Router } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { ah } from '../../utils/http.js';
import * as svc from './enrollments.service.js';

export const enrollmentsRouter = Router();
enrollmentsRouter.use(requireAuth);

const noteSchema = z.object({
  content: z.string().trim().min(1, 'cannot be empty').max(5000),
  timestamp_seconds: z.coerce.number().int().min(0).optional(),
});

enrollmentsRouter.post('/courses/:id/enroll', requireRole('student'),
  validate(z.object({ confirm_demo_payment: z.boolean().optional() })),
  ah(async (req, res) => res.status(201).json(await svc.enroll(req.user!, req.params.id, !!req.body.confirm_demo_payment))));

enrollmentsRouter.get('/enrollments/me', ah(async (req, res) => res.json({ data: await svc.myEnrollments(req.user!) })));

enrollmentsRouter.get('/lectures/:id', ah(async (req, res) => res.json(await svc.getLectureForPlayer(req.user!, req.params.id))));

enrollmentsRouter.post('/lectures/:id/progress', requireRole('student'),
  validate(z.object({
    position_seconds: z.coerce.number().min(0).optional(),
    delta_seconds: z.coerce.number().min(0).optional(),
    completed: z.boolean().optional(),
  })),
  ah(async (req, res) => res.json(await svc.updateProgress(req.user!, req.params.id, req.body))));

// Notes
enrollmentsRouter.get('/lectures/:id/notes', ah(async (req, res) => res.json({ data: await svc.listNotes(req.user!, req.params.id) })));
enrollmentsRouter.post('/lectures/:id/notes', validate(noteSchema),
  ah(async (req, res) => res.status(201).json(await svc.addNote(req.user!, req.params.id, req.body.content, req.body.timestamp_seconds))));
enrollmentsRouter.put('/notes/:id', validate(noteSchema.pick({ content: true })),
  ah(async (req, res) => res.json(await svc.updateNote(req.user!, req.params.id, req.body.content))));
enrollmentsRouter.delete('/notes/:id', ah(async (req, res) => {
  await svc.deleteNote(req.user!, req.params.id);
  res.json({ success: true });
}));
enrollmentsRouter.get('/notes/me', ah(async (req, res) => res.json({ data: await svc.myNotes(req.user!, req.query.q as string | undefined) })));

// Bookmarks
enrollmentsRouter.get('/lectures/:id/bookmarks', ah(async (req, res) => res.json({ data: await svc.listBookmarks(req.user!, req.params.id) })));
enrollmentsRouter.post('/lectures/:id/bookmarks',
  validate(z.object({ timestamp_seconds: z.coerce.number().int().min(0), label: z.string().trim().max(200).optional() })),
  ah(async (req, res) => res.status(201).json(await svc.addBookmark(req.user!, req.params.id, req.body.timestamp_seconds, req.body.label))));
enrollmentsRouter.delete('/bookmarks/:id', ah(async (req, res) => {
  await svc.deleteBookmark(req.user!, req.params.id);
  res.json({ success: true });
}));
enrollmentsRouter.get('/bookmarks/me', ah(async (req, res) => res.json({ data: await svc.myBookmarks(req.user!) })));
