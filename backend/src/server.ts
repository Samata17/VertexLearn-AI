import { createApp } from './app.js';
import { env } from './config/env.js';
import { redis } from './config/redis.js';
import { pool } from './db/pool.js';
import { ensureBucket } from './lib/storage.js';
import { logger } from './utils/logger.js';

async function main() {
  // Object storage can take a few seconds to come up in Docker — retry bucket creation.
  for (let i = 0; i < 10; i++) {
    try {
      await ensureBucket();
      break;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  const server = createApp().listen(env.PORT, () => logger.info(`VertexLearn API listening on http://localhost:${env.PORT}`));

  // Graceful shutdown: stop accepting requests, finish in-flight ones, close connections.
  const shutdown = (signal: string) => {
    logger.info(`${signal} received, shutting down`);
    server.close(async () => {
      await pool.end().catch(() => undefined);
      redis.disconnect();
      process.exit(0);
    });
    setTimeout(() => process.exit(1), 10_000).unref();
  };
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT', () => shutdown('SIGINT'));
}

main().catch((err) => {
  logger.error('Failed to start', { error: err.message });
  process.exit(1);
});
