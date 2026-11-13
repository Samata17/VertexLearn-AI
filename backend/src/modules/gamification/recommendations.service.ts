/**
 * Recommendation engine (PRD 3.1: "rule-based + embedding similarity", FR-S10).
 *
 * For each approved course the student isn't enrolled in, a score (0-100) is built from:
 *   - Content similarity (up to 40): cosine similarity between the average embedding of the
 *     student's enrolled courses' material and the candidate course's material (pgvector).
 *   - Same category as an enrolled course (25)
 *   - Right difficulty (20): strong quiz scores → next level up; weak scores → beginner level
 *   - Quality (up to 15): average rating
 * Weak topics (mastery < 60) are returned separately as "revisit" suggestions.
 * Results are stored in `recommendations` and refreshed nightly (or when older than 12h).
 */
import { many, one, query } from '../../db/pool.js';
import { fileUrl } from '../../lib/storage.js';

const LEVELS = ['beginner', 'intermediate', 'advanced'];

export async function computeRecommendations(userId: string) {
  const enrolled = await many<{ course_id: string; category: string; difficulty: string }>(
    `SELECT e.course_id, c.category, c.difficulty FROM enrollments e JOIN courses c ON c.id = e.course_id WHERE e.user_id = $1`,
    [userId],
  );
  const enrolledIds = enrolled.map((e) => e.course_id);
  const categories = new Set(enrolled.map((e) => e.category));
  const avgQuiz = (await one<{ avg: number | null }>(
    `SELECT AVG(score)::float AS avg FROM quiz_attempts WHERE user_id = $1 AND submitted_at IS NOT NULL`,
    [userId],
  ))?.avg;
  const highestLevel = Math.max(-1, ...enrolled.map((e) => LEVELS.indexOf(e.difficulty)));
  const targetLevel = avgQuiz == null ? Math.max(0, highestLevel) : avgQuiz >= 75 ? Math.min(2, highestLevel + 1) : avgQuiz < 50 ? 0 : Math.max(0, highestLevel);

  const candidates = await many(
    `SELECT c.id, c.title, c.category, c.difficulty, COALESCE(AVG(r.rating), 0)::float AS rating, COUNT(DISTINCT e.id)::int AS learners
     FROM courses c LEFT JOIN course_reviews r ON r.course_id = c.id LEFT JOIN enrollments e ON e.course_id = c.id
     WHERE c.status = 'approved' AND NOT (c.id = ANY($1::uuid[]))
     GROUP BY c.id`,
    [enrolledIds],
  );
  if (!candidates.length) {
    await query('DELETE FROM recommendations WHERE user_id = $1', [userId]);
    return;
  }

  // Embedding similarity in SQL: AVG() of vectors gives a "profile" vector; <=> is cosine distance.
  const sims = enrolledIds.length
    ? await many<{ course_id: string; sim: number }>(
        `WITH profile AS (SELECT AVG(embedding) AS v FROM document_chunks WHERE course_id = ANY($1::uuid[]) AND embedding IS NOT NULL),
              cand AS (SELECT course_id, AVG(embedding) AS v FROM document_chunks WHERE course_id = ANY($2::uuid[]) AND embedding IS NOT NULL GROUP BY course_id)
         SELECT cand.course_id, (1 - (cand.v <=> profile.v))::float AS sim FROM cand, profile WHERE profile.v IS NOT NULL`,
        [enrolledIds, candidates.map((c) => c.id)],
      )
    : [];
  const simBy = new Map(sims.map((s) => [s.course_id, s.sim]));

  const scored = candidates.map((c) => {
    const sim = simBy.get(c.id);
    const parts: { pts: number; reason: string }[] = [];
    if (sim != null) parts.push({ pts: Math.max(0, sim) * 40, reason: 'Similar material to courses you are taking' });
    if (categories.has(c.category)) parts.push({ pts: 25, reason: `More ${c.category} to build on what you're learning` });
    if (LEVELS.indexOf(c.difficulty) === targetLevel) {
      parts.push({
        pts: 20,
        reason: avgQuiz != null && avgQuiz >= 75
          ? `Your quiz scores (avg ${Math.round(avgQuiz)}%) suggest you're ready for ${c.difficulty} level`
          : `Matches your current level (${c.difficulty})`,
      });
    }
    parts.push({ pts: (c.rating / 5) * 15, reason: c.rating >= 4 ? `Highly rated (${c.rating.toFixed(1)}★)` : 'Popular with learners' });
    if (!enrolledIds.length) parts.push({ pts: Math.min(15, c.learners), reason: 'Popular with learners' });
    const score = Math.min(100, parts.reduce((s, p) => s + p.pts, 0));
    const reason = [...parts].sort((a, b) => b.pts - a.pts)[0].reason;
    return { id: c.id, score: Math.round(score * 100) / 100, reason };
  });
  scored.sort((a, b) => b.score - a.score);
  const top = scored.slice(0, 6);

  await query('DELETE FROM recommendations WHERE user_id = $1', [userId]);
  for (const r of top) {
    await query('INSERT INTO recommendations (user_id, recommended_course_id, reason, score) VALUES ($1,$2,$3,$4)', [userId, r.id, r.reason, r.score]);
  }
}

export async function getRecommendations(userId: string) {
  const fresh = await one<{ n: number }>(
    `SELECT COUNT(*) AS n FROM recommendations WHERE user_id = $1 AND created_at > now() - interval '12 hours'`,
    [userId],
  );
  if (!fresh?.n) await computeRecommendations(userId);

  const courses = await many(
    `SELECT r.reason, r.score, c.id, c.title, c.category, c.difficulty, c.thumbnail_url, c.price, u.full_name AS instructor_name,
       COALESCE((SELECT ROUND(AVG(rating)::numeric, 1) FROM course_reviews cr WHERE cr.course_id = c.id), 0)::float AS rating,
       (SELECT COUNT(*) FROM enrollments e WHERE e.course_id = c.id)::int AS enrollment_count
     FROM recommendations r JOIN courses c ON c.id = r.recommended_course_id JOIN users u ON u.id = c.instructor_id
     WHERE r.user_id = $1 AND c.status = 'approved' ORDER BY r.score DESC`,
    [userId],
  );
  const weakTopics = await many(
    `SELECT tm.module_id, tm.score, m.title AS module_title, c.id AS course_id, c.title AS course_title,
       (SELECT l.id FROM lectures l WHERE l.module_id = m.id ORDER BY l.order_index LIMIT 1) AS first_lecture_id
     FROM topic_mastery tm JOIN modules m ON m.id = tm.module_id JOIN courses c ON c.id = m.course_id
     JOIN enrollments e ON e.course_id = c.id AND e.user_id = tm.user_id
     WHERE tm.user_id = $1 AND tm.score < 60 AND tm.updated_at IS NOT NULL
       AND EXISTS (SELECT 1 FROM quiz_attempts qa JOIN quizzes q ON q.id = qa.quiz_id WHERE qa.user_id = $1 AND q.module_id = m.id AND qa.submitted_at IS NOT NULL)
     ORDER BY tm.score LIMIT 5`,
    [userId],
  );
  return {
    courses: courses.map((c) => ({ ...c, thumbnail_url: fileUrl(c.thumbnail_url) })),
    topics: weakTopics.map((t) => ({ ...t, reason: `Your mastery is ${Math.round(t.score)}% — review this module and retake its quiz` })),
  };
}

/** Nightly job (PRD 9.3). */
export async function recalculateAll() {
  const users = await many<{ user_id: string }>(
    `SELECT DISTINCT ur.user_id FROM user_roles ur JOIN roles r ON r.id = ur.role_id JOIN users u ON u.id = ur.user_id
     WHERE r.name = 'student' AND u.is_active AND u.deleted_at IS NULL`,
  );
  for (const u of users) await computeRecommendations(u.user_id);
  return users.length;
}
