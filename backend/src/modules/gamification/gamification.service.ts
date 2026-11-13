/**
 * Gamification rules (PRD FR-S9, Section 11):
 *  - Streak: +1 for each consecutive calendar day with learning activity; resets after a missed day.
 *  - Badges: awarded once, on milestones (first lecture, first course, 7/30-day streak, perfect quiz, ...).
 */
import { one, query } from '../../db/pool.js';
import { notify } from '../notifications/notify.js';

const today = () => new Date().toISOString().slice(0, 10);

/** Call whenever a user does something "learning-like" (watch, quiz, submit, chat). */
export async function recordActivity(userId: string, minutes = 0) {
  const day = today();
  await query(
    `INSERT INTO user_activity_days (user_id, day, minutes) VALUES ($1, $2, $3)
     ON CONFLICT (user_id, day) DO UPDATE SET minutes = user_activity_days.minutes + EXCLUDED.minutes`,
    [userId, day, Math.max(0, Math.round(minutes))],
  );

  const s = await one<{ current_streak: number; longest_streak: number; last_active_date: string | null }>(
    'SELECT current_streak, longest_streak, last_active_date FROM streaks WHERE user_id = $1',
    [userId],
  );
  if (s?.last_active_date === day) return s.current_streak;

  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const current = s?.last_active_date === yesterday ? s.current_streak + 1 : 1;
  const longest = Math.max(current, s?.longest_streak ?? 0);
  await query(
    `INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date) VALUES ($1,$2,$3,$4)
     ON CONFLICT (user_id) DO UPDATE SET current_streak = $2, longest_streak = $3, last_active_date = $4`,
    [userId, current, longest, day],
  );
  if (current >= 7) await awardBadge(userId, 'streak_7');
  if (current >= 30) await awardBadge(userId, 'streak_30');
  return current;
}

/** Awards a badge once. Returns true if newly awarded. */
export async function awardBadge(userId: string, code: string) {
  const res = await query(
    `INSERT INTO user_badges (user_id, badge_id)
     SELECT $1, id FROM badges WHERE code = $2
     ON CONFLICT DO NOTHING RETURNING badge_id`,
    [userId, code],
  );
  if (!res.rowCount) return false;
  const badge = await one<{ name: string; description: string }>('SELECT name, description FROM badges WHERE code = $1', [
    code,
  ]);
  if (badge) {
    await notify(userId, {
      title: `Badge unlocked: ${badge.name}`,
      body: badge.description,
      type: 'badge',
      link: '/app/achievements',
    });
  }
  return true;
}

/** Daily cron (PRD 9.3): reset streaks for users who missed yesterday. */
export async function evaluateStreaks() {
  const yesterday = new Date(Date.now() - 86400000).toISOString().slice(0, 10);
  const res = await query(
    `UPDATE streaks SET current_streak = 0
     WHERE current_streak > 0 AND (last_active_date IS NULL OR last_active_date < $1)`,
    [yesterday],
  );
  return res.rowCount ?? 0;
}
