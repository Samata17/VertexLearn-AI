/**
 * Background job queues (PRD 9.3), backed by Redis via BullMQ.
 * The API only *adds* jobs here; src/worker.ts processes them in a separate process,
 * so slow work (embedding, PDF generation, email) never slows down API responses.
 */
import { Queue } from 'bullmq';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

export const connection = { url: env.REDIS_URL };

export const QUEUES = {
  ingest: 'ingest', //          chunk + embed lecture material into pgvector
  certificate: 'certificate', // generate certificate PDF on course completion
  email: 'email', //             send emails
  maintenance: 'maintenance', // streak evaluation (daily), recommendation recalculation (nightly)
} as const;

const defaultJobOptions = {
  attempts: 3,
  backoff: { type: 'exponential' as const, delay: 3000 },
  removeOnComplete: 200,
  removeOnFail: 500,
};

export const ingestQueue = new Queue(QUEUES.ingest, { connection, defaultJobOptions });
export const certificateQueue = new Queue(QUEUES.certificate, { connection, defaultJobOptions });
export const emailQueue = new Queue(QUEUES.email, { connection, defaultJobOptions });
export const maintenanceQueue = new Queue(QUEUES.maintenance, { connection, defaultJobOptions });

export interface EmailJob {
  to: string;
  subject: string;
  html: string;
}

/** Queue an email. Failures to queue are logged, never thrown — email must not break the main action. */
export async function queueEmail(job: EmailJob) {
  try {
    await emailQueue.add('send', job);
  } catch (err) {
    logger.warn('Failed to queue email', { error: (err as Error).message });
  }
}

export async function queueIngest(lectureId: string) {
  await ingestQueue.add('lecture', { lectureId }, { jobId: `ingest-${lectureId}-${Date.now()}` });
}

export async function queueCertificate(userId: string, courseId: string) {
  await certificateQueue.add('generate', { userId, courseId }, { jobId: `cert-${userId}-${courseId}` });
}
