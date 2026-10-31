import { timingSafeEqual } from 'node:crypto';
import { purgeBlobs } from '../blob-cleanup.mjs';

// Called by Vercel Cron (see vercel.json). Vercel sends `Authorization: Bearer <CRON_SECRET>` when CRON_SECRET is set.
export function createCleanupHandler({ secret, purge = purgeBlobs }) {
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!secret) { res.statusCode = 503; return res.end('Cleanup is not configured'); }
    const given = Buffer.from(req.headers.authorization ?? '');
    if (req.method !== 'GET' || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.statusCode = 401; return res.end('Unauthorized');
    }
    try {
      const deleted = await purge();
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ deleted }));
    } catch {
      res.statusCode = 500; return res.end('Cleanup failed');
    }
  };
}

export default function cleanup(req, res) {
  return createCleanupHandler({ secret: process.env.CRON_SECRET })(req, res);
}
