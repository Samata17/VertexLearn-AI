import { Router } from 'express';
import { z } from 'zod';
import { one, query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { deleteObject, fileUrl, putObject, uploader } from '../../lib/storage.js';
import { badRequest } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';
import { changePassword, publicProfile } from '../auth/auth.service.js';
import { password } from '../auth/auth.routes.js';

export const usersRouter = Router();
usersRouter.use('/users', requireAuth);

usersRouter.put('/users/me',
  validate(z.object({ full_name: z.string().trim().min(2).max(150).optional(), bio: z.string().trim().max(1000).optional() })),
  ah(async (req, res) => {
    await query('UPDATE users SET full_name = COALESCE($1, full_name), bio = COALESCE($2, bio), updated_at = now() WHERE id = $3', [
      req.body.full_name ?? null, req.body.bio ?? null, req.user!.id,
    ]);
    res.json({ user: await publicProfile(req.user!.id) });
  }));

usersRouter.post('/users/me/avatar', uploader({ avatar: 'image' }, 3).single('avatar'), ah(async (req, res) => {
  if (!req.file) throw badRequest('avatar image is required', 'avatar');
  const old = await one('SELECT avatar_url FROM users WHERE id = $1', [req.user!.id]);
  const key = await putObject('public/avatars', req.file.originalname, req.file.buffer, req.file.mimetype);
  await query('UPDATE users SET avatar_url = $1, updated_at = now() WHERE id = $2', [key, req.user!.id]);
  await deleteObject(old?.avatar_url);
  res.json({ avatar_url: fileUrl(key) });
}));

usersRouter.put('/users/me/password',
  validate(z.object({ current_password: z.string().min(1), new_password: password })),
  ah(async (req, res) => {
    await changePassword(req.user!, req.body.current_password, req.body.new_password);
    res.json({ success: true });
  }));
