// Daily cleanup of temporary Vercel Blob files, matching the retention periods in the privacy policy (/privacy).
// Files are judged by their last write (uploadedAt). Runs once a day, so expired files go within a day of expiry.
import { list, del } from '@vercel/blob';

const HOUR = 3600000; const DAY = 24 * HOUR;
export const CLEANUP_RULES = [
  { prefix: 'dm/chat/', maxAge: HOUR },          // recent chat context: used for 30 minutes
  { prefix: 'dm/choices/', maxAge: HOUR },       // shared content awaiting an action choice: 20 minutes
  { prefix: 'dm/link-codes/', maxAge: HOUR },    // signup verification codes, reservations, attempt limits: 10 minutes
  { prefix: 'dm/media-jobs/', maxAge: HOUR },    // media being analysed: normally deleted right after analysis
  { prefix: 'dm/media-probes/', maxAge: DAY },   // time-limited operator media capture: at most 30 minutes
  { prefix: 'dm/oauth/', maxAge: DAY },          // operator login replay markers: 10 minutes
  { prefix: 'dm/receipts/', maxAge: 90 * DAY },  // legacy Blob receipt metadata (before Supabase): 90 days
  { prefix: 'dm/replies/', maxAge: 90 * DAY },   // legacy Blob reply reservations: 90 days
];
// Never touched here: dm/credentials/ (the bot's own access tokens) and dm/preferences/ (members' settings,
// deleted with the account).

export async function purgeBlobs({ listBlobs = list, deleteBlobs = del, now = Date.now, rules = CLEANUP_RULES } = {}) {
  const deleted = {};
  for (const { prefix, maxAge } of rules) {
    const cutoff = now() - maxAge; let cursor; let count = 0;
    do {
      const page = await listBlobs({ prefix, cursor, limit: 1000 });
      const stale = page.blobs.filter(blob => new Date(blob.uploadedAt).getTime() < cutoff).map(blob => blob.pathname);
      if (stale.length) { await deleteBlobs(stale); count += stale.length; }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    deleted[prefix] = count;
  }
  return deleted;
}
