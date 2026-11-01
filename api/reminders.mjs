import { timingSafeEqual } from 'node:crypto';
import { createReminderStore, createReminderWorker } from '../reminder-worker.mjs';
import { loadAccessToken } from '../cloud-auth.mjs';
import { remindersConfigured } from '../reminder-config.mjs';

// GET /api/reminders/run, called every minute by Supabase pg_cron (see the migration) with `Authorization: Bearer <REMINDER_WORKER_SECRET>`.
// A secret of its own, separate from CRON_SECRET (daily cleanup), so either can be rotated independently.
export function createRemindersHandler({ secret, enabled, worker }) {
  const expected = Buffer.from(`Bearer ${secret ?? ''}`);
  return async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    if (!secret) { res.statusCode = 503; return res.end('Reminders are not configured'); }
    const given = Buffer.from(req.headers.authorization ?? '');
    if (req.method !== 'GET' || given.length !== expected.length || !timingSafeEqual(given, expected)) {
      res.statusCode = 401; return res.end('Unauthorized');
    }
    if (!enabled) { res.statusCode = 503; return res.end('Reminders are switched off'); }
    try {
      const counts = await worker()();
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(counts));
    } catch {
      res.statusCode = 500; return res.end('Reminder run failed');
    }
  };
}

export default function reminders(req, res) {
  return createRemindersHandler({ secret: process.env.REMINDER_WORKER_SECRET, enabled: remindersConfigured(),
    worker: () => createReminderWorker({ loadAccessToken, publicUrl: process.env.PUBLIC_URL,
      store: createReminderStore({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY }) }) })(req, res);
}
