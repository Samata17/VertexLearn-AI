/**
 * File storage on S3-compatible object storage (MinIO locally, AWS S3 in production).
 *
 * How files reach the browser:
 *  - Public files (thumbnails, avatars) live under "public/" and are served by GET /api/v1/files/public/...
 *  - Private files (videos, PDFs, submissions, certificates) need a signed URL:
 *    /api/v1/files/stream?key=...&exp=...&sig=...  The signature is an HMAC with a short expiry,
 *    so a <video> tag can stream it without an Authorization header, and links can't be guessed or reused forever.
 */
import crypto from 'node:crypto';
import path from 'node:path';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import multer from 'multer';
import { env } from '../config/env.js';
import { badRequest } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

export const s3 = new S3Client({
  endpoint: env.S3_ENDPOINT,
  region: env.S3_REGION,
  forcePathStyle: env.S3_FORCE_PATH_STYLE,
  credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
});

export async function ensureBucket() {
  try {
    await s3.send(new HeadBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    try {
      await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
      logger.info(`Created bucket ${env.S3_BUCKET}`);
    } catch (err) {
      logger.warn('Could not create bucket', { error: (err as Error).message });
    }
  }
}

const safeName = (name: string) =>
  path
    .basename(name)
    .replace(/[^a-zA-Z0-9._-]/g, '_')
    .slice(-120);

/** Upload a buffer. Returns the storage key ("s3://key"), which is what we save in the database. */
export async function putObject(folder: string, originalName: string, body: Buffer, contentType: string) {
  const key = `${folder}/${Date.now()}-${crypto.randomBytes(4).toString('hex')}-${safeName(originalName)}`;
  await s3.send(new PutObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Body: body, ContentType: contentType }));
  return `s3://${key}`;
}

export async function getObject(key: string, range?: string) {
  return s3.send(new GetObjectCommand({ Bucket: env.S3_BUCKET, Key: key, Range: range }));
}

export async function getObjectBuffer(key: string) {
  const obj = await getObject(key);
  const bytes = await obj.Body!.transformToByteArray();
  return Buffer.from(bytes);
}

export async function deleteObject(stored: string | null | undefined) {
  if (!stored?.startsWith('s3://')) return;
  try {
    await s3.send(new DeleteObjectCommand({ Bucket: env.S3_BUCKET, Key: stored.slice(5) }));
  } catch {
    /* best effort */
  }
}

/** Original filename from a storage key like "s3://lectures/123-abcd-notes.pdf" → "notes.pdf". */
export function displayName(stored: string) {
  const base = stored.split('/').pop() ?? stored;
  const m = base.match(/^\d+-[0-9a-f]{8}-(.+)$/);
  return m ? m[1] : base;
}

function sign(key: string, exp: number) {
  return crypto.createHmac('sha256', env.FILE_URL_SECRET).update(`${key}:${exp}`).digest('hex');
}

/**
 * Turn a stored value into a URL the browser can use.
 *  - External http(s) URLs (e.g. seeded sample videos) are returned unchanged.
 *  - s3://public/... → unsigned public URL
 *  - other s3:// keys → signed URL valid for `ttlSeconds`
 */
export function fileUrl(stored: string | null | undefined, ttlSeconds = 6 * 3600): string | null {
  if (!stored) return null;
  if (!stored.startsWith('s3://')) return stored;
  const key = stored.slice(5);
  if (key.startsWith('public/')) return `/api/v1/files/${key}`;
  const exp = Math.floor(Date.now() / 1000) + ttlSeconds;
  return `/api/v1/files/stream?key=${encodeURIComponent(key)}&exp=${exp}&sig=${sign(key, exp)}`;
}

export function verifySignature(key: string, exp: number, sig: string) {
  if (!key || !exp || !sig || exp < Date.now() / 1000) return false;
  const expected = sign(key, exp);
  return expected.length === sig.length && crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(sig));
}

// ---------------------------------------------------------------------------
// Upload validation (secure file uploads): files are held in memory, size-limited,
// and both the extension and MIME type must be on an allow-list.
// ---------------------------------------------------------------------------
const ALLOWED: Record<string, { ext: string[]; mime: RegExp }> = {
  video: { ext: ['.mp4', '.webm', '.mov', '.m4v'], mime: /^video\// },
  image: { ext: ['.png', '.jpg', '.jpeg', '.webp', '.gif'], mime: /^image\/(png|jpe?g|webp|gif)$/ },
  document: {
    ext: ['.pdf', '.ppt', '.pptx', '.doc', '.docx', '.txt', '.md'],
    mime: /^(application\/(pdf|msword|vnd\.|octet-stream)|text\/)/,
  },
  submission: {
    ext: ['.pdf', '.zip', '.txt', '.md', '.py', '.js', '.ts', '.java', '.c', '.cpp', '.ipynb', '.docx'],
    mime: /^(application\/|text\/)/,
  },
};

export function uploader(fields: Record<string, keyof typeof ALLOWED>, maxMb = env.MAX_UPLOAD_MB) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: maxMb * 1024 * 1024, files: 12 },
    fileFilter: (_req, file, cb) => {
      const kind = fields[file.fieldname];
      if (!kind) return cb(badRequest(`Unexpected file field "${file.fieldname}"`, file.fieldname));
      const rule = ALLOWED[kind];
      const ext = path.extname(file.originalname).toLowerCase();
      if (!rule.ext.includes(ext) || !rule.mime.test(file.mimetype)) {
        return cb(badRequest(`File type not allowed for ${file.fieldname}. Allowed: ${rule.ext.join(', ')}`, file.fieldname));
      }
      cb(null, true);
    },
  });
}
