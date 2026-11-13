import { Router } from 'express';
import { z } from 'zod';
import { requireAuth } from '../../middleware/auth.js';
import { authLimiter, sessionLimiter } from '../../middleware/rateLimit.js';
import { validate } from '../../middleware/validate.js';
import { ah } from '../../utils/http.js';
import * as auth from './auth.service.js';

export const password = z
  .string()
  .min(8, 'must be at least 8 characters')
  .max(100)
  .regex(/[A-Za-z]/, 'must contain a letter')
  .regex(/[0-9]/, 'must contain a number');

const registerSchema = z.object({
  full_name: z.string().trim().min(2, 'must be at least 2 characters').max(150),
  email: z.string().trim().email('must be a valid email address').max(180),
  password,
  role: z.enum(['student', 'instructor']).optional(),
});
const loginSchema = z.object({
  email: z.string().trim().email('must be a valid email address'),
  password: z.string().min(1, 'is required'),
});
const refreshSchema = z.object({ refresh_token: z.string().min(10) });

export const authRouter = Router();

authRouter.post('/register', authLimiter, validate(registerSchema), ah(async (req, res) => {
  res.status(201).json(await auth.register(req.body));
}));

authRouter.post('/login', authLimiter, validate(loginSchema), ah(async (req, res) => {
  res.json(await auth.login(req.body.email, req.body.password));
}));

authRouter.post('/refresh', sessionLimiter, validate(refreshSchema), ah(async (req, res) => {
  res.json(await auth.refresh(req.body.refresh_token));
}));

authRouter.post('/logout', sessionLimiter, ah(async (req, res) => {
  await auth.logout(typeof req.body?.refresh_token === 'string' ? req.body.refresh_token : undefined);
  res.json({ success: true });
}));

authRouter.get('/me', sessionLimiter, requireAuth, ah(async (req, res) => {
  res.json({ user: await auth.publicProfile(req.user!.id) });
}));

authRouter.post('/forgot-password', authLimiter, validate(z.object({ email: z.string().trim().email() })), ah(async (req, res) => {
  await auth.forgotPassword(req.body.email);
  res.json({ success: true, message: 'If an account exists for that email, a reset link has been sent.' });
}));

authRouter.post(
  '/reset-password',
  authLimiter,
  validate(z.object({ token: z.string().min(10), password })),
  ah(async (req, res) => {
    await auth.resetPassword(req.body.token, req.body.password);
    res.json({ success: true, message: 'Password updated. You can now sign in.' });
  }),
);
