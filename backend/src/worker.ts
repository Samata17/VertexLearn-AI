/**
 * Background worker (PRD 9.1 "Notification Service (Node.js worker)" and 9.3 job types).
 * Runs as its own process/container so slow jobs never block the API.
 *
 *   ingest       → asks the AI service to chunk + embed a lecture's material
 *   certificate  → renders the completion certificate PDF and notifies the student
 *   email        → sends emails over SMTP
 *   maintenance  → daily streak evaluation, nightly recommendation recalculation (cron)
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { Worker, type Job } from 'bullmq';
import { env } from './config/env.js';
import { one, pool, query } from './db/pool.js';
import { connection, maintenanceQueue, QUEUES, type EmailJob } from './jobs/queues.js';
import { issueCertificate } from './lib/certificate.js';
import { transporter } from './lib/mailer.js';
import { callAI } from './modules/ai/aiClient.js';
import { evaluateStreaks } from './modules/gamification/gamification.service.js';
import { recalculateAll } from './modules/gamification/recommendations.service.js';
import { notify } from './modules/notifications/notify.js';
import { invalidateCatalog } from './modules/courses/courses.service.js';
import { logger } from './utils/logger.js';

const workers: Worker[] = [];
const onFail = (name: string) => (job: Job | undefined, err: Error) =>
  logger.warn(`Job failed: ${name}`, { id: job?.id, attempts: job?.attemptsMade, error: err.message });

workers.push(new Worker(QUEUES.ingest, async (job) => {
  const { lectureId } = job.data as { lectureId: string };
  try {
    const r = await callAI('/ingest/lecture', { lecture_id: lectureId }, 300_000);
    logger.info('Lecture ingested', { lectureId, chunks: r.chunks });
    const c = await one('SELECT m.course_id FROM lectures l JOIN modules m ON m.id = l.module_id WHERE l.id = $1', [lectureId]);
    if (c) await invalidateCatalog(c.course_id);
    return r;
  } catch (err) {
    if (job.attemptsMade + 1 >= (job.opts.attempts ?? 1)) {
      await query(`UPDATE lectures SET ingest_status = 'failed' WHERE id = $1`, [lectureId]);
    }
    throw err;
  }
}, { connection, concurrency: 2 }).on('failed', onFail('ingest')));

workers.push(new Worker(QUEUES.certificate, async (job) => {
  const { userId, courseId } = job.data as { userId: string; courseId: string };
  const cert = await issueCertificate(userId, courseId);
  const c = await one('SELECT title FROM courses WHERE id = $1', [courseId]);
  await notify(userId, {
    title: 'Your certificate is ready',
    body: `Download your certificate for "${c?.title}" (ID ${cert.certificate_code}).`,
    type: 'course',
    link: '/app/achievements',
  });
  return { id: cert.id };
}, { connection }).on('failed', onFail('certificate')));

workers.push(new Worker(QUEUES.email, async (job) => {
  const { to, subject, html } = job.data as EmailJob;
  await transporter.sendMail({ from: env.MAIL_FROM, to, subject, html });
}, { connection, concurrency: 5 }).on('failed', onFail('email')));

workers.push(new Worker(QUEUES.maintenance, async (job) => {
  if (job.name === 'streaks') return { reset: await evaluateStreaks() };
  if (job.name === 'recommendations') return { users: await recalculateAll() };
}, { connection }).on('failed', onFail('maintenance')));

async function scheduleCron() {
  await maintenanceQueue.upsertJobScheduler('daily-streaks', { pattern: '5 0 * * *' }, { name: 'streaks' });
  await maintenanceQueue.upsertJobScheduler('nightly-recommendations', { pattern: '0 2 * * *' }, { name: 'recommendations' });
}

scheduleCron()
  .then(() => logger.info('Worker started: ingest, certificate, email, maintenance'))
  .catch((err) => logger.error('Failed to schedule cron jobs', { error: err.message }));

// Heartbeat for the container health check: the worker has no HTTP port, so every 15 s it checks
// that Redis (its job source) answers and then touches a file. Docker marks the container unhealthy
// when the file is older than 60 s (see the healthcheck in docker-compose.yml).
const HEARTBEAT_FILE = path.join(os.tmpdir(), 'worker-heartbeat');
const heartbeat = async () => {
  try {
    // BullMQ's client is an ioredis instance; its public type just doesn't declare ping().
    const client = (await maintenanceQueue.client) as unknown as { ping(): Promise<string> };
    if ((await client.ping()) === 'PONG') fs.writeFileSync(HEARTBEAT_FILE, String(Date.now()));
  } catch (err) {
    logger.warn('Worker heartbeat failed', { error: (err as Error).message });
  }
};
void heartbeat();
const heartbeatTimer = setInterval(heartbeat, 15_000);

const shutdown = async () => {
  clearInterval(heartbeatTimer);
  await Promise.all(workers.map((w) => w.close()));
  await pool.end();
  process.exit(0);
};
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
