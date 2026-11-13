/**
 * Create the first admin account on a fresh production database (production never loads demo data).
 *
 *   docker compose -f docker-compose.yml -f docker-compose.prod.yml run --rm \
 *     -e ADMIN_EMAIL=you@company.com -e ADMIN_NAME="Your Name" -e ADMIN_PASSWORD='a-long-password' \
 *     backend node dist/db/seeders/create-admin.js
 *
 * If the email already exists, the account is given the admin role (its password is not changed).
 */
import bcrypt from 'bcryptjs';
import { one, pool, query } from '../pool.js';
import { runMigrations } from '../migrate.js';

async function main() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const name = process.env.ADMIN_NAME?.trim() || 'Administrator';
  const password = process.env.ADMIN_PASSWORD ?? '';
  if (!email || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('Set ADMIN_EMAIL to a valid email address');

  await runMigrations();
  const existing = await one<{ id: string }>('SELECT id FROM users WHERE email = $1', [email]);
  let userId = existing?.id;
  if (!userId) {
    if (password.length < 12) throw new Error('Set ADMIN_PASSWORD (at least 12 characters)');
    const hash = await bcrypt.hash(password, 12);
    userId = (await one<{ id: string }>(
      'INSERT INTO users (full_name, email, password_hash) VALUES ($1, $2, $3) RETURNING id',
      [name, email, hash],
    ))!.id;
    console.log(`Created user ${email}`);
  }
  await query(
    `INSERT INTO user_roles (user_id, role_id) SELECT $1, id FROM roles WHERE name = 'admin' ON CONFLICT DO NOTHING`,
    [userId],
  );
  console.log(`${email} is now an admin.`);
}

main()
  .then(() => pool.end())
  .catch(async (err) => {
    console.error(`create-admin failed: ${(err as Error).message}`);
    await pool.end();
    process.exit(1);
  });
