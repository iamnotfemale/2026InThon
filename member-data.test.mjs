import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberDataHandlers } from './member-data.mjs';
import { scheduleProblem, parseContentId, contentIdOf, calendarContent } from './public/js/calendar-rules.js';

const ORIGIN = 'https://inthon.yeoziphab.com';
const TOKEN = 'Bearer member-a-token-0123456789';
const UID = '11111111-1111-4111-8111-111111111111';
const place = (position, name) => ({ position, name, category: '한식', intro: null, area: '성수동', address: null, phone: null, hours: null,
  closed: null, price_range: null, reservation: null, waiting: null, parking: null, links: [], evidence: {}, checks: [], restaurant_menus: [] });
const ROWS = {
  5: { id: 5, created_at: '2026-10-30T00:00:00Z', status: 'done', topic: 'restaurant', claim: '맛집 두 곳', verdict: null, reason: '{}',
    sources: [], dm_status: 'sent', dm_sent_at: null, restaurants: [place(1, '가상 국수집'), place(2, '가상 만두집')] },
  6: { id: 6, created_at: '2026-10-30T00:00:00Z', status: 'done', topic: null, claim: '뉴스 주장', verdict: 'supported', reason: '근거가 있어요.',
    sources: [], dm_status: 'sent', dm_sent_at: null },
};

/** A tiny PostgREST stand-in: the member sees rows 5 and 6 (row 7 belongs to someone else). */
function fakeDb() {
  const events = []; const taste = []; const requests = []; let n = 0;
  const json = (status, value) => new Response(value === undefined ? null : JSON.stringify(value), { status });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); const q = u.searchParams; const method = init.method ?? 'GET';
    requests.push([method, u.pathname + u.search, init.headers?.Prefer]);
    if (init.headers.Authorization !== TOKEN) return json(401, {});
    if (u.pathname === '/auth/v1/user') return json(200, { id: UID });
    const eq = name => q.get(name)?.replace(/^eq\./, '');
    if (u.pathname === '/rest/v1/factchecks') return json(200, ROWS[eq('id')] ? [ROWS[eq('id')]] : []);
    if (u.pathname === '/rest/v1/calendar_events') {
      const body = init.body ? JSON.parse(init.body) : null;
      if (method === 'POST') {
        if (body.factcheck_id === 7) return json(403, {});
        if (events.some(e => e.idempotency_key === body.idempotency_key)) return json(201, []);
        const row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, revision: 1, ...body }; events.push(row); return json(201, [row]);
      }
      if (method === 'DELETE') { const i = events.findIndex(e => e.id === eq('id')); if (i >= 0) events.splice(i, 1); return json(204); }
      let list = events.filter(e => (!eq('id') || e.id === eq('id')) && (!eq('idempotency_key') || e.idempotency_key === decodeURIComponent(eq('idempotency_key'))));
      if (method === 'PATCH') {
        list = list.filter(e => String(e.revision) === eq('revision')); list.forEach(e => Object.assign(e, body)); return json(200, list);
      }
      const dates = q.getAll('date');
      if (dates.length) list = list.filter(e => e.date >= dates[0].slice(4) && e.date <= dates[1].slice(4));
      return json(200, list.slice(Number(q.get('offset') ?? 0)));
    }
    if (u.pathname === '/rest/v1/taste_collections') {
      if (method === 'POST') { const body = JSON.parse(init.body);
        if (!taste.some(t => t.factcheck_id === body.factcheck_id && t.item_index === body.item_index)) taste.push({ ...body, created_at: '2026-11-01T01:00:00Z' });
        return json(201); }
      if (method === 'DELETE') { const i = taste.findIndex(t => t.factcheck_id === Number(eq('factcheck_id')) && t.item_index === Number(eq('item_index'))); if (i >= 0) taste.splice(i, 1); return json(204); }
      return json(200, taste.slice(Number(q.get('offset') ?? 0)));
    }
    return json(404, {});
  };
  return { events, taste, requests, fetchImpl };
}

function call(handler, { method = 'GET', url = '/', body, headers = {} }) {
  const raw = body === undefined ? '' : JSON.stringify(body);
  const req = { method, url, headers: { origin: ORIGIN, authorization: TOKEN, ...headers }, async *[Symbol.asyncIterator]() { if (raw) yield raw; } };
  return new Promise(resolve => {
    const res = { status: 0, writeHead(status) { this.status = status; }, end(text) { resolve({ status: this.status, body: text ? JSON.parse(text) : null }); } };
    handler(req, res);
  });
}
const setup = () => { const db = fakeDb(); return { db, ...createMemberDataHandlers({ fetchImpl: db.fetchImpl, origin: ORIGIN,
  now: () => new Date('2026-11-01T01:00:00Z'), supabaseUrl: 'https://db.test', publishableKey: 'pk' }) }; };
const create = (calendar, body, key = 'ev:first-key') => call(calendar, { method: 'POST', url: '/api/calendar', body, headers: { 'idempotency-key': key } });

test('content IDs name one card; schedule rules match the browser', () => {
  assert.deepEqual(parseContentId('fc42'), { factcheckId: 42, index: 1 });
  assert.deepEqual(parseContentId('fc42-2'), { factcheckId: 42, index: 2 });
  for (const bad of ['fc42-1', 'fc042', 'fc0', 'x42', 'fc42-2-3', '']) assert.equal(parseContentId(bad), null, bad);
  assert.equal(contentIdOf(42, 1), 'fc42'); assert.equal(contentIdOf(42, 2), 'fc42-2');
  const exhibit = calendarContent({ type: 'exhibit', title: '전시', exhibitEvent: { start: '2026-11-04', end: '2026-11-12' } });
  const contest = calendarContent({ type: 'contest', title: '공모전', contestEvents: [{ type: 'deadline', date: '2026-11-09', time: '18:00' }] });
  const at = (content, fields, options = { today: '2026-11-01' }) => scheduleProblem(content, { time: null, ...fields }, options);
  assert.equal(at(exhibit, { kind: 'visit', date: '2026-11-05' }), null);
  assert.equal(at(exhibit, { kind: 'visit', date: '2026-11-15' }), 'period');
  assert.equal(at(exhibit, { kind: 'cook', date: '2026-11-05' }), 'kind');
  assert.equal(at(exhibit, { kind: 'visit', date: '2026-11-05', time: '25:00' }), 'time');
  assert.equal(at(exhibit, { kind: 'visit', date: '2026-10-31' }), 'past');
  assert.equal(at(contest, { kind: 'deadline', date: '2026-11-09', time: '18:00' }), null);
  assert.equal(at(contest, { kind: 'deadline', date: '2026-11-09' }), 'fixed', 'a confirmed time is not dropped');
  assert.equal(at(contest, { kind: 'prep', date: '2026-11-03' }), null, 'unconfirmed kinds are free');
  assert.equal(at({ type: 'news' }, { kind: 'visit', date: '2026-11-05' }), 'content');
  assert.equal(at({ type: 'recipe' }, { kind: 'cook', date: '2026-10-20' }, { today: '2026-11-01', allowPast: true }), null);
});

test('calendar API: login, origin and card checks come before any write', async () => {
  const { calendar, db } = setup();
  assert.equal((await call(calendar, { url: '/api/calendar?from=2026-11-01&to=2026-11-30', headers: { authorization: '' } })).status, 401);
  assert.equal((await call(calendar, { url: '/api/calendar?from=2026-11-01&to=2026-11-30', headers: { authorization: 'Bearer someone-else-token-000' } })).status, 401);
  assert.equal((await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: null }, 'ev:k')).status, 400, 'short idempotency key');
  assert.equal((await call(calendar, { method: 'POST', url: '/api/calendar', headers: { origin: 'https://evil.test', 'idempotency-key': 'ev:abcdefgh' },
    body: { content_id: 'fc5', kind: 'visit', date: '2026-11-07' } })).status, 403);
  assert.equal((await create(calendar, { content_id: 'fc5-3', kind: 'visit', date: '2026-11-07', time: null })).status, 404, 'no third place in that post');
  assert.equal((await create(calendar, { content_id: 'fc7', kind: 'visit', date: '2026-11-07', time: null })).status, 404, "someone else's result");
  assert.equal((await create(calendar, { content_id: 'fc6', kind: 'visit', date: '2026-11-07', time: null })).status, 422, 'news has no schedules');
  assert.equal((await create(calendar, { content_id: 'fc5', kind: 'cook', date: '2026-11-07', time: null })).status, 422);
  assert.equal((await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-10-30', time: null })).status, 422, 'no new past schedules');
  assert.equal((await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '7pm' })).status, 422);
  assert.equal((await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: null, timezone: 'UTC' })).status, 422);
  assert.equal(db.events.length, 0);
  assert.ok(!db.requests.some(([, path]) => path.includes('user_id')), 'ownership comes from the JWT, never a request field');
});

test('calendar API: two places of one post stay separate; retries, edits, conflicts and deletes behave', async () => {
  const { calendar, db } = setup();
  const first = await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '12:00', user_id: 'someone-else' });
  assert.equal(first.status, 201);
  assert.deepEqual(first.body, { id: first.body.id, content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '12:00', timezone: 'Asia/Seoul', revision: 1 });
  assert.equal(db.events[0].user_id, undefined, 'the database fills user_id from the JWT');
  const second = await create(calendar, { content_id: 'fc5-2', kind: 'visit', date: '2026-11-07', time: null }, 'ev:second-key');
  assert.equal(second.body.content_id, 'fc5-2'); assert.deepEqual([db.events[1].factcheck_id, db.events[1].item_index], [5, 2]);
  const retry = await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '12:00' });
  assert.equal(retry.status, 200); assert.equal(retry.body.id, first.body.id); assert.equal(db.events.length, 2, 'no duplicate on retry');
  const imported = await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-10-20', time: null, import: true }, 'import:browser:1');
  assert.equal(imported.status, 201, 'old browser records keep their date');

  const list = await call(calendar, { url: '/api/calendar?from=2026-11-01&to=2026-11-30' });
  assert.deepEqual(list.body.events.map(e => e.content_id), ['fc5', 'fc5-2']); assert.equal(list.body.reminders_available, false);
  assert.equal((await call(calendar, { url: '/api/calendar?from=2026-11-30&to=2026-11-01' })).status, 400);
  assert.equal((await call(calendar, { url: '/api/calendar?from=2026-01-01&to=2030-01-01' })).status, 400);

  const id = first.body.id;
  const edited = await call(calendar, { method: 'PATCH', url: '/api/calendar?id=' + id, body: { kind: 'visit', date: '2026-11-08', time: '13:00', revision: 1 } });
  assert.equal(edited.status, 200); assert.equal(edited.body.revision, 2); assert.equal(edited.body.date, '2026-11-08');
  const stale = await call(calendar, { method: 'PATCH', url: '/api/calendar?id=' + id, body: { kind: 'visit', date: '2026-11-09', time: null, revision: 1 } });
  assert.equal(stale.status, 409);
  assert.equal((await call(calendar, { method: 'PATCH', url: '/api/calendar?id=' + id, body: { kind: 'visit', date: '2026-10-30', time: null, revision: 2 } })).status, 422);
  // An imported past schedule can still change its time on the same day.
  assert.equal((await call(calendar, { method: 'PATCH', url: '/api/calendar?id=' + imported.body.id, body: { kind: 'visit', date: '2026-10-20', time: '10:00', revision: 1 } })).status, 200);
  assert.equal((await call(calendar, { method: 'DELETE', url: '/api/calendar?id=' + id })).status, 204);
  assert.equal((await call(calendar, { method: 'DELETE', url: '/api/calendar?id=' + id })).status, 204, 'deleting twice is safe');
  assert.equal((await call(calendar, { method: 'DELETE', url: '/api/calendar?id=not-a-uuid' })).status, 400);
});

test('taste API: idempotent add per card, removal keeps everything else, news cannot be collected', async () => {
  const { taste, calendar, db } = setup();
  assert.equal((await call(taste, { method: 'PUT', url: '/api/taste?id=fc5-2' })).status, 200);
  assert.equal((await call(taste, { method: 'PUT', url: '/api/taste?id=fc5-2' })).status, 200);
  assert.equal(db.taste.length, 1);
  assert.equal((await call(taste, { method: 'PUT', url: '/api/taste?id=fc6' })).status, 422);
  assert.equal((await call(taste, { method: 'PUT', url: '/api/taste?id=fc7' })).status, 404);
  assert.equal((await call(taste, { method: 'PUT', url: '/api/taste?id=fc5-1' })).status, 400);
  assert.deepEqual((await call(taste, { url: '/api/taste' })).body, { items: [{ content_id: 'fc5-2', collected_at: '2026-11-01T01:00:00Z' }] });
  await create(calendar, { content_id: 'fc5-2', kind: 'visit', date: '2026-11-07', time: null });
  assert.equal((await call(taste, { method: 'DELETE', url: '/api/taste?id=fc5-2' })).status, 204);
  assert.equal(db.taste.length, 0); assert.equal(db.events.length, 1, 'the schedule stays');
  assert.equal((await call(taste, { method: 'POST', url: '/api/taste' })).status, 405);
});
