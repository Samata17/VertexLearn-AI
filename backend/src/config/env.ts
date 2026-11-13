import fs from 'node:fs';
import { z } from 'zod';

/**
 * All configuration comes from environment variables (never hard-coded secrets).
 * zod validates them at startup so a missing/invalid value fails fast with a clear message.
 *
 * Secrets can also be supplied as files (Docker/Kubernetes secrets): set NAME_FILE=/run/secrets/name
 * instead of NAME. The file's contents are used, so the secret never appears in `docker inspect`.
 */
const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().default(4000),
  APP_URL: z.string().default('http://localhost:5173'),
  CORS_ORIGINS: z.string().default('http://localhost:5173,http://localhost:8080'),

  DATABASE_URL: z.string().default('postgres://vertex:vertex@localhost:5432/vertexlearn'),
  REDIS_URL: z.string().default('redis://localhost:6379'),

  JWT_ACCESS_SECRET: z.string().min(16).default('dev-access-secret-change-me-please'),
  JWT_REFRESH_SECRET: z.string().min(16).default('dev-refresh-secret-change-me-please'),
  JWT_ACCESS_TTL: z.string().default('15m'),
  JWT_REFRESH_TTL_DAYS: z.coerce.number().default(7),
  FILE_URL_SECRET: z.string().min(16).default('dev-file-url-secret-change-me'),

  S3_ENDPOINT: z.string().default('http://localhost:8333'),
  S3_REGION: z.string().default('us-east-1'),
  S3_BUCKET: z.string().default('vertexlearn'),
  S3_ACCESS_KEY: z.string().default('vertexlearn'),
  S3_SECRET_KEY: z.string().default('vertexlearn-secret'),
  S3_FORCE_PATH_STYLE: z
    .string()
    .default('true')
    .transform((v) => v === 'true'),

  SMTP_HOST: z.string().default('localhost'),
  SMTP_PORT: z.coerce.number().default(1025),
  SMTP_USER: z.string().optional(),
  SMTP_PASS: z.string().optional(),
  MAIL_FROM: z.string().default('VertexLearn AI <no-reply@vertexlearn.local>'),

  AI_SERVICE_URL: z.string().default('http://localhost:8000'),
  AI_SERVICE_KEY: z.string().default('dev-internal-ai-key'),

  MAX_UPLOAD_MB: z.coerce.number().default(500),
  AUTH_RATE_LIMIT: z.coerce.number().default(10), // PRD 8.9: 10 credential requests / minute / IP
  LOG_LEVEL: z.string().default('info'),
  // How many reverse proxies sit in front of the API (nginx = 1; nginx behind a cloud load balancer = 2).
  // Used to read the real client IP for rate limiting.
  TRUST_PROXY: z.coerce.number().int().min(0).default(1),
  APP_VERSION: z.string().default('dev'), // set to the Git commit SHA at image build time (PRD 14.5)
});

/** Copy NAME_FILE contents into NAME for every known setting (only if NAME itself is not set). */
function loadSecretFiles() {
  for (const key of Object.keys(schema.shape)) {
    const file = process.env[`${key}_FILE`];
    if (!file || process.env[key]) continue;
    try {
      process.env[key] = fs.readFileSync(file, 'utf8').trim();
    } catch (err) {
      console.error(`Could not read ${key}_FILE (${file}): ${(err as Error).message}`);
      process.exit(1);
    }
  }
}
loadSecretFiles();

const parsed = schema.safeParse(process.env);
if (!parsed.success) {
  console.error('Invalid environment configuration:', parsed.error.flatten().fieldErrors);
  process.exit(1);
}

export const env = parsed.data;

/** Production must never run with the development defaults that are published in this repository. */
export function productionConfigProblems(e: typeof env): string[] {
  if (e.NODE_ENV !== 'production') return [];
  const problems: string[] = [];
  const secrets = {
    JWT_ACCESS_SECRET: e.JWT_ACCESS_SECRET,
    JWT_REFRESH_SECRET: e.JWT_REFRESH_SECRET,
    FILE_URL_SECRET: e.FILE_URL_SECRET,
    AI_SERVICE_KEY: e.AI_SERVICE_KEY,
  };
  for (const [name, value] of Object.entries(secrets)) {
    if (value.startsWith('dev-')) problems.push(`${name} is still the development default`);
    else if (value.length < 32) problems.push(`${name} must be at least 32 characters`);
  }
  if (e.JWT_ACCESS_SECRET === e.JWT_REFRESH_SECRET) problems.push('JWT_ACCESS_SECRET and JWT_REFRESH_SECRET must differ');
  if (e.S3_SECRET_KEY === 'vertexlearn-secret') problems.push('S3_SECRET_KEY is still the development default');
  if (/:vertex@/.test(e.DATABASE_URL)) problems.push('DATABASE_URL uses the development database password');
  return problems;
}

const problems = productionConfigProblems(env);
if (problems.length) {
  console.error(`Refusing to start in production:\n  - ${problems.join('\n  - ')}`);
  process.exit(1);
}
