/**
 * Streams files from object storage to the browser.
 * Supports HTTP Range requests, which is what lets the video player seek and resume
 * without downloading the whole file ("progressive delivery", PRD 3.1).
 */
import { Router, type Response } from 'express';
import { Readable } from 'node:stream';
import { getObject, verifySignature } from '../../lib/storage.js';
import { forbidden, notFound } from '../../utils/errors.js';
import { ah } from '../../utils/http.js';

export const filesRouter = Router();

async function stream(key: string, range: string | undefined, res: Response, download?: string) {
  try {
    const obj = await getObject(key, range);
    res.status(range && obj.ContentRange ? 206 : 200);
    if (obj.ContentType) res.setHeader('Content-Type', obj.ContentType);
    if (obj.ContentLength != null) res.setHeader('Content-Length', String(obj.ContentLength));
    if (obj.ContentRange) res.setHeader('Content-Range', obj.ContentRange);
    res.setHeader('Accept-Ranges', 'bytes');
    res.setHeader('Cache-Control', key.startsWith('public/') ? 'public, max-age=86400' : 'private, max-age=3600');
    if (download) res.setHeader('Content-Disposition', `attachment; filename="${download.replace(/"/g, '')}"`);
    (obj.Body as Readable).pipe(res);
  } catch (err) {
    const name = (err as { name?: string }).name;
    if (name === 'NoSuchKey' || name === 'NotFound') throw notFound('File');
    if (name === 'InvalidRange') {
      res.status(416).end();
      return;
    }
    throw err;
  }
}

filesRouter.get('/files/stream', ah(async (req, res) => {
  const key = String(req.query.key ?? '');
  if (!verifySignature(key, Number(req.query.exp), String(req.query.sig ?? ''))) throw forbidden('This file link is invalid or has expired');
  const download = req.query.download ? key.split('/').pop()?.replace(/^\d+-[0-9a-f]{8}-/, '') : undefined;
  await stream(key, req.headers.range, res, download);
}));

filesRouter.get(/^\/files\/(public\/.+)$/, ah(async (req, res) => {
  const key = (req.params as unknown as Record<string, string>)[0];
  if (key.includes('..')) throw forbidden();
  await stream(key, req.headers.range, res);
}));
