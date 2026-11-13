/**
 * End-to-end API smoke test. Requires the stack running and seeded.
 *   node scripts/smoke-test.mjs                       (default http://localhost:4000)
 *   API_URL=http://localhost:8080 node scripts/smoke-test.mjs
 * Walks through the main workflows of all three roles and reports pass/fail per step.
 * Exit code is 1 if ANY step fails.
 *
 * SMOKE_SKIP_AI=1 skips the steps that need the Python AI service (chat, summary, flashcards, study plan,
 * AI quiz generation) — for runs where only the API, Postgres and Redis are up. Skips are printed and
 * counted; they never hide a failure.
 */
const BASE = (process.env.API_URL ?? 'http://localhost:4000') + '/api/v1';
const PASSWORD = 'Password123!';
const SKIP_AI = process.env.SMOKE_SKIP_AI === '1';
let passed = 0, failed = 0, skipped = 0;

async function api(method, path, { token, body, form, expect } = {}) {
  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body) headers['Content-Type'] = 'application/json';
  const res = await fetch(BASE + path, { method, headers, body: form ?? (body ? JSON.stringify(body) : undefined) });
  const ct = res.headers.get('content-type') ?? '';
  const data = ct.includes('json') ? await res.json() : await res.arrayBuffer();
  if (expect && res.status !== expect) throw new Error(`${method} ${path} → ${res.status} (expected ${expect}) ${JSON.stringify(data).slice(0, 300)}`);
  if (!expect && !res.ok) throw new Error(`${method} ${path} → ${res.status} ${JSON.stringify(data).slice(0, 300)}`);
  return { status: res.status, data, headers: res.headers };
}

async function step(name, fn) {
  try {
    const out = await fn();
    passed++;
    console.log(`  ✓ ${name}${out ? `  (${out})` : ''}`);
  } catch (e) {
    failed++;
    console.log(`  ✗ ${name}\n      ${e.message}`);
  }
}

/** A step that needs the AI service. */
async function aiStep(name, fn) {
  if (!SKIP_AI) return step(name, fn);
  skipped++;
  console.log(`  - ${name}  (skipped: SMOKE_SKIP_AI=1)`);
}

const login = async (email) => (await api('POST', '/auth/login', { body: { email, password: PASSWORD } })).data;

console.log(`Smoke testing ${BASE}\n`);
let student, instructor, admin, newUser;
const ctx = {};

console.log('Auth');
await step('register new student', async () => {
  const email = `smoke${Date.now()}@example.com`;
  newUser = (await api('POST', '/auth/register', { body: { full_name: 'Smoke Tester', email, password: 'Testing123', role: 'student' }, expect: 201 })).data;
  return newUser.user.role;
});
await step('validation error format (PRD 8.8)', async () => {
  const r = await api('POST', '/auth/register', { body: { full_name: 'X', email: 'bad', password: 'short' }, expect: 400 });
  if (!r.data.error?.code || !r.data.error?.message) throw new Error('bad error shape');
  return r.data.error.code;
});
await step('login as student / instructor / admin', async () => {
  student = await login('ananya@example.com');
  instructor = await login('rohit@vertexlearn.ai');
  admin = await login('meera@vertexlearn.ai');
  return [student.user.role, instructor.user.role, admin.user.role].join(', ');
});
await step('wrong password is rejected', async () => {
  await api('POST', '/auth/login', { body: { email: 'ananya@example.com', password: 'nope12345' }, expect: 401 });
});
await step('GET /auth/me', async () => (await api('GET', '/auth/me', { token: student.access_token })).data.user.email);
await step('refresh rotates tokens; old token has a short grace period (reload / two tabs)', async () => {
  const old = newUser.refresh_token;
  const r = await api('POST', '/auth/refresh', { body: { refresh_token: old } });
  if (r.data.refresh_token === old) throw new Error('refresh token was not rotated');
  // A second use within the 30 s grace window still works (e.g. the page reloaded mid-refresh).
  const again = await api('POST', '/auth/refresh', { body: { refresh_token: old } });
  ctx.oldRefresh = old;
  ctx.otherTab = again.data.refresh_token;
  newUser = r.data;
});
await step('logout revokes the session and the rotated token (no grace after sign-out)', async () => {
  await api('POST', '/auth/logout', { body: { refresh_token: newUser.refresh_token } });
  await api('POST', '/auth/refresh', { body: { refresh_token: newUser.refresh_token }, expect: 401 });
  await api('POST', '/auth/refresh', { body: { refresh_token: ctx.oldRefresh }, expect: 401 });
  await api('POST', '/auth/logout', { body: { refresh_token: ctx.otherTab } });
  await api('POST', '/auth/refresh', { body: { refresh_token: ctx.otherTab }, expect: 401 });
});
await step('forgot-password responds generically', async () => (await api('POST', '/auth/forgot-password', { body: { email: 'ananya@example.com' } })).data.message.slice(0, 30));

console.log('\nCatalog & courses');
await step('public catalog with filters', async () => {
  const all = (await api('GET', '/courses')).data;
  const cs = (await api('GET', '/courses?category=Computer%20Science&difficulty=intermediate')).data;
  const search = (await api('GET', '/courses?q=react')).data;
  ctx.dsa = all.data.find((c) => c.title.startsWith('Data Structures'));
  ctx.react = all.data.find((c) => c.title.includes('React'));
  ctx.uiux = all.data.find((c) => c.title.includes('UI/UX'));
  return `${all.total} approved, ${cs.total} CS-intermediate, ${search.total} match "react"`;
});
await step('categories', async () => (await api('GET', '/courses/categories')).data.data.length + ' categories');
await step('course detail with curriculum', async () => {
  const d = (await api('GET', `/courses/${ctx.dsa.id}`, { token: student.access_token })).data;
  ctx.dsaDetail = d;
  return `${d.modules.length} modules, enrolled=${!!d.enrollment}`;
});
await step('RBAC: student cannot create a course', async () => {
  await api('POST', '/courses', { token: student.access_token, body: { title: 'Nope course' }, expect: 403 });
});

console.log('\nStudent learning loop');
await step('student dashboard', async () => {
  const d = (await api('GET', '/dashboard/student', { token: student.access_token })).data;
  return `streak ${d.streak.current_streak}, ${d.enrollments.length} enrollments, ${d.upcoming_assignments.length} upcoming`;
});
// Enrollment uses the freshly registered student, so the test can be re-run safely.
await step('enroll in a free course', async () => {
  const r = await api('POST', `/courses/${ctx.uiux.id}/enroll`, { token: newUser.access_token, expect: 201 });
  await api('POST', `/courses/${ctx.uiux.id}/enroll`, { token: newUser.access_token, expect: 409 });
  return r.status;
});
await step('paid course requires demo checkout confirmation', async () => {
  await api('POST', `/courses/${ctx.react.id}/enroll`, { token: newUser.access_token, body: {}, expect: 402 });
  await api('POST', `/courses/${ctx.react.id}/enroll`, { token: newUser.access_token, body: { confirm_demo_payment: true }, expect: 201 });
});
await step('lecture player data + resume position', async () => {
  const lectureId = ctx.dsaDetail.modules[1].lectures[1].id;
  ctx.lectureId = lectureId;
  const d = (await api('GET', `/lectures/${lectureId}`, { token: student.access_token })).data;
  return `${d.lecture.title}: resume at ${d.progress.watched_seconds}s, ${d.notes.length} notes`;
});
await step('progress update, note and bookmark', async () => {
  await api('POST', `/lectures/${ctx.lectureId}/progress`, { token: student.access_token, body: { position_seconds: 30, delta_seconds: 10 } });
  const n = (await api('POST', `/lectures/${ctx.lectureId}/notes`, { token: student.access_token, body: { content: 'smoke note', timestamp_seconds: 30 }, expect: 201 })).data;
  await api('DELETE', `/notes/${n.id}`, { token: student.access_token });
  const b = (await api('POST', `/lectures/${ctx.lectureId}/bookmarks`, { token: student.access_token, body: { timestamp_seconds: 30 }, expect: 201 })).data;
  await api('DELETE', `/bookmarks/${b.id}`, { token: student.access_token });
});
await step('take a quiz → auto-graded', async () => {
  const quizzes = (await api('GET', `/courses/${ctx.dsa.id}/quizzes`, { token: student.access_token })).data.data;
  const quiz = quizzes[0];
  const { attempt, quiz: q } = (await api('POST', `/quizzes/${quiz.id}/attempt`, { token: student.access_token, expect: 201 })).data;
  if (q.questions.some((qq) => qq.options.some((o) => 'is_correct' in o))) throw new Error('answers leaked to student!');
  const answers = q.questions.map((qq) => qq.question_type === 'short_answer'
    ? { question_id: qq.id, text_answer: 'O(n)' }
    : { question_id: qq.id, selected_option_ids: [qq.options[0].id] });
  const r = (await api('POST', `/attempts/${attempt.id}/submit`, { token: student.access_token, body: { answers } })).data;
  return `score ${r.attempt.score}% (${r.correct_count}/${r.total})`;
});
await step('upcoming assignments + submit file', async () => {
  const list = (await api('GET', '/assignments/me', { token: student.access_token })).data.data;
  const open = list.find((a) => a.due_date && new Date(a.due_date) > new Date());
  const form = new FormData();
  form.append('file', new Blob(['def quicksort(a): ...'], { type: 'text/plain' }), 'quicksort.py');
  form.append('comment', 'smoke test submission');
  const s = (await api('POST', `/assignments/${open.id}/submit`, { token: student.access_token, form, expect: 201 })).data;
  ctx.submissionId = s.id;
  return open.title;
});
await step('badges, streak, leaderboard, recommendations', async () => {
  const b = (await api('GET', '/users/me/badges', { token: student.access_token })).data.data.filter((x) => x.earned).length;
  const lb = (await api('GET', `/leaderboard/${ctx.dsa.id}`, { token: student.access_token })).data;
  const rec = (await api('GET', '/recommendations/me', { token: student.access_token })).data;
  return `${b} badges, rank ${lb.me?.rank}, ${rec.courses.length} course recs, ${rec.topics.length} weak topics`;
});
await step('certificate PDF download', async () => {
  const certs = (await api('GET', '/certificates/me', { token: student.access_token })).data.data;
  const r = await api('GET', `/certificates/${certs[0].id}/download`, { token: student.access_token });
  const bytes = new Uint8Array(r.data);
  if (String.fromCharCode(...bytes.slice(0, 4)) !== '%PDF') throw new Error('not a PDF');
  const v = (await api('GET', `/certificates/verify/${certs[0].certificate_code}`)).data;
  return `${bytes.length} bytes, verified for ${v.student_name}`;
});
await step('discussion thread + reply + report', async () => {
  const t = (await api('POST', `/courses/${ctx.dsa.id}/threads`, { token: student.access_token, body: { title: 'Smoke test thread', content: 'Hello class' }, expect: 201 })).data;
  const p = (await api('POST', `/threads/${t.id}/posts`, { token: instructor.access_token, body: { content: 'Welcome!' }, expect: 201 })).data;
  await api('POST', `/posts/${p.id}/report`, { token: student.access_token, body: { reason: 'smoke test report' } });
  ctx.reportedPost = p.id;
  const th = (await api('GET', `/threads/${t.id}`, { token: student.access_token })).data;
  return `${th.posts.length} posts`;
});
await step('notifications', async () => (await api('GET', '/notifications', { token: student.access_token })).data.unread_count + ' unread');

console.log('\nAI tutor');
await step('AI status', async () => {
  const s = (await api('GET', '/ai/status', { token: student.access_token })).data;
  ctx.aiMode = s.mode;
  return `${s.mode}${s.model ? ` (${s.model})` : ''}`;
});
await aiStep('chat session → RAG answer with citations', async () => {
  const s = (await api('POST', '/ai/chat/sessions', { token: student.access_token, body: { course_id: ctx.dsa.id }, expect: 201 })).data;
  const r = (await api('POST', `/ai/chat/sessions/${s.id}/messages`, { token: student.access_token, body: { message: 'Why does quicksort degrade to O(n^2) on sorted input?' } })).data;
  if (!r.sources.length) throw new Error('no sources returned — has the worker indexed the lectures yet?');
  ctx.session = s.id;
  return `${r.is_demo ? 'DEMO' : 'LIVE'} reply, top source: ${r.sources[0].lecture_title} @ ${r.sources[0].timestamp_seconds}s`;
});
await aiStep('switch explanation mode', async () => (await api('PUT', `/ai/chat/sessions/${ctx.session}/mode`, { token: student.access_token, body: { mode: 'beginner' } })).data.mode);
await aiStep('lecture summary', async () => {
  const r = (await api('POST', `/ai/lectures/${ctx.lectureId}/summarize`, { token: student.access_token })).data;
  return `${r.key_points.length} key points${r.is_demo ? ' (demo)' : ''}`;
});
await aiStep('flashcards for a module', async () => {
  const r = (await api('POST', `/ai/modules/${ctx.dsaDetail.modules[1].id}/flashcards`, { token: student.access_token, body: { count: 6 } })).data;
  return `${r.data.length} cards`;
});
await aiStep('personalized study plan', async () => {
  const r = (await api('POST', '/ai/study-plan', { token: student.access_token, body: { course_id: ctx.dsa.id, weeks: 2, hours_per_week: 4 }, expect: 201 })).data;
  return `${r.plan_json.weeks.length} weeks${r.is_demo ? ' (demo)' : ''}`;
});

console.log('\nInstructor');
await step('instructor overview analytics', async () => {
  const d = (await api('GET', '/instructor/analytics/overview', { token: instructor.access_token })).data;
  return `${d.stats.students} students, ${d.stats.to_grade} to grade, ${d.draft_quizzes.length} AI drafts`;
});
await step('course analytics (drop-off, quiz avg, time-on-task)', async () => {
  const d = (await api('GET', `/instructor/courses/${ctx.dsa.id}/analytics`, { token: instructor.access_token })).data;
  return `${d.lectures.length} lectures, ${d.quizzes.length} quizzes, ${d.students.length} students`;
});
await step('create course → module → lecture (multipart upload)', async () => {
  const c = (await api('POST', '/courses', { token: instructor.access_token, body: { title: 'Smoke Test Course', category: 'Computer Science', difficulty: 'beginner', price: 0 }, expect: 201 })).data;
  ctx.newCourse = c.id;
  const m = (await api('POST', `/courses/${c.id}/modules`, { token: instructor.access_token, body: { title: 'Module one' }, expect: 201 })).data;
  const form = new FormData();
  form.append('title', 'Intro lecture');
  form.append('transcript', '[00:00] Recursion is when a function calls itself. [00:30] Every recursive function needs a base case to stop.');
  form.append('resources', new Blob(['Recursion notes: base case and recursive case.'], { type: 'text/plain' }), 'notes.txt');
  const l = (await api('POST', `/modules/${m.id}/lectures`, { token: instructor.access_token, form, expect: 201 })).data;
  return `${c.status}, lecture ingest=${l.ingest_status}, ${l.resources.length} resource`;
});
await step('RBAC: other instructor cannot edit this course', async () => {
  const priya = await login('priya@vertexlearn.ai');
  await api('PUT', `/courses/${ctx.newCourse}`, { token: priya.access_token, body: { title: 'Hijacked' }, expect: 403 });
});
await aiStep('AI quiz generation → draft → publish', async () => {
  const q = (await api('POST', `/ai/lectures/${ctx.lectureId}/generate-quiz`, { token: instructor.access_token, body: { num_questions: 5 }, expect: 201 })).data;
  if (q.status !== 'draft') throw new Error('should be a draft');
  const p = (await api('PUT', `/quizzes/${q.id}`, { token: instructor.access_token, body: { status: 'published' } })).data;
  await api('DELETE', `/quizzes/${q.id}`, { token: instructor.access_token });
  return `${q.questions.length} questions${q.is_demo ? ' (demo)' : ''}, now ${p.status}`;
});
await step('grade a submission', async () => {
  const g = (await api('PUT', `/submissions/${ctx.submissionId}/grade`, { token: instructor.access_token, body: { grade: 88, feedback: 'Nice work' } })).data;
  return `grade ${g.grade}`;
});
await step('post announcement', async () => {
  const a = (await api('POST', `/courses/${ctx.dsa.id}/announcements`, { token: instructor.access_token, body: { title: 'Smoke announcement', content: 'Testing', email: false }, expect: 201 })).data;
  await api('DELETE', `/announcements/${a.id}`, { token: instructor.access_token });
  return `notified ${a.notified}`;
});

console.log('\nAdmin');
await step('platform overview', async () => {
  const d = (await api('GET', '/admin/analytics/overview', { token: admin.access_token })).data.totals;
  return `${d.users} users, ${d.courses} courses, ${d.enrollments} enrollments, revenue ₹${d.revenue}`;
});
await step('revenue overview', async () => (await api('GET', '/admin/analytics/revenue', { token: admin.access_token })).data.monthly.length + ' months');
await step('approval queue → approve', async () => {
  const q = (await api('GET', '/admin/courses/pending', { token: admin.access_token })).data.data;
  const mine = q.find((c) => c.id === ctx.newCourse);
  await api('POST', `/courses/${mine.id}/approve`, { token: admin.access_token, body: { decision: 'approved', comment: 'ok' } });
  return `${q.length} pending`;
});
await step('user management: search, roles, suspend/reactivate', async () => {
  const users = (await api('GET', '/admin/users?q=arjun', { token: admin.access_token })).data.data;
  const u = users[0];
  await api('PUT', `/admin/users/${u.id}/role`, { token: admin.access_token, body: { roles: ['student', 'instructor'] } });
  await api('PUT', `/admin/users/${u.id}/role`, { token: admin.access_token, body: { roles: ['student'] } });
  await api('PUT', `/admin/users/${u.id}/suspend`, { token: admin.access_token, body: { suspended: true } });
  await api('POST', '/auth/login', { body: { email: 'arjun@example.com', password: PASSWORD }, expect: 403 });
  await api('PUT', `/admin/users/${u.id}/suspend`, { token: admin.access_token, body: { suspended: false } });
  return u.email;
});
await step('moderation queue → dismiss report', async () => {
  const f = (await api('GET', '/admin/moderation/flagged-posts', { token: admin.access_token })).data.data;
  await api('PUT', `/admin/moderation/posts/${ctx.reportedPost}`, { token: admin.access_token, body: { action: 'dismiss' } });
  return `${f.length} flagged`;
});
await step('RBAC: student cannot open admin API', async () => {
  await api('GET', '/admin/users', { token: student.access_token, expect: 403 });
});
await step('cleanup: delete smoke course', async () => {
  await api('DELETE', `/courses/${ctx.newCourse}`, { token: admin.access_token });
});

console.log(`\n${passed} passed, ${failed} failed${skipped ? `, ${skipped} skipped (AI service not part of this run)` : ''}`);
process.exit(failed ? 1 : 0);
