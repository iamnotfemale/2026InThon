import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberDataHandlers } from './member-data.mjs';
import { scheduleProblem, parseContentId, contentIdOf, calendarContent } from './public/js/calendar-rules.js';
import { reminderAt } from './public/js/reminder-rules.js';

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
function fakeDb({ window = null } = {}) {
  const events = []; const taste = []; const requests = []; let n = 0;
  // Stand-in for the database trigger: this revision's jobs, computed from the stored schedule.
  const withJobs = row => ({ ...row, calendar_reminder_jobs: (row.reminders ?? []).flatMap(key => {
    const at = reminderAt(key, row.date, row.time ?? null);
    return at ? [{ reminder_key: key, scheduled_at: at.toISOString(), status: 'scheduled', reason: null, sent_at: null, event_revision: row.revision }] : [];
  }) });
  const json = (status, value) => new Response(value === undefined ? null : JSON.stringify(value), { status });
  const fetchImpl = async (url, init = {}) => {
    const u = new URL(url); const q = u.searchParams; const method = init.method ?? 'GET';
    requests.push([method, u.pathname + u.search, init.headers?.Prefer]);
    if (init.headers.Authorization !== TOKEN) return json(401, {});
    if (u.pathname === '/auth/v1/user') return json(200, { id: UID });
    const eq = name => q.get(name)?.replace(/^eq\./, '');
    if (u.pathname === '/rest/v1/factchecks') return json(200, ROWS[eq('id')] ? [ROWS[eq('id')]] : []);
    if (u.pathname === '/rest/v1/rpc/my_dm_window') return window ? json(200, [window]) : json(404, {});
    if (u.pathname === '/rest/v1/calendar_events') {
      const body = init.body ? JSON.parse(init.body) : null;
      if (method === 'POST') {
        if (body.factcheck_id === 7) return json(403, {});
        if (events.some(e => e.idempotency_key === body.idempotency_key)) return json(201, []);
        const row = { id: `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`, revision: 1, ...body }; events.push(row); return json(201, [withJobs(row)]);
      }
      if (method === 'DELETE') { const i = events.findIndex(e => e.id === eq('id')); if (i >= 0) events.splice(i, 1); return json(204); }
      let list = events.filter(e => (!eq('id') || e.id === eq('id')) && (!eq('idempotency_key') || e.idempotency_key === decodeURIComponent(eq('idempotency_key'))));
      if (method === 'PATCH') {
        list = list.filter(e => String(e.revision) === eq('revision')); list.forEach(e => Object.assign(e, body)); return json(200, list.map(withJobs));
      }
      const dates = q.getAll('date');
      if (dates.length) list = list.filter(e => e.date >= dates[0].slice(4) && e.date <= dates[1].slice(4));
      return json(200, list.slice(Number(q.get('offset') ?? 0)).map(withJobs));
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
const setup = (options = {}) => { const db = fakeDb(options); return { db, ...createMemberDataHandlers({ fetchImpl: db.fetchImpl, origin: ORIGIN,
  now: () => new Date('2026-11-01T01:00:00Z'), supabaseUrl: 'https://db.test', publishableKey: 'pk', remindersAvailable: Boolean(options.reminders) }) }; };
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
  assert.deepEqual(first.body, { id: first.body.id, content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '12:00', timezone: 'Asia/Seoul', revision: 1,
    reminders: [], reminder_jobs: [] });
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

test('reminder options: refused until the feature is on; then canonical, KST-scheduled, kept or replaced on edit', async () => {
  const off = setup();
  const refused = await create(off.calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '12:00', reminders: ['day9'] });
  assert.equal(refused.status, 422); assert.match(refused.body.error, /준비 중/); assert.equal(off.db.events.length, 0);
  assert.equal((await create(off.calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '12:00', reminders: [] })).status, 201,
    'turning reminders off is always allowed');

  const ends = '2026-11-02T00:30:00Z';
  const { calendar, db } = setup({ reminders: true, window: { linked: true, window_ends_at: ends } });
  for (const [reminders, why] of [[['soon'], 'unknown key'], ['day9', 'not a list'], [[{ key: 'day9' }], 'not a key'], [Array(9).fill('day9'), 'too long']]) {
    assert.equal((await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '12:00', reminders })).status, 422, why);
  }
  const allDay = await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: null, reminders: ['h1'] });
  assert.equal(allDay.status, 422); assert.match(allDay.body.error, /종일/);
  const created = await create(calendar, { content_id: 'fc5', kind: 'visit', date: '2026-11-07', time: '00:30',
    reminders: ['eve', 'h1', 'day9', 'h1', 'd3'], status: 'sent', scheduled_at: '2026-11-01T00:00:00Z', igsid: '123' });
  assert.equal(created.status, 201);
  assert.deepEqual(created.body.reminders, ['day9', 'h1', 'eve', 'd3'], 'deduplicated, display order');
  assert.deepEqual(Object.keys(db.events[0]).sort(), ['date', 'factcheck_id', 'id', 'idempotency_key', 'item_index', 'kind', 'reminders', 'revision', 'time', 'timezone'],
    'status, send time and recipient are never taken from the request');
  assert.deepEqual(Object.fromEntries(created.body.reminder_jobs.map(job => [job.key, job.scheduled_at])), {
    h1: '2026-11-06T14:30:00.000Z',     // 00:30 KST on the 7th → 23:30 KST on the 6th
    day9: '2026-11-07T00:00:00.000Z', eve: '2026-11-06T11:00:00.000Z', d3: '2026-11-04T00:00:00.000Z' });
  assert.ok(created.body.reminder_jobs.every(job => job.status === 'scheduled' && !('igsid' in job)));

  const id = created.body.id;
  const kept = await call(calendar, { method: 'PATCH', url: '/api/calendar?id=' + id, body: { kind: 'visit', date: '2026-11-08', time: '10:00', revision: 1 } });
  assert.deepEqual(kept.body.reminders, ['day9', 'h1', 'eve', 'd3'], 'omitted on edit: the options stay');
  assert.equal(kept.body.reminder_jobs.find(job => job.key === 'day9').scheduled_at, '2026-11-08T00:00:00.000Z', 'jobs follow the new date');
  const toAllDay = await call(calendar, { method: 'PATCH', url: '/api/calendar?id=' + id, body: { kind: 'visit', date: '2026-11-08', time: null, revision: 2 } });
  assert.deepEqual(toAllDay.body.reminders, ['day9', 'eve', 'd3'], 'an all-day schedule drops "1시간 전"');
  const offAgain = await call(calendar, { method: 'PATCH', url: '/api/calendar?id=' + id, body: { kind: 'visit', date: '2026-11-08', time: null, revision: 3, reminders: [] } });
  assert.deepEqual(offAgain.body.reminders, []); assert.deepEqual(offAgain.body.reminder_jobs, []);

  const list = await call(calendar, { url: '/api/calendar?from=2026-11-01&to=2026-11-30' });
  assert.equal(list.body.reminders_available, true);
  assert.deepEqual(list.body.dm_eligibility, { eligible_now: true, reason: null, window_ends_at: ends });
  const closed = setup({ reminders: true, window: { linked: true, window_ends_at: '2026-11-01T00:59:00Z' } });
  assert.deepEqual((await call(closed.calendar, { url: '/api/calendar?from=2026-11-01&to=2026-11-30' })).body.dm_eligibility,
    { eligible_now: false, reason: 'window_closed', window_ends_at: null });
  const unlinked = setup({ reminders: true, window: { linked: false, window_ends_at: null } });
  assert.equal((await call(unlinked.calendar, { url: '/api/calendar?from=2026-11-01&to=2026-11-30' })).body.dm_eligibility.reason, 'not_linked');
  const broken = setup({ reminders: true });
  const fallback = await call(broken.calendar, { url: '/api/calendar?from=2026-11-01&to=2026-11-30' });
  assert.equal(fallback.status, 200, 'the schedule list never fails because of the window lookup');
  assert.equal(fallback.body.dm_eligibility, null);
});
