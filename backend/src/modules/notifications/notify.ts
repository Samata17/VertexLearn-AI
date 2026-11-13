/**
 * Notification architecture:
 *  1. In-app: a row in `notifications` (shown in the bell menu, polled by the frontend).
 *  2. Email (optional): a job on the "email" queue, sent by the worker via SMTP.
 * Callers use notify() / notifyMany() and don't need to know about either channel.
 */
import { many, query } from '../../db/pool.js';
import { env } from '../../config/env.js';
import { emailLayout } from '../../lib/mailer.js';
import { queueEmail } from '../../jobs/queues.js';

export type NotificationType = 'info' | 'announcement' | 'grade' | 'badge' | 'course' | 'system' | 'assignment';

interface NotifyInput {
  title: string;
  body: string;
  type?: NotificationType;
  link?: string;
  email?: boolean;
}

export async function notifyMany(userIds: string[], n: NotifyInput) {
  if (!userIds.length) return;
  await query(
    `INSERT INTO notifications (user_id, title, body, type, link)
     SELECT unnest($1::uuid[]), $2, $3, $4, $5`,
    [userIds, n.title, n.body, n.type ?? 'info', n.link ?? null],
  );
  if (n.email) {
    const users = await many<{ email: string }>(
      'SELECT email FROM users WHERE id = ANY($1::uuid[]) AND is_active AND deleted_at IS NULL',
      [userIds],
    );
    const url = n.link ? `${env.APP_URL}${n.link}` : env.APP_URL;
    for (const u of users) {
      await queueEmail({
        to: u.email,
        subject: n.title,
        html: emailLayout(n.title, `<p>${escapeHtml(n.body)}</p>`, { label: 'Open VertexLearn', url }),
      });
    }
  }
}

export const notify = (userId: string, n: NotifyInput) => notifyMany([userId], n);

export function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
