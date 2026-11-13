/**
 * Demo data seeder.
 *   npm run seed            → wipes demo tables and re-seeds
 *   node seed.js --if-empty → seeds only when there are no users (used by Docker on startup)
 *
 * All demo accounts use the password: Password123!
 * Payments are DEMO records (no real payment gateway), used to populate the revenue dashboard.
 */
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import bcrypt from 'bcryptjs';
import { pool } from '../pool.js';
import { runMigrations } from '../migrate.js';
import { COURSES, SAMPLE_VIDEOS } from './content.js';
import { queueIngest } from '../../jobs/queues.js';
import { logger } from '../../utils/logger.js';

const PASSWORD = 'Password123!';

// Small deterministic PRNG so the demo data is the same on every machine.
let seed = 42;
const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
const pick = <T,>(arr: T[]) => arr[Math.floor(rand() * arr.length)];
const daysAgo = (d: number, h = 10) => new Date(Date.now() - d * 86400000 - h * 3600000 + Math.floor(rand() * 3600000));
const dayStr = (d: number) => new Date(Date.now() - d * 86400000).toISOString().slice(0, 10);

const USERS = [
  { name: 'Meera Iyer', email: 'meera@vertexlearn.ai', role: 'admin', bio: 'Platform admin at Vertexon Learning Technologies.' },
  { name: 'Rohit Verma', email: 'rohit@vertexlearn.ai', role: 'instructor', bio: 'Senior software engineer teaching DSA and system design on the side. 9 years at product companies.' },
  { name: 'Priya Nair', email: 'priya@vertexlearn.ai', role: 'instructor', bio: 'Data scientist and ML educator. Previously built recommendation systems at scale.' },
  { name: 'Daniel Brooks', email: 'daniel@vertexlearn.ai', role: 'instructor', bio: 'Product designer and front-end engineer who loves teaching React and UX.' },
  { name: 'Ananya Sharma', email: 'ananya@example.com', role: 'student', bio: 'Final-year B.Tech student, preparing for placements.' },
  { name: 'Arjun Mehta', email: 'arjun@example.com', role: 'student' },
  { name: 'Sara Khan', email: 'sara@example.com', role: 'student' },
  { name: 'Vikram Singh', email: 'vikram@example.com', role: 'student' },
  { name: 'Emily Chen', email: 'emily@example.com', role: 'student' },
  { name: 'Rahul Gupta', email: 'rahul@example.com', role: 'student' },
  { name: 'Neha Patel', email: 'neha@example.com', role: 'student' },
  { name: 'Karthik Rao', email: 'karthik@example.com', role: 'student' },
  { name: 'Fatima Ali', email: 'fatima@example.com', role: 'student' },
  { name: 'Lucas Martin', email: 'lucas@example.com', role: 'student' },
  { name: 'Ishita Bose', email: 'ishita@example.com', role: 'student' },
  { name: 'Aditya Kumar', email: 'aditya@example.com', role: 'student' },
];

const TABLES = [
  'audit_logs', 'payments', 'course_approvals', 'notifications', 'announcements', 'discussion_posts', 'discussion_threads',
  'recommendations', 'flashcards', 'study_plans', 'topic_mastery', 'document_chunks', 'ai_chat_messages', 'ai_chat_sessions',
  'streaks', 'user_badges', 'certificates', 'quiz_answers', 'quiz_attempts', 'quiz_options', 'quiz_questions', 'quizzes',
  'assignment_submissions', 'assignments', 'user_activity_days', 'bookmarks', 'notes', 'lecture_progress', 'enrollments',
  'course_reviews', 'lectures', 'modules', 'courses', 'password_reset_tokens', 'refresh_tokens', 'user_roles', 'users',
];

const q = (text: string, params: unknown[] = []) => pool.query(text, params);
const one = async (text: string, params: unknown[] = []) => (await pool.query(text, params)).rows[0];

// Quizzes per course key (module index → quiz)
const QUIZZES: Record<string, { module: number; title: string; questions: { text: string; type: 'mcq' | 'multi_select' | 'short_answer'; explanation: string; options: [string, boolean][] }[] }[]> = {
  dsa: [
    {
      module: 0, title: 'Complexity Check',
      questions: [
        { text: 'What is the time complexity of accessing an array element by index?', type: 'mcq', explanation: 'The address is computed directly from the index, so it is constant time.', options: [['O(1)', true], ['O(log n)', false], ['O(n)', false], ['O(n log n)', false]] },
        { text: 'Which complexities are faster than O(n) for large n? Select all that apply.', type: 'multi_select', explanation: 'Constant and logarithmic time both grow more slowly than linear time.', options: [['O(1)', true], ['O(log n)', true], ['O(n²)', false], ['O(n log n)', false]] },
        { text: 'Simplify the Big-O of an algorithm that performs 3n + 50 steps.', type: 'short_answer', explanation: 'Constants and lower-order terms are dropped.', options: [['O(n)', true], ['n', true]] },
        { text: 'Why is appending to a dynamic array amortized O(1)?', type: 'mcq', explanation: 'Occasional resizes copy everything, but their cost is spread over many cheap appends.', options: [['Resizing is rare and its cost is spread across many appends', true], ['Arrays never need to resize', false], ['Appending uses a linked list internally', false], ['The CPU caches the last element', false]] },
      ],
    },
    {
      module: 1, title: 'Sorting Algorithms Quiz',
      questions: [
        { text: 'What is the worst-case time complexity of quicksort when the first element is always chosen as pivot on sorted input?', type: 'mcq', explanation: 'Each partition removes only one element, so the work is n + (n-1) + ... = O(n²).', options: [['O(n²)', true], ['O(n log n)', false], ['O(n)', false], ['O(log n)', false]] },
        { text: 'Which statements about merge sort are true? Select all that apply.', type: 'multi_select', explanation: 'Merge sort is stable, always O(n log n), and needs O(n) extra space for arrays.', options: [['It is stable', true], ['It runs in O(n log n) in the worst case', true], ['It sorts arrays in place with O(1) extra space', false], ['It needs a pivot element', false]] },
        { text: 'Name a pivot strategy that makes quicksort’s worst case very unlikely on any input.', type: 'short_answer', explanation: 'Choosing the pivot at random breaks the link between input order and partition quality.', options: [['random', true], ['randomized pivot', true], ['random pivot', true]] },
        { text: 'Which sorting algorithm divides the array around a pivot before recursing?', type: 'mcq', explanation: 'Quicksort partitions first; merge sort merges after recursing.', options: [['Quicksort', true], ['Merge sort', false], ['Bubble sort', false], ['Insertion sort', false]] },
        { text: 'What does "stable" mean for a sorting algorithm?', type: 'mcq', explanation: 'Equal elements keep their original relative order.', options: [['Equal elements keep their original relative order', true], ['It never uses recursion', false], ['It always runs in O(n log n)', false], ['It uses no extra memory', false]] },
      ],
    },
    {
      module: 2, title: 'Searching & BST Quiz',
      questions: [
        { text: 'What precondition does binary search require?', type: 'mcq', explanation: 'Binary search relies on order to discard half of the range.', options: [['The array must be sorted', true], ['The array must contain unique values', false], ['The array length must be a power of two', false], ['The array must fit in cache', false]] },
        { text: 'What happens to a BST when keys are inserted in sorted order?', type: 'mcq', explanation: 'It degenerates into a chain with height n.', options: [['It becomes a chain and operations become O(n)', true], ['It becomes perfectly balanced', false], ['Insertion fails', false], ['Nothing changes', false]] },
        { text: 'Which traversal of a BST outputs keys in sorted order?', type: 'short_answer', explanation: 'In-order: left subtree, node, right subtree.', options: [['in-order', true], ['inorder', true], ['in order', true]] },
      ],
    },
  ],
  python: [
    {
      module: 0, title: 'Python Basics Quiz',
      questions: [
        { text: 'Which data structure maps keys to values?', type: 'mcq', explanation: 'Dictionaries store key-value pairs.', options: [['Dictionary', true], ['List', false], ['Tuple', false], ['Set', false]] },
        { text: 'Which of these are immutable? Select all that apply.', type: 'multi_select', explanation: 'Tuples and strings cannot be changed after creation.', options: [['tuple', true], ['str', true], ['list', false], ['dict', false]] },
        { text: 'What keyword defines a function in Python?', type: 'short_answer', explanation: 'Functions are defined with def.', options: [['def', true]] },
      ],
    },
    {
      module: 1, title: 'NumPy & Pandas Quiz',
      questions: [
        { text: 'What does vectorization mean in NumPy?', type: 'mcq', explanation: 'Operations apply to whole arrays in optimized C code.', options: [['Applying an operation to a whole array at once', true], ['Converting a list to a vector graphic', false], ['Running code on multiple machines', false], ['Sorting an array', false]] },
        { text: 'Which Pandas method splits data into groups and aggregates them?', type: 'short_answer', explanation: 'groupby splits, applies and combines.', options: [['groupby', true], ['group by', true]] },
        { text: 'Which accessor selects rows by label?', type: 'mcq', explanation: 'loc is label-based; iloc is position-based.', options: [['loc', true], ['iloc', false], ['at_pos', false], ['ix_label', false]] },
      ],
    },
  ],
  ml: [
    {
      module: 0, title: 'ML Concepts Quiz',
      questions: [
        { text: 'Predicting a house price from its features is an example of…', type: 'mcq', explanation: 'The label is a number, so it is regression.', options: [['Regression', true], ['Classification', false], ['Clustering', false], ['Reinforcement learning', false]] },
        { text: 'A model with excellent training accuracy but poor test accuracy is most likely…', type: 'mcq', explanation: 'High variance: it memorised noise.', options: [['Overfitting', true], ['Underfitting', false], ['Perfectly fitted', false], ['Not trained', false]] },
        { text: 'Which techniques reduce variance? Select all that apply.', type: 'multi_select', explanation: 'More data, regularisation and averaging models reduce variance.', options: [['Gathering more data', true], ['Regularisation', true], ['Using a much deeper tree', false], ['Removing the test set', false]] },
      ],
    },
    {
      module: 2, title: 'Model Evaluation Quiz',
      questions: [
        { text: 'Of the cases flagged positive, the fraction that are truly positive is called…', type: 'short_answer', explanation: 'That is precision.', options: [['precision', true]] },
        { text: 'For cancer screening, which metric should usually be prioritised?', type: 'mcq', explanation: 'Missing a case is costly, so recall matters most.', options: [['Recall', true], ['Precision', false], ['Accuracy', false], ['Training loss', false]] },
        { text: 'What is data leakage?', type: 'mcq', explanation: 'Information from the test set or future leaks into training.', options: [['Test or future information sneaking into training features', true], ['Losing rows while loading a CSV', false], ['A memory leak in the training loop', false], ['Using too many folds', false]] },
      ],
    },
  ],
  react: [
    {
      module: 0, title: 'React Fundamentals Quiz',
      questions: [
        { text: 'Why should list items have a stable key prop?', type: 'mcq', explanation: 'Keys let React match items between renders.', options: [['So React can match items between renders', true], ['To style each item', false], ['To make items clickable', false], ['Keys are only for accessibility', false]] },
        { text: 'Which hook adds local state to a function component?', type: 'short_answer', explanation: 'useState returns the value and a setter.', options: [['useState', true]] },
      ],
    },
  ],
  sysdesign: [
    {
      module: 1, title: 'Data Layer Quiz',
      questions: [
        { text: 'In the cache-aside pattern, what happens on a cache miss?', type: 'mcq', explanation: 'Read from the DB, store in cache with a TTL, return.', options: [['Read from the database, store the result in the cache, and return it', true], ['Return an error', false], ['Wait for the cache to refill', false], ['Write to the database', false]] },
        { text: 'Which are benefits of read replicas? Select all that apply.', type: 'multi_select', explanation: 'Replicas spread reads and provide failover.', options: [['Spreading read load', true], ['Failover if the primary dies', true], ['Eliminating replication lag', false], ['Making writes faster on every node', false]] },
      ],
    },
  ],
  uiux: [
    {
      module: 0, title: 'Design Foundations Quiz',
      questions: [
        { text: 'What is the minimum WCAG contrast ratio for normal body text?', type: 'mcq', explanation: 'WCAG AA requires 4.5:1 for normal text.', options: [['4.5:1', true], ['2:1', false], ['3:1', false], ['7:1', false]] },
        { text: 'Why should colour not be the only way to show an error?', type: 'mcq', explanation: 'People with colour vision deficiency may not perceive it.', options: [['People with colour vision deficiency may miss it', true], ['Red is too bright', false], ['Browsers cannot render red', false], ['It slows the page', false]] },
      ],
    },
  ],
};

async function main() {
  const ifEmpty = process.argv.includes('--if-empty');
  await runMigrations();
  if (ifEmpty) {
    const { n } = await one('SELECT COUNT(*)::int AS n FROM users');
    if (n > 0) {
      logger.info('Database already has data — skipping seed');
      return;
    }
  }
  logger.info('Seeding demo data…');
  await q(`TRUNCATE ${TABLES.join(', ')} RESTART IDENTITY CASCADE`);

  // ---- Users ----
  const hash = await bcrypt.hash(PASSWORD, 10);
  const ids: Record<string, string> = {};
  for (const [i, u] of USERS.entries()) {
    const created = daysAgo(u.role === 'student' ? 70 - i * 3 : 200 - i * 10);
    const r = await one(
      'INSERT INTO users (full_name, email, password_hash, bio, created_at, last_login_at) VALUES ($1,$2,$3,$4,$5,$6) RETURNING id',
      [u.name, u.email, hash, u.bio ?? null, created, daysAgo(Math.floor(rand() * 3))],
    );
    ids[u.email] = r.id;
    await q('INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = $2', [r.id, u.role]);
  }
  const students = USERS.filter((u) => u.role === 'student').map((u) => ids[u.email]);
  const ananya = ids['ananya@example.com'];
  const admin = ids['meera@vertexlearn.ai'];
  // One suspended account so the admin user list shows the state.
  await q('UPDATE users SET is_active = FALSE WHERE id = $1', [ids['aditya@example.com']]);

  // ---- Courses, modules, lectures ----
  const course: Record<string, { id: string; modules: { id: string; lectures: { id: string; duration: number; title: string }[] }[]; price: number; instructor: string }> = {};
  let videoIdx = 0;
  for (const [ci, c] of COURSES.entries()) {
    const created = daysAgo(c.status === 'pending' ? 2 + ci : 160 - ci * 12);
    const row = await one(
      `INSERT INTO courses (instructor_id, title, description, category, difficulty, price, status, learning_outcomes, created_at, updated_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$9) RETURNING id`,
      [ids[c.instructor], c.title, c.description, c.category, c.difficulty, c.price, c.status, c.outcomes, created],
    );
    const entry = { id: row.id, modules: [] as any[], price: c.price, instructor: ids[c.instructor] };
    for (const [mi, m] of c.modules.entries()) {
      const mod = await one('INSERT INTO modules (course_id, title, order_index) VALUES ($1,$2,$3) RETURNING id', [row.id, m.title, mi + 1]);
      const lectures = [];
      for (const [li, l] of m.lectures.entries()) {
        const video = SAMPLE_VIDEOS[videoIdx++ % SAMPLE_VIDEOS.length];
        const lec = await one(
          `INSERT INTO lectures (module_id, title, video_url, transcript, duration_seconds, order_index, ingest_status)
           VALUES ($1,$2,$3,$4,$5,$6,'queued') RETURNING id`,
          [mod.id, l.title, video.url, l.transcript, video.seconds, li + 1],
        );
        lectures.push({ id: lec.id, duration: video.seconds, title: l.title });
      }
      entry.modules.push({ id: mod.id, lectures });
    }
    course[c.key] = entry;
    if (c.status !== 'pending') {
      await q('INSERT INTO course_approvals (course_id, reviewed_by, decision, comment, reviewed_at) VALUES ($1,$2,$3,$4,$5)', [
        row.id, admin, c.status,
        c.status === 'rejected' ? 'Please expand the curriculum: at least 3 modules with substantive lectures and learning outcomes.' : 'Great structure and content. Approved.',
        new Date(created.getTime() + 86400000),
      ]);
    }
  }

  // ---- Quizzes ----
  const quizIds: Record<string, { id: string; module: string; questions: { id: string; type: string; correct: string[]; all: string[]; accepted: string[] }[] }[]> = {};
  for (const [key, list] of Object.entries(QUIZZES)) {
    quizIds[key] = [];
    for (const qz of list) {
      const moduleId = course[key].modules[qz.module].id;
      const quiz = await one('INSERT INTO quizzes (module_id, title, status, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [moduleId, qz.title, 'published', daysAgo(60)]);
      const qs = [];
      for (const [qi, qq] of qz.questions.entries()) {
        const qr = await one('INSERT INTO quiz_questions (quiz_id, question_text, question_type, order_index, explanation) VALUES ($1,$2,$3,$4,$5) RETURNING id', [quiz.id, qq.text, qq.type, qi + 1, qq.explanation]);
        const correct: string[] = [], all: string[] = [];
        for (const [text, ok] of qq.options) {
          const o = await one('INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES ($1,$2,$3) RETURNING id', [qr.id, text, ok]);
          all.push(o.id);
          if (ok) correct.push(o.id);
        }
        qs.push({ id: qr.id, type: qq.type, correct, all, accepted: qq.options.filter((o) => o[1]).map((o) => o[0]) });
      }
      quizIds[key].push({ id: quiz.id, module: moduleId, questions: qs });
    }
  }
  // An AI-generated draft waiting for Rohit's review (FR-I4). Clearly marked as seeded demo content.
  {
    const lec = course.dsa.modules[3].lectures[0];
    const quiz = await one(
      `INSERT INTO quizzes (module_id, title, status, is_ai_generated, generated_from_lecture_id, created_at) VALUES ($1,$2,'draft',TRUE,$3,$4) RETURNING id`,
      [course.dsa.modules[3].id, 'Graph Traversal: BFS and DFS (AI draft)', lec.id, daysAgo(1)],
    );
    const draft: [string, 'mcq' | 'short_answer', string, [string, boolean][]][] = [
      ['Which traversal finds shortest paths in an unweighted graph?', 'mcq', 'BFS explores vertices in order of distance from the start.', [['Breadth-first search', true], ['Depth-first search', false], ['In-order traversal', false], ['Binary search', false]]],
      ['What data structure does BFS use to decide which vertex to visit next?', 'short_answer', 'BFS takes vertices from the front of a queue.', [['queue', true], ['a queue', true]]],
      ['What is the time complexity of BFS and DFS with an adjacency list?', 'mcq', 'Each vertex and edge is processed a constant number of times.', [['O(V + E)', true], ['O(V²)', false], ['O(E log V)', false], ['O(V log V)', false]]],
    ];
    for (const [i, [text, type, expl, opts]] of draft.entries()) {
      const qr = await one('INSERT INTO quiz_questions (quiz_id, question_text, question_type, order_index, explanation) VALUES ($1,$2,$3,$4,$5) RETURNING id', [quiz.id, text, type, i + 1, expl]);
      for (const [t, ok] of opts) await q('INSERT INTO quiz_options (question_id, option_text, is_correct) VALUES ($1,$2,$3)', [qr.id, t, ok]);
    }
  }

  // ---- Enrollments, progress, payments ----
  const approvedKeys = ['dsa', 'python', 'ml', 'react', 'sysdesign', 'uiux'];
  const plan: Record<string, { key: string; pct: number; days: number }[]> = {
    [ananya]: [ { key: 'dsa', pct: 0.6, days: 40 }, { key: 'python', pct: 1, days: 55 }, { key: 'ml', pct: 0.2, days: 12 }, { key: 'uiux', pct: 0.25, days: 6 } ],
  };
  for (const s of students) {
    if (plan[s]) continue;
    const n = 1 + Math.floor(rand() * 4);
    const keys = [...approvedKeys].sort(() => rand() - 0.5).slice(0, n);
    plan[s] = keys.map((key) => ({ key, pct: rand() < 0.2 ? 1 : Math.round(rand() * 10) / 10, days: 3 + Math.floor(rand() * 60) }));
  }

  const enrollmentIds: Record<string, string> = {};
  for (const [userId, items] of Object.entries(plan)) {
    for (const it of items) {
      const c = course[it.key];
      const enrolledAt = daysAgo(it.days);
      const e = await one('INSERT INTO enrollments (user_id, course_id, enrolled_at) VALUES ($1,$2,$3) RETURNING id', [userId, c.id, enrolledAt]);
      enrollmentIds[`${userId}:${it.key}`] = e.id;
      if (c.price > 0) await q(`INSERT INTO payments (user_id, course_id, amount, status, created_at) VALUES ($1,$2,$3,'success',$4)`, [userId, c.id, c.price, enrolledAt]);

      const all = c.modules.flatMap((m) => m.lectures);
      const doneCount = Math.round(all.length * it.pct);
      let last: string | null = null;
      for (const [i, l] of all.entries()) {
        if (i < doneCount) {
          const at = daysAgo(Math.max(0, it.days - Math.floor(((i + 1) / all.length) * it.days)));
          await q(
            `INSERT INTO lecture_progress (enrollment_id, lecture_id, watched_seconds, max_watched_seconds, time_spent_seconds, completed, last_watched_at)
             VALUES ($1,$2,$3,$3,$4,TRUE,$5)`,
            [e.id, l.id, l.duration, Math.round(l.duration * (0.9 + rand() * 0.4)), at],
          );
          last = l.id;
        } else if (i === doneCount && it.pct < 1) {
          const pos = Math.floor(l.duration * (0.2 + rand() * 0.5)); // partially watched → "resume" works
          await q(
            `INSERT INTO lecture_progress (enrollment_id, lecture_id, watched_seconds, max_watched_seconds, time_spent_seconds, completed, last_watched_at)
             VALUES ($1,$2,$3,$3,$3,FALSE,$4)`,
            [e.id, l.id, pos, daysAgo(Math.floor(rand() * 2))],
          );
          last = l.id;
        }
      }
      const pct = all.length ? Math.round((doneCount / all.length) * 10000) / 100 : 0;
      await q('UPDATE enrollments SET progress_percent = $1, last_lecture_id = $2, completed_at = $3 WHERE id = $4', [
        pct, last, pct >= 100 ? daysAgo(Math.max(1, it.days - 30)) : null, e.id,
      ]);
      if (pct >= 100) {
        const code = `VL-${Math.floor(rand() * 0xffffffff).toString(16).toUpperCase().padStart(8, '0')}`;
        await q('INSERT INTO certificates (user_id, course_id, certificate_code, issued_at) VALUES ($1,$2,$3,$4)', [userId, c.id, code, daysAgo(Math.max(1, it.days - 30))]);
      }
    }
  }
  // A few demo refunds for the revenue view
  await q(`UPDATE payments SET status = 'refunded' WHERE id IN (SELECT id FROM payments ORDER BY created_at LIMIT 2)`);
  // Extra historical demo payments so the 12-month revenue chart has shape (labelled demo data).
  for (let m = 1; m <= 10; m++) {
    const orders = 2 + Math.floor(rand() * 6) + Math.floor(m / 2);
    for (let k = 0; k < orders; k++) {
      const key = pick(['dsa', 'ml', 'react', 'sysdesign']);
      await q(`INSERT INTO payments (user_id, course_id, amount, status, created_at) VALUES ($1,$2,$3,'success',$4)`, [
        pick(students), course[key].id, course[key].price, daysAgo(30 * (11 - m) + Math.floor(rand() * 28)),
      ]);
    }
  }

  // ---- Quiz attempts + topic mastery ----
  const attempt = async (userId: string, key: string, qi: number, accuracy: number, when: Date) => {
    const qz = quizIds[key]?.[qi];
    if (!qz) return;
    let correctN = 0;
    const a = await one('INSERT INTO quiz_attempts (quiz_id, user_id, started_at) VALUES ($1,$2,$3) RETURNING id', [qz.id, userId, new Date(when.getTime() - 600000)]);
    for (const qq of qz.questions) {
      const ok = rand() < accuracy;
      if (ok) correctN++;
      const wrong = qq.all.filter((o) => !qq.correct.includes(o));
      await q('INSERT INTO quiz_answers (attempt_id, question_id, selected_option_ids, text_answer, is_correct) VALUES ($1,$2,$3,$4,$5)', [
        a.id, qq.id,
        qq.type === 'short_answer' ? [] : ok ? qq.correct : [wrong[0] ?? qq.all[0]],
        qq.type === 'short_answer' ? (ok ? qq.accepted[0] : 'not sure') : null,
        ok,
      ]);
    }
    const score = Math.round((correctN / qz.questions.length) * 10000) / 100;
    await q('UPDATE quiz_attempts SET score = $1, submitted_at = $2 WHERE id = $3', [score, when, a.id]);
    const prev = await one('SELECT score FROM topic_mastery WHERE user_id = $1 AND module_id = $2', [userId, qz.module]);
    const next = prev ? Math.round((prev.score * 0.6 + score * 0.4) * 100) / 100 : score;
    await q(`INSERT INTO topic_mastery (user_id, module_id, score, updated_at) VALUES ($1,$2,$3,$4)
             ON CONFLICT (user_id, module_id) DO UPDATE SET score = $3, updated_at = $4`, [userId, qz.module, next, when]);
    return score;
  };
  // Ananya: strong on complexity, weak on sorting (so the tutor & recommendations have something to work with)
  await attempt(ananya, 'dsa', 0, 0.95, daysAgo(30));
  await attempt(ananya, 'dsa', 1, 0.35, daysAgo(14));
  await attempt(ananya, 'dsa', 1, 0.45, daysAgo(5));
  await attempt(ananya, 'python', 0, 1, daysAgo(48));
  await attempt(ananya, 'python', 1, 0.8, daysAgo(40));
  for (const [userId, items] of Object.entries(plan)) {
    if (userId === ananya) continue;
    for (const it of items) {
      if (it.pct < 0.3) continue;
      for (let qi = 0; qi < (quizIds[it.key]?.length ?? 0); qi++) {
        if (rand() < 0.7) await attempt(userId, it.key, qi, 0.4 + rand() * 0.6, daysAgo(Math.floor(rand() * it.days)));
      }
    }
  }

  // ---- Activity days (DAU, streaks, charts) ----
  for (const s of students) {
    const activeRate = s === ananya ? 1 : 0.25 + rand() * 0.5;
    for (let d = 45; d >= 0; d--) {
      const isAnanyaStreak = s === ananya && d <= 5;
      if (isAnanyaStreak || (s !== ananya && rand() < activeRate) || (s === ananya && d > 5 && rand() < 0.7 && d !== 6)) {
        await q('INSERT INTO user_activity_days (user_id, day, minutes) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING', [s, dayStr(d), 10 + Math.floor(rand() * 70)]);
      }
    }
    // Current streak = consecutive days ending today/yesterday
    const days = (await pool.query('SELECT day FROM user_activity_days WHERE user_id = $1 ORDER BY day DESC', [s])).rows.map((r) => r.day as string);
    let streak = 0;
    for (let d = days[0] === dayStr(0) ? 0 : 1; days.includes(dayStr(d)); d++) streak++;
    let longest = 0, run = 0, prev: string | null = null;
    for (const day of [...days].reverse()) {
      run = prev && new Date(day).getTime() - new Date(prev).getTime() === 86400000 ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = day;
    }
    await q('INSERT INTO streaks (user_id, current_streak, longest_streak, last_active_date) VALUES ($1,$2,$3,$4)', [s, streak, Math.max(longest, streak), days[0] ?? null]);
  }

  // ---- Badges ----
  const award = (userId: string, code: string, when: Date) =>
    q('INSERT INTO user_badges (user_id, badge_id, earned_at) SELECT $1, id, $3 FROM badges WHERE code = $2 ON CONFLICT DO NOTHING', [userId, code, when]);
  for (const s of students) {
    const hasLecture = await one('SELECT 1 FROM lecture_progress lp JOIN enrollments e ON e.id = lp.enrollment_id WHERE e.user_id = $1 AND lp.completed LIMIT 1', [s]);
    if (hasLecture) await award(s, 'first_lecture', daysAgo(50));
    const completed = await one('SELECT 1 FROM enrollments WHERE user_id = $1 AND completed_at IS NOT NULL LIMIT 1', [s]);
    if (completed) await award(s, 'first_course', daysAgo(20));
    const perfect = await one('SELECT 1 FROM quiz_attempts WHERE user_id = $1 AND score = 100 LIMIT 1', [s]);
    if (perfect) await award(s, 'perfect_quiz', daysAgo(30));
    const st = await one('SELECT longest_streak FROM streaks WHERE user_id = $1', [s]);
    if (st?.longest_streak >= 7) await award(s, 'streak_7', daysAgo(10));
  }

  // ---- Assignments & submissions ----
  const assignments: Record<string, string> = {};
  const addAssignment = async (key: string, title: string, instructions: string, dueInDays: number, rubric: { criterion: string; points: number }[]) => {
    const a = await one(
      'INSERT INTO assignments (course_id, title, instructions, rubric, due_date, max_score, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id',
      [course[key].id, title, instructions, JSON.stringify(rubric), new Date(Date.now() + dueInDays * 86400000), rubric.reduce((s, r) => s + r.points, 0), daysAgo(20)],
    );
    assignments[title] = a.id;
    return a.id;
  };
  const a1 = await addAssignment('dsa', 'Complexity Analysis Worksheet',
    'Analyse the time and space complexity of the 8 code snippets in the attached worksheet. Justify each answer in one or two sentences.\n\nSubmit a PDF.', -3,
    [{ criterion: 'Correct complexity for each snippet', points: 60 }, { criterion: 'Clear justification', points: 30 }, { criterion: 'Presentation', points: 10 }]);
  await addAssignment('dsa', 'Implement Quicksort with a Randomized Pivot',
    'Implement quicksort in a language of your choice using a randomized pivot. Include:\n\n1. Your implementation with comments\n2. Tests on random, sorted and reverse-sorted arrays\n3. A short write-up comparing running times with a first-element pivot\n\nSubmit a ZIP or a single source file.', 5,
    [{ criterion: 'Correctness', points: 50 }, { criterion: 'Tests', points: 25 }, { criterion: 'Analysis write-up', points: 25 }]);
  await addAssignment('dsa', 'Binary Search Variants', 'Write functions for lower bound, upper bound and first true in a monotonic predicate. Explain your loop invariants.', 12,
    [{ criterion: 'Correctness', points: 70 }, { criterion: 'Invariant explanations', points: 30 }]);
  await addAssignment('python', 'Exploratory Data Analysis', 'Pick any public CSV dataset, clean it with Pandas, and produce three charts that each answer a question. Submit a notebook (.ipynb) or PDF.', 9,
    [{ criterion: 'Data cleaning', points: 40 }, { criterion: 'Charts answer clear questions', points: 40 }, { criterion: 'Narrative', points: 20 }]);
  await addAssignment('ml', 'Model Evaluation Report', 'Train two classifiers on the provided dataset and compare them using cross-validation, precision, recall and F1. Submit a PDF report.', 15,
    [{ criterion: 'Methodology', points: 50 }, { criterion: 'Correct metrics', points: 30 }, { criterion: 'Discussion', points: 20 }]);

  // Submissions for the past-due worksheet (some graded, some awaiting grading)
  const dsaStudents = Object.entries(plan).filter(([, items]) => items.some((i) => i.key === 'dsa')).map(([u]) => u);
  for (const [i, s] of dsaStudents.entries()) {
    const graded = s === ananya || i % 2 === 0;
    await q(
      `INSERT INTO assignment_submissions (assignment_id, user_id, file_url, file_name, comment, submitted_at, grade, feedback, graded_at, graded_by)
       VALUES ($1,$2,NULL,'complexity-worksheet.pdf',$3,$4,$5,$6,$7,$8)`,
      [a1, s, s === ananya ? 'I was unsure about snippet 6 (the nested loop with halving).' : null, daysAgo(5 + i),
       graded ? (s === ananya ? 86 : 60 + Math.floor(rand() * 40)) : null,
       graded ? (s === ananya ? 'Strong work. Snippet 6 is O(n log n): the inner loop halves each time. Watch your space analysis on snippet 8.' : 'Good effort — review amortized analysis.') : null,
       graded ? daysAgo(2) : null, graded ? course.dsa.instructor : null],
    );
  }
  for (const s of dsaStudents) await award(s, 'first_submission', daysAgo(6));

  // ---- Notes & bookmarks for Ananya ----
  const qs = course.dsa.modules[1].lectures[1];
  await q('INSERT INTO notes (user_id, lecture_id, timestamp_seconds, content, created_at) VALUES ($1,$2,$3,$4,$5),($1,$2,$6,$7,$8)', [
    ananya, qs.id, 120, 'Pivot ends up in its final position after partitioning — no merge step needed.', daysAgo(5),
    300, 'Worst case = pivot always smallest/largest → O(n²). Use randomized pivot or median-of-three!', daysAgo(5),
  ]);
  await q('INSERT INTO notes (user_id, lecture_id, timestamp_seconds, content, created_at) VALUES ($1,$2,$3,$4,$5)', [
    ananya, course.dsa.modules[0].lectures[0].id, 250, 'O(log n) shows up when each step halves the problem (binary search).', daysAgo(30),
  ]);
  await q('INSERT INTO bookmarks (user_id, lecture_id, timestamp_seconds, label, created_at) VALUES ($1,$2,$3,$4,$5)', [ananya, qs.id, 400, 'Sorted input worst case', daysAgo(5)]);

  // ---- Reviews ----
  const comments = ['Clear explanations and great pacing.', 'Exactly what I needed for interviews.', 'Loved the examples!', 'Good course, a bit fast in places.', 'The AI tutor made this so much easier.', 'Well structured and practical.'];
  for (const [userId, items] of Object.entries(plan)) {
    for (const it of items) {
      if (it.pct >= 0.4 && rand() < 0.75) {
        await q('INSERT INTO course_reviews (course_id, user_id, rating, comment, created_at) VALUES ($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING', [
          course[it.key].id, userId, rand() < 0.7 ? 5 : 4, pick(comments), daysAgo(Math.floor(rand() * it.days)),
        ]);
      }
    }
  }

  // ---- Discussions ----
  const thread = async (key: string, author: string, title: string, content: string, replies: [string, string][], when: number) => {
    const t = await one('INSERT INTO discussion_threads (course_id, created_by, title, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [course[key].id, author, title, daysAgo(when)]);
    const first = await one('INSERT INTO discussion_posts (thread_id, user_id, content, created_at) VALUES ($1,$2,$3,$4) RETURNING id', [t.id, author, content, daysAgo(when)]);
    let parent = first.id;
    for (const [i, [who, text]] of replies.entries()) {
      const p = await one('INSERT INTO discussion_posts (thread_id, user_id, content, parent_post_id, created_at) VALUES ($1,$2,$3,$4,$5) RETURNING id', [
        t.id, who, text, i === 1 ? parent : first.id, daysAgo(when - (i + 1) * 0.2),
      ]);
      parent = p.id;
    }
    return t.id;
  };
  const rohit = course.dsa.instructor;
  await thread('dsa', ananya, 'Why does median-of-three help with sorted input?',
    'I get that randomized pivots avoid the worst case, but why does median-of-three specifically fix sorted arrays?',
    [[rohit, 'Great question! On sorted input the first, middle and last elements are min, median and max. Picking the median of those three gives you the true middle element, so the partition is balanced.'],
     [ids['arjun@example.com'], 'That clicked for me too — so reverse-sorted input is also handled for the same reason?'],
     [rohit, 'Exactly. Adversarial inputs can still break it, which is why randomization is the more robust default.']], 4);
  await thread('dsa', ids['sara@example.com'], 'Study group for the quicksort assignment?',
    'Anyone want to pair up this weekend to work through the randomized pivot assignment?',
    [[ananya, "I'm in! Saturday afternoon works for me."], [ids['vikram@example.com'], 'Count me in as well.']], 2);
  const flaggedThread = await thread('python', ids['lucas@example.com'], 'Best resources for Pandas practice?',
    'Looking for datasets to practise groupby and merging.', [[ids['emily@example.com'], 'Kaggle has lots of beginner-friendly datasets.']], 6);
  const spam = await one('INSERT INTO discussion_posts (thread_id, user_id, content, is_flagged, flag_reason, flagged_by, created_at) VALUES ($1,$2,$3,TRUE,$4,$5,$6) RETURNING id', [
    flaggedThread, ids['rahul@example.com'], 'Buy cheap assignment solutions at my site!!! DM me for answers to every quiz.', 'Spam / academic dishonesty', ids['emily@example.com'], daysAgo(1),
  ]);
  void spam;
  await thread('ml', ids['emily@example.com'], 'Precision vs recall for fraud detection',
    'For a fraud model would you optimise precision or recall first?',
    [[course.ml.instructor, 'It depends on the cost of each mistake. Missing fraud is usually expensive, so start with recall and then tune the threshold to keep false alarms manageable.']], 8);

  // ---- Announcements ----
  const announce = (key: string, title: string, content: string, when: number) =>
    q('INSERT INTO announcements (course_id, posted_by, title, content, created_at) VALUES ($1,$2,$3,$4,$5)', [course[key].id, course[key].instructor, title, content, daysAgo(when)]);
  await announce('dsa', 'Quicksort assignment released', 'The randomized-pivot quicksort assignment is live. It is due in 5 days — start early and use the discussion forum if you get stuck.', 3);
  await announce('dsa', 'Live doubt-clearing session on Friday', "I'll run a 45-minute Q&A on sorting and recursion this Friday at 7 PM IST. Bring your questions!", 1);
  await announce('python', 'New practice datasets added', 'I have added three new datasets to the Pandas module resources for extra practice.', 10);
  await announce('ml', 'Welcome to ML Foundations', 'Welcome! Start with the supervised vs unsupervised lecture and try the AI tutor whenever a concept feels fuzzy.', 12);

  // ---- Notifications ----
  const notifs: [string, string, string, string, string, number, boolean][] = [
    [ananya, 'Graded: Complexity Analysis Worksheet', 'You scored 86/100. Your instructor left feedback.', 'grade', `/app/assignments/${a1}`, 2, false],
    [ananya, 'Data Structures & Algorithms Masterclass: Live doubt-clearing session on Friday', 'A 45-minute Q&A on sorting and recursion this Friday at 7 PM IST.', 'announcement', `/app/learn/${course.dsa.id}`, 1, false],
    [ananya, 'Badge unlocked: Course Conqueror', 'Completed your first course', 'badge', '/app/achievements', 20, true],
    [ananya, 'New reply', 'Someone replied in "Why does median-of-three help with sorted input?"', 'info', `/app/discussions/${course.dsa.id}`, 3, true],
    [rohit, 'New submission', 'A student submitted "Complexity Analysis Worksheet".', 'assignment', '/instructor/grading', 1, false],
    [rohit, 'AI quiz draft ready for review', '"Graph Traversal: BFS and DFS (AI draft)" is waiting for your review.', 'course', `/instructor/courses/${course.dsa.id}?tab=quizzes`, 1, false],
    [admin, 'New course awaiting approval', '"Advanced Graph Algorithms" was submitted for review.', 'course', '/admin/courses', 2, false],
    [admin, 'New course awaiting approval', '"Deep Learning with PyTorch" was submitted for review.', 'course', '/admin/courses', 3, false],
    [admin, 'Post reported', 'A post in "Best resources for Pandas practice?" was reported: Spam / academic dishonesty', 'system', '/admin/moderation', 1, false],
  ];
  for (const [u, t, b, type, link, d, read] of notifs) {
    await q('INSERT INTO notifications (user_id, title, body, type, link, is_read, created_at) VALUES ($1,$2,$3,$4,$5,$6,$7)', [u, t, b, type, link, read, daysAgo(d)]);
  }
  for (const s of students) {
    await q(`INSERT INTO notifications (user_id, title, body, type, link, is_read, created_at) VALUES ($1,'Welcome to VertexLearn AI','Browse the catalog, enroll in a course, and ask the AI tutor whenever you get stuck.','system','/courses',TRUE,$2)`, [s, daysAgo(60)]);
  }

  // ---- Audit log samples ----
  await q(`INSERT INTO audit_logs (actor_id, action, entity, entity_id, metadata, created_at) VALUES
    ($1,'course.approved','course',$2,'{"comment":"Great structure and content. Approved."}',$4),
    ($1,'course.rejected','course',$3,'{"comment":"Please expand the curriculum"}',$5),
    ($1,'user.suspend','user',$6,'{"reason":"Repeated spam in forums"}',$7)`,
    [admin, course.dsa.id, course.blockchain.id, daysAgo(150), daysAgo(20), ids['aditya@example.com'], daysAgo(9)]);

  // ---- Queue RAG ingestion of every lecture (processed by the worker + AI service) ----
  const lectures = (await pool.query('SELECT id FROM lectures')).rows;
  let queued = 0;
  try {
    for (const l of lectures) {
      await queueIngest(l.id);
      queued++;
    }
  } catch (err) {
    logger.warn('Could not queue ingestion (is Redis running?). Run POST /lectures/:id/ingest later.', { error: (err as Error).message });
  }
  logger.info(`Seed complete: ${USERS.length} users, ${COURSES.length} courses, ${lectures.length} lectures (${queued} queued for AI indexing).`);
  logger.info(`Demo logins (password "${PASSWORD}"): ananya@example.com (student), rohit@vertexlearn.ai (instructor), meera@vertexlearn.ai (admin)`);
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (isMain) {
  main()
    .then(async () => {
      await pool.end();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('Seed failed', { error: err.message, stack: err.stack });
      await pool.end();
      process.exit(1);
    });
}
