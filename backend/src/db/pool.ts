import pg from 'pg';
import { env } from '../config/env.js';
import { logger } from '../utils/logger.js';

// Return NUMERIC columns as JS numbers instead of strings (safe for our 5-10 digit values).
pg.types.setTypeParser(1700, (v) => (v === null ? null : Number(v)));
// Return BIGINT (e.g. COUNT(*)) as numbers.
pg.types.setTypeParser(20, (v) => (v === null ? null : Number(v)));
// Keep DATE columns as 'YYYY-MM-DD' strings (avoids timezone shifts).
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({ connectionString: env.DATABASE_URL, max: 20 });

pool.on('error', (err) => logger.error('Postgres pool error', { error: err.message }));

/** Run a parameterised query. Always use $1, $2 placeholders — never string-concatenate user input. */
export async function query<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  const res = await pool.query<T>(text, params);
  return res;
}

export async function one<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  const res = await pool.query<T>(text, params);
  return res.rows[0] as T | undefined;
}

export async function many<T extends pg.QueryResultRow = any>(text: string, params: unknown[] = []) {
  const res = await pool.query<T>(text, params);
  return res.rows;
}

/** Run several queries atomically: all succeed or all are rolled back. */
export async function transaction<T>(fn: (client: pg.PoolClient) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}
