import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { purgeBlobs, CLEANUP_RULES } from './blob-cleanup.mjs';
import { createCleanupHandler } from './api/cleanup.mjs';

const NOW = Date.parse('2026-11-01T00:00:00Z');
const ago = ms => new Date(NOW - ms).toISOString();
const HOUR = 3600000; const DAY = 24 * HOUR;

test('blob cleanup deletes only files past each prefix limit, across pages, and never touches tokens or member settings', async () => {
  const store = {
    'dm/chat/a.json': ago(2 * HOUR), 'dm/chat/b.json': ago(10 * 60000),
    'dm/choices/x.json': ago(3 * HOUR), 'dm/link-codes/users/u.json': ago(2 * HOUR), 'dm/link-codes/codes/c.json': ago(5 * 60000),
    'dm/media-jobs/j/1.jpg': ago(2 * HOUR), 'dm/media-probes/p/1.json': ago(2 * DAY), 'dm/oauth/states/s.json': ago(2 * DAY),
    'dm/receipts/r.json': ago(91 * DAY), 'dm/receipts/r2.json': ago(30 * DAY), 'dm/replies/k/sent.json': ago(91 * DAY),
    'dm/credentials/1.json': ago(400 * DAY), 'dm/preferences/h/delivery.json': ago(400 * DAY),
  };
  const lists = [];
  const listBlobs = async ({ prefix, cursor }) => {
    lists.push(prefix);
    const all = Object.entries(store).filter(([p]) => p.startsWith(prefix)).map(([pathname, uploadedAt]) => ({ pathname, uploadedAt }));
    const start = cursor ? Number(cursor) : 0; const page = all.slice(start, start + 1); // one per page: exercises pagination
    return { blobs: page, hasMore: start + 1 < all.length, cursor: String(start + 1) };
  };
  const deleted = [];
  const result = await purgeBlobs({ listBlobs, deleteBlobs: async paths => deleted.push(...paths), now: () => NOW });
  assert.deepEqual(deleted.sort(), ['dm/chat/a.json', 'dm/choices/x.json', 'dm/link-codes/users/u.json', 'dm/media-jobs/j/1.jpg',
    'dm/media-probes/p/1.json', 'dm/oauth/states/s.json', 'dm/receipts/r.json', 'dm/replies/k/sent.json'].sort());
  assert.equal(result['dm/chat/'], 1); assert.equal(result['dm/receipts/'], 1);
  assert.ok(!lists.some(p => p.startsWith('dm/credentials') || p.startsWith('dm/preferences')), 'tokens and member settings untouched');
  assert.ok(CLEANUP_RULES.every(r => r.prefix.startsWith('dm/') && r.prefix.endsWith('/')));
});

function respond() { return { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } }; }

test('the cron endpoint runs only with the exact Vercel cron secret', async () => {
  let runs = 0;
  const handler = createCleanupHandler({ secret: 's3cret', purge: async () => { runs++; return { 'dm/chat/': 2 }; } });
  for (const authorization of [undefined, 'Bearer wrong', 'Bearer s3cret ', 'bearer s3cret']) {
    const res = respond(); await handler({ method: 'GET', headers: { authorization } }, res);
    assert.equal(res.statusCode, 401, String(authorization));
  }
  const post = respond(); await handler({ method: 'POST', headers: { authorization: 'Bearer s3cret' } }, post);
  assert.equal(post.statusCode, 401);
  const ok = respond(); await handler({ method: 'GET', headers: { authorization: 'Bearer s3cret' } }, ok);
  assert.equal(ok.statusCode, undefined); assert.deepEqual(JSON.parse(ok.body), { deleted: { 'dm/chat/': 2 } });
  assert.equal(runs, 1);
  const off = respond(); await createCleanupHandler({ secret: undefined })({ method: 'GET', headers: {} }, off);
  assert.equal(off.statusCode, 503);
});

test('the daily cron and DB retention migration are registered', () => {
  const vercel = JSON.parse(readFileSync('vercel.json', 'utf8'));
  assert.deepEqual(vercel.crons, [{ path: '/api/cleanup', schedule: '40 18 * * *' }]);
  const migration = readdirSync('supabase/migrations').find(name => name.endsWith('_retention.sql'));
  const sql = readFileSync('supabase/migrations/' + migration, 'utf8');
  for (const rule of ["interval '90 days'", "interval '1 year'", "cron.schedule('purge-expired-data'", 'not exists (select 1 from public.account_links']) {
    assert.ok(sql.includes(rule), rule);
  }
});
