/**
 * Minimal migration runner.
 * - Every *.sql file in ./migrations runs once, in filename order.
 * - Applied files are recorded in the schema_migrations table.
 * - Each file runs inside a transaction, so a failing migration leaves no half-applied changes.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { pool } from './pool.js';
import { logger } from '../utils/logger.js';

const here = path.dirname(fileURLToPath(import.meta.url));

function migrationsDir() {
  // Works for both `tsx src/db/migrate.ts` and compiled `node dist/db/migrate.js`
  const candidates = [path.join(here, 'migrations'), path.join(here, '../../src/db/migrations')];
  const dir = candidates.find((d) => fs.existsSync(d));
  if (!dir) throw new Error('migrations folder not found');
  return dir;
}

// Any fixed number: a Postgres advisory lock so that several API replicas starting at the same
// time (PRD 14.4 horizontal scaling) run migrations one after another instead of racing.
const MIGRATION_LOCK_ID = 727_001;

export async function runMigrations() {
  const lock = await pool.connect();
  try {
    await lock.query('SELECT pg_advisory_lock($1)', [MIGRATION_LOCK_ID]);
    await pool.query(`CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TIMESTAMPTZ DEFAULT now()
    )`);
    const applied = new Set(
      (await pool.query<{ name: string }>('SELECT name FROM schema_migrations')).rows.map((r) => r.name),
    );
    const dir = migrationsDir();
    const files = fs.readdirSync(dir).filter((f) => f.endsWith('.sql')).sort();

    for (const file of files) {
      if (applied.has(file)) continue;
      const sql = fs.readFileSync(path.join(dir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        logger.info(`Applied migration ${file}`);
      } catch (err) {
        await client.query('ROLLBACK');
        throw new Error(`Migration ${file} failed: ${(err as Error).message}`);
      } finally {
        client.release();
      }
    }
    logger.info('Migrations up to date');
  } finally {
    await lock.query('SELECT pg_advisory_unlock($1)', [MIGRATION_LOCK_ID]).catch(() => undefined);
    lock.release();
  }
}

// Allow `npm run migrate`
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runMigrations()
    .then(() => pool.end())
    .catch((err) => {
      logger.error(err.message);
      process.exit(1);
    });
}
