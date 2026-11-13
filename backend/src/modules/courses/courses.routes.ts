import { Router } from 'express';
import { z } from 'zod';
import { optionalAuth, requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { uploader } from '../../lib/storage.js';
import { badRequest } from '../../utils/errors.js';
import { ah, pagination } from '../../utils/http.js';
import * as svc from './courses.service.js';

const difficulty = z.enum(['beginner', 'intermediate', 'advanced']);
const courseSchema = z.object({
  title: z.string().trim().min(3, 'must be at least 3 characters').max(200),
  description: z.string().trim().max(5000).optional(),
  category: z.string().trim().max(80).optional(),
  difficulty: difficulty.optional(),
  price: z.coerce.number().min(0).max(100000).optional(),
  learning_outcomes: z.array(z.string().trim().min(1).max(200)).max(12).optional(),
});
const courseUpdateSchema = courseSchema.partial().extend({
  archived: z.boolean().optional(),
  resubmit: z.boolean().optional(),
});

// Multipart forms send everything as strings, so numbers/arrays are parsed here.
const optionalNumber = z.preprocess((v) => (v === '' || v === undefined || v === 'null' ? undefined : Number(v)), z.number().int().min(0).max(36000).optional());
const jsonArray = z.preprocess((v) => {
  if (typeof v !== 'string') return v;
  try {
    return JSON.parse(v);
  } catch {
    return undefined;
  }
}, z.array(z.string()).optional());
const bool = z.preprocess((v) => v === 'true' || v === true, z.boolean().optional());
const lectureSchema = z.object({
  title: z.string().trim().min(2).max(200).optional(),
  transcript: z.string().max(200000).optional(),
  duration_seconds: optionalNumber,
  video_url: z.string().trim().url('must be a valid URL').optional().or(z.literal('').transform(() => undefined)),
  remove_resources: jsonArray,
  remove_video: bool,
});

const lectureUpload = uploader({ video: 'video', resources: 'document' }).fields([
  { name: 'video', maxCount: 1 },
  { name: 'resources', maxCount: 10 },
]);
const imageUpload = uploader({ thumbnail: 'image' }, 5).single('thumbnail');

const catalogQuery = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(80).optional(),
  difficulty: difficulty.optional(),
  min_rating: z.coerce.number().min(0).max(5).optional(),
  price: z.enum(['free', 'paid']).optional(),
  sort: z.enum(['popular', 'rating', 'newest', 'price_asc', 'price_desc']).optional(),
});

export const coursesRouter = Router();

// ---- Public catalog ----
coursesRouter.get('/courses', validate(catalogQuery, 'query'), ah(async (req, res) => {
  const { page, limit } = pagination(req.query);
  res.json(await svc.listCatalog({ ...(req.query as any), page, limit }));
}));
coursesRouter.get('/courses/categories', ah(async (_req, res) => res.json({ data: await svc.listCategories() })));
coursesRouter.get('/courses/:id', optionalAuth, ah(async (req, res) => res.json(await svc.getCourseDetail(req.params.id, req.user))));
coursesRouter.get('/courses/:id/reviews', ah(async (req, res) => res.json({ data: await svc.listReviews(req.params.id) })));

// ---- Everything below needs a signed-in user ----
coursesRouter.post('/courses/:id/reviews', requireAuth, requireRole('student'),
  validate(z.object({ rating: z.coerce.number().int().min(1).max(5), comment: z.string().trim().max(2000).optional() })),
  ah(async (req, res) => res.status(201).json(await svc.upsertReview(req.user!, req.params.id, req.body.rating, req.body.comment))));

coursesRouter.get('/instructor/courses', requireAuth, requireRole('instructor', 'admin'),
  ah(async (req, res) => res.json({ data: await svc.listInstructorCourses(req.user!) })));

coursesRouter.post('/courses', requireAuth, requireRole('instructor', 'admin'), validate(courseSchema),
  ah(async (req, res) => res.status(201).json(await svc.createCourse(req.user!, req.body))));

coursesRouter.put('/courses/:id', requireAuth, requireRole('instructor', 'admin'), validate(courseUpdateSchema),
  ah(async (req, res) => res.json(await svc.updateCourse(req.user!, req.params.id, req.body))));

coursesRouter.delete('/courses/:id', requireAuth, requireRole('instructor', 'admin'),
  ah(async (req, res) => {
    await svc.deleteCourse(req.user!, req.params.id);
    res.json({ success: true });
  }));

coursesRouter.post('/courses/:id/thumbnail', requireAuth, requireRole('instructor', 'admin'), imageUpload,
  ah(async (req, res) => {
    if (!req.file) throw badRequest('thumbnail image is required', 'thumbnail');
    res.json(await svc.setThumbnail(req.user!, req.params.id, req.file));
  }));

coursesRouter.post('/courses/:id/approve', requireAuth, requireRole('admin'),
  validate(z.object({ decision: z.enum(['approved', 'rejected']), comment: z.string().trim().max(2000).optional() })),
  ah(async (req, res) => res.json(await svc.reviewCourse(req.user!, req.params.id, req.body.decision, req.body.comment))));

// ---- Modules ----
coursesRouter.post('/courses/:id/modules', requireAuth, requireRole('instructor', 'admin'),
  validate(z.object({ title: z.string().trim().min(2).max(200) })),
  ah(async (req, res) => res.status(201).json(await svc.addModule(req.user!, req.params.id, req.body.title))));

coursesRouter.put('/courses/:id/modules/reorder', requireAuth, requireRole('instructor', 'admin'),
  validate(z.object({ ids: z.array(z.string().uuid()).min(1) })),
  ah(async (req, res) => {
    await svc.reorder(req.user!, 'modules', req.params.id, req.body.ids);
    res.json({ success: true });
  }));

coursesRouter.put('/modules/:id', requireAuth, requireRole('instructor', 'admin'),
  validate(z.object({ title: z.string().trim().min(2).max(200) })),
  ah(async (req, res) => res.json(await svc.updateModule(req.user!, req.params.id, req.body.title))));

coursesRouter.delete('/modules/:id', requireAuth, requireRole('instructor', 'admin'), ah(async (req, res) => {
  await svc.deleteModule(req.user!, req.params.id);
  res.json({ success: true });
}));

coursesRouter.put('/modules/:id/lectures/reorder', requireAuth, requireRole('instructor', 'admin'),
  validate(z.object({ ids: z.array(z.string().uuid()).min(1) })),
  ah(async (req, res) => {
    await svc.reorder(req.user!, 'lectures', req.params.id, req.body.ids);
    res.json({ success: true });
  }));

// ---- Lectures (multipart upload: video + resources) ----
coursesRouter.post('/modules/:id/lectures', requireAuth, requireRole('instructor', 'admin'), lectureUpload,
  validate(lectureSchema.extend({ title: z.string().trim().min(2, 'must be at least 2 characters').max(200) })),
  ah(async (req, res) => {
    res.status(201).json(await svc.addLecture(req.user!, req.params.id, req.body, (req.files ?? {}) as any));
  }));

coursesRouter.put('/lectures/:id', requireAuth, requireRole('instructor', 'admin'), lectureUpload, validate(lectureSchema),
  ah(async (req, res) => res.json(await svc.updateLecture(req.user!, req.params.id, req.body, (req.files ?? {}) as any))));

coursesRouter.delete('/lectures/:id', requireAuth, requireRole('instructor', 'admin'), ah(async (req, res) => {
  await svc.deleteLecture(req.user!, req.params.id);
  res.json({ success: true });
}));

coursesRouter.post('/lectures/:id/ingest', requireAuth, requireRole('instructor', 'admin'),
  ah(async (req, res) => res.json(await svc.reingestLecture(req.user!, req.params.id))));
