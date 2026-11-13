/**
 * Express application: security middleware → public routes → authenticated routes → error handling.
 * Route order matters: public routers are mounted before routers that require a login.
 */
import cors from 'cors';
import express, { Router } from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { liveness, readiness } from './health.js';
import { optionalAuth } from './middleware/auth.js';
import { errorHandler, notFoundHandler } from './middleware/errorHandler.js';
import { apiLimiter } from './middleware/rateLimit.js';
import { requestLogger } from './middleware/requestLogger.js';
import { adminRouter } from './modules/admin/admin.routes.js';
import { aiRouter } from './modules/ai/ai.routes.js';
import { assignmentsRouter } from './modules/assignments/assignments.routes.js';
import { authRouter } from './modules/auth/auth.routes.js';
import { coursesRouter } from './modules/courses/courses.routes.js';
import { dashboardRouter } from './modules/dashboard/dashboard.routes.js';
import { discussionsRouter } from './modules/discussions/discussions.routes.js';
import { enrollmentsRouter } from './modules/enrollments/enrollments.routes.js';
import { filesRouter } from './modules/files/files.routes.js';
import { gamificationPublicRouter, gamificationRouter } from './modules/gamification/gamification.routes.js';
import { notificationsRouter } from './modules/notifications/notifications.routes.js';
import { quizzesRouter } from './modules/quizzes/quizzes.routes.js';
import { usersRouter } from './modules/users/users.routes.js';

export function createApp() {
  const app = express();
  app.set('trust proxy', env.TRUST_PROXY); // behind nginx: use X-Forwarded-For for client IPs (rate limits)
  app.disable('x-powered-by');
  app.use(helmet({ crossOriginResourcePolicy: { policy: 'same-site' } }));
  app.use(cors({ origin: env.CORS_ORIGINS.split(',').map((s) => s.trim()), credentials: true }));
  app.use(express.json({ limit: '1mb' }));
  app.use(requestLogger);

  // Health checks (PRD 6: "health-check endpoints per service"). See health.ts for the rules.
  app.get('/health/live', liveness);
  app.get('/health', readiness);
  app.get('/health/ready', readiness);

  const api = Router();
  api.get('/health', readiness);

  // Public (no login required)
  api.use('/auth', authRouter);
  api.use(filesRouter);
  api.use(gamificationPublicRouter);
  api.use(optionalAuth, apiLimiter);
  api.use(coursesRouter); // catalog & detail are public; authoring routes check auth per-route

  // Authenticated
  api.use(usersRouter);
  api.use(adminRouter);
  api.use(aiRouter);
  api.use(dashboardRouter);
  api.use(enrollmentsRouter);
  api.use(assignmentsRouter);
  api.use(quizzesRouter);
  api.use(gamificationRouter);
  api.use(discussionsRouter);
  api.use(notificationsRouter);

  app.use('/api/v1', api);
  app.use(notFoundHandler);
  app.use(errorHandler);
  return app;
}
