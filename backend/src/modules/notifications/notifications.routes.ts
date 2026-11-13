import { Router } from 'express';
import { many, one, query } from '../../db/pool.js';
import { requireAuth } from '../../middleware/auth.js';
import { ah } from '../../utils/http.js';

export const notificationsRouter = Router();
notificationsRouter.use(requireAuth);

notificationsRouter.get('/notifications', ah(async (req, res) => {
  const unreadOnly = req.query.unread === 'true';
  const data = await many(
    `SELECT * FROM notifications WHERE user_id = $1 AND ($2::boolean = false OR is_read = false) ORDER BY created_at DESC LIMIT 50`,
    [req.user!.id, unreadOnly],
  );
  const { n } = (await one<{ n: number }>('SELECT COUNT(*) AS n FROM notifications WHERE user_id = $1 AND NOT is_read', [req.user!.id]))!;
  res.json({ data, unread_count: n });
}));

notificationsRouter.put('/notifications/read-all', ah(async (req, res) => {
  await query('UPDATE notifications SET is_read = TRUE WHERE user_id = $1 AND NOT is_read', [req.user!.id]);
  res.json({ success: true });
}));

notificationsRouter.put('/notifications/:id/read', ah(async (req, res) => {
  await query('UPDATE notifications SET is_read = TRUE WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  res.json({ success: true });
}));

notificationsRouter.delete('/notifications/:id', ah(async (req, res) => {
  await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2', [req.params.id, req.user!.id]);
  res.json({ success: true });
}));
