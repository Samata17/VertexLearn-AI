#!/usr/bin/env node
/**
 * Creates the secret files used by docker-compose.prod.yml (PRD 14.3 "secrets manager").
 *
 *   node scripts/generate-secrets.mjs                 → writes ./secrets/*
 *   node scripts/generate-secrets.mjs --dir <folder>  → writes somewhere else (then set SECRETS_DIR=<folder>)
 *   node scripts/generate-secrets.mjs --force         → replaces existing files (ROTATES every secret!)
 *
 * Existing files are kept unless --force is given, so it is safe to run again.
 * Two files are created EMPTY for you to fill in: gcp_service_account.json (Vertex AI service-account key;
 * leave empty on Google Cloud, where the attached service account is used) and smtp_pass.
 *
 * On a cloud platform (ECS, Render, Kubernetes...) put the same values in its secrets manager instead.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const force = args.includes('--force');
const dirArg = args.indexOf('--dir');
const dir = path.resolve(dirArg >= 0 ? args[dirArg + 1] : 'secrets');

const random = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url'); // URL-safe: fine inside connection URLs

fs.mkdirSync(dir, { recursive: true, mode: 0o700 });

const existing = (name) => {
  const p = path.join(dir, name);
  return fs.existsSync(p) ? fs.readFileSync(p, 'utf8').trim() : undefined;
};

// Values that other files depend on are resolved first (re-using existing ones unless --force).
const keep = (name, make) => (!force && existing(name) !== undefined ? existing(name) : make());
const postgresPassword = keep('postgres_password', () => random(24));
const redisPassword = keep('redis_password', () => random(24));
const s3Secret = keep('s3_secret_key', () => random(30));
const s3AccessKey = process.env.S3_ACCESS_KEY || 'vertexlearn';

const files = {
  postgres_password: postgresPassword,
  database_url: `postgresql://vertex:${postgresPassword}@postgres:5432/vertexlearn`,
  redis_password: redisPassword,
  redis_url: `redis://:${redisPassword}@redis:6379`,
  jwt_access_secret: random(),
  jwt_refresh_secret: random(),
  file_url_secret: random(),
  ai_service_key: random(),
  s3_secret_key: s3Secret,
  's3_config.json': JSON.stringify(
    {
      identities: [
        {
          name: 'vertexlearn',
          credentials: [{ accessKey: s3AccessKey, secretKey: s3Secret }],
          actions: ['Admin', 'Read', 'Write', 'List', 'Tagging'],
        },
      ],
    },
    null,
    2,
  ),
  'gcp_service_account.json': '', // Vertex AI service-account key JSON (empty = metadata-server credentials or demo mode)
  smtp_pass: '', //         your email provider's SMTP password
};

let written = 0;
for (const [name, value] of Object.entries(files)) {
  const p = path.join(dir, name);
  if (fs.existsSync(p) && !force) continue;
  // 0644 inside a 0700 folder: only your user can reach the folder on the server, while the
  // non-root users inside the containers can still read the mounted file.
  fs.writeFileSync(p, value, { mode: 0o644 });
  written++;
}

console.log(`Secrets folder: ${dir}`);
console.log(written ? `Wrote ${written} file(s).` : 'All files already existed — nothing changed (use --force to rotate).');
console.log('Next: put a Vertex AI service-account key in gcp_service_account.json (optional; leave empty on Google Cloud)');
console.log('      and your SMTP password in smtp_pass. Set GOOGLE_CLOUD_PROJECT in .env.production to switch on live AI.');
console.log('Never commit this folder. It is listed in .gitignore.');
