import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createHmac } from 'node:crypto';
import { createReminderWorker, classifySendError } from './reminder-worker.mjs';
import { createRemindersHandler } from './api/reminders.mjs';
import { remindersConfigured } from './reminder-config.mjs';
import { createServers, IG_ID } from './server.mjs';
import { reminderAt, reminderText, reminderStatus, normalizeReminders, spokenTime } from './public/js/reminder-rules.js';

const NOW = new Date('2026-11-07T04:00:30Z');   // 13:00:30 KST
const USER = '11111111-1111-4111-8111-111111111111';
const EVENT = '00000000-0000-4000-8000-000000000001';
const place = { position: 1, name: '서도호: 개인전', category: '전시', intro: null, area: '종로', address: null, phone: null, hours: null, closed: null,
  price_range: null, reservation: null, waiting: null, parking: null, links: [], evidence: {}, checks: [], restaurant_menus: [] };

/** In-memory stand-in for the worker's Supabase access, with the same lease semantics as the SQL. */
function world({ inboundAt = '2026-11-07T01:00:00Z', jobs: extra = [] } = {}) {
  const state = {
    events: { [EVENT]: { id: EVENT, user_id: USER, factcheck_id: 42, item_index: 1, kind: 'visit', date: '2026-11-07', time: '14:00', revision: 2, reminders: ['h1'] } },
    links: { [USER]: { igsid: '555' } },
    results: { 42: { igsid: '555', id: 42, created_at: '2026-11-01T00:00:00Z', status: 'done', topic: 'restaurant', claim: '전시', verdict: null,
      reason: '{}', sources: [], dm_status: 'sent', dm_sent_at: null, restaurants: [place] } },
    inbound: inboundAt ? { 555: { last_message_at: inboundAt } } : {},
    jobs: [{ id: 1, event_id: EVENT, event_revision: 2, reminder_key: 'h1', scheduled_at: '2026-11-07T04:00:00Z', user_id: USER, igsid: '555',
      status: 'scheduled', attempts: 0 }, ...extra],
    claims: 0,
  };
  const store = {
    async claim(limit) {
      state.claims++;
      const due = state.jobs.filter(j => j.status === 'scheduled' && Date.parse(j.scheduled_at) <= NOW.getTime()).slice(0, limit);
      for (const job of due) Object.assign(job, { status: 'sending', claimed_at: `2026-11-07T04:00:3${state.claims}.000000+00:00`, attempts: job.attempts + 1 });
      return due.map(job => ({ ...job }));
    },
    event: async id => state.events[id] ?? null,
    link: async uid => state.links[uid] ?? null,
    result: async id => state.results[id] ?? null,
    inbound: async igsid => state.inbound[igsid] ?? null,
    async begin(job, at) {
      const row = state.jobs.find(j => j.id === job.id);
      if (row?.status !== 'sending' || row.claimed_at !== job.claimed_at) return false;
      row.request_started_at = at; return true;
    },
    async finish(job, fields) {
      if (state.failFinish) throw new Error('db down');
      const row = state.jobs.find(j => j.id === job.id);
      if (row?.status === 'sending' && row.claimed_at === job.claimed_at) Object.assign(row, fields);
    },
  };
  return { state, store };
}
function meta(reply) {
  const calls = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization });
    if (reply instanceof Error) throw reply;
    return new Response(JSON.stringify(reply.body), { status: reply.status ?? 200 });
  };
  return { calls, fetchImpl };
}
const worker = (store, fetchImpl, extra = {}) => createReminderWorker({ store, fetchImpl, loadAccessToken: async () => 'bot-token',
  publicUrl: 'https://dimi.example', now: () => NOW, log: () => {}, ...extra });

test('KST send times, option rules and the DM text', () => {
  assert.equal(reminderAt('day9', '2026-11-07', null).toISOString(), '2026-11-07T00:00:00.000Z');
  assert.equal(reminderAt('h1', '2026-11-07', '14:00').toISOString(), '2026-11-07T04:00:00.000Z');
  assert.equal(reminderAt('h1', '2026-11-07', '00:30').toISOString(), '2026-11-06T14:30:00.000Z', 'h1 can fall on the previous day');
  assert.equal(reminderAt('h1', '2026-11-07', null), null, 'all-day: no "1시간 전"');
  assert.equal(reminderAt('eve', '2026-11-01', null).toISOString(), '2026-10-31T11:00:00.000Z', 'month boundary');
  assert.equal(reminderAt('d3', '2026-01-02', null).toISOString(), '2025-12-30T00:00:00.000Z', 'year boundary');
  assert.deepEqual(normalizeReminders(['d3', 'day9', 'd3'], '10:00'), ['day9', 'd3']);
  assert.throws(() => normalizeReminders(['h1'], null), /h1/);
  assert.throws(() => normalizeReminders(['week'], null), /reminders/);
  assert.equal(spokenTime('14:00'), '오후 2시'); assert.equal(spokenTime('00:30'), '오전 12시 30분'); assert.equal(spokenTime('12:05'), '오후 12시 5분');
  assert.equal(reminderText({ kind: 'visit', date: '2026-11-07', time: '14:00', title: '서도호: 개인전', contentId: 'fc42-2',
    publicUrl: 'https://inthon.yeoziphab.com', now: NOW }),
  '디미가 일정 알려드려요!\n오늘 오후 2시, ‘서도호: 개인전’에 방문하기로 하셨어요.\n정리한 내용: https://inthon.yeoziphab.com/items/fc42-2');
  assert.match(reminderText({ kind: 'deadline', date: '2026-11-08', time: null, title: '공모전', now: NOW }), /^디미가 일정 알려드려요!\n내일, ‘공모전’ 마감이에요\.$/);
  assert.match(reminderText({ kind: 'cook', date: '2026-11-20', time: null, title: '파스타', now: NOW }), /11월 20일\(금\), ‘파스타’ 요리하기로/);
  assert.doesNotMatch(Object.values({ a: reminderText({ kind: 'prep', date: '2026-11-08', time: null, title: 'x', now: NOW }) }).join(), /완료/);
  assert.equal(reminderStatus({ status: 'skipped', reason: 'window_closed' }).long, '메시지를 보낼 수 있는 시간이 지나 DM 알림을 보내지 못했어요.');
  assert.equal(reminderStatus({ status: 'unknown' }).long, '전송 여부를 확인하고 있어요.');
});

test('a due job is re-checked and sent once; only a Meta message ID marks it sent', async () => {
  const { state, store } = world();
  const { calls, fetchImpl } = meta({ body: { recipient_id: '555', message_id: 'mid.1' } });
  assert.deepEqual(await worker(store, fetchImpl)(), { sent: 1 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `https://graph.facebook.com/v26.0/${IG_ID}/messages`); assert.equal(calls[0].auth, 'Bearer bot-token');
  assert.deepEqual(calls[0].body.recipient, { id: '555' });
  assert.equal(calls[0].body.message.text, '디미가 일정 알려드려요!\n오늘 오후 2시, ‘서도호: 개인전’에 방문하기로 하셨어요.\n정리한 내용: https://dimi.example/items/fc42');
  const job = state.jobs[0];
  assert.equal(job.status, 'sent'); assert.equal(job.meta_message_id, 'mid.1'); assert.ok(job.request_started_at); assert.ok(job.sent_at);
  assert.deepEqual(await worker(store, fetchImpl)(), {}, 'a second run finds nothing'); assert.equal(calls.length, 1);
});

test('changed, switched-off, unlinked, moved or unreachable schedules are cancelled without calling Meta', async () => {
  const cases = [
    ['changed', s => { s.events[EVENT].revision = 3; }],
    ['off', s => { s.events[EVENT].reminders = ['day9']; }],
    ['unlinked', s => { delete s.links[USER]; }],
    ['unlinked', s => { s.links[USER] = { igsid: '999' }; }],                // re-linked to another Instagram account
    ['content_unavailable', s => { s.results[42].igsid = '999'; }],           // the result now belongs to someone else
    ['content_unavailable', s => { delete s.results[42]; }],
  ];
  for (const [reason, change] of cases) {
    const { state, store } = world(); change(state);
    const { calls, fetchImpl } = meta({ body: { message_id: 'x' } });
    await worker(store, fetchImpl)();
    assert.deepEqual([state.jobs[0].status, state.jobs[0].reason], ['cancelled', reason]); assert.equal(calls.length, 0, reason);
  }
  const { state, store } = world(); delete state.events[EVENT];
  const { calls, fetchImpl } = meta({ body: { message_id: 'x' } });
  assert.deepEqual(await worker(store, fetchImpl)(), { gone: 1 }); assert.equal(calls.length, 0, 'deleted schedule: nothing is sent');
});

test('outside the 24-hour window nothing is sent: skipped / window_closed, also when Meta itself refuses for that reason', async () => {
  for (const inboundAt of [null, '2026-11-06T04:00:00Z', '2026-11-06T04:01:00Z']) {   // never, 24h ago, 23h59m ago (inside the 1-min margin)
    const { state, store } = world({ inboundAt });
    const { calls, fetchImpl } = meta({ body: { message_id: 'x' } });
    await worker(store, fetchImpl)();
    assert.deepEqual([state.jobs[0].status, state.jobs[0].reason], ['skipped', 'window_closed']); assert.equal(calls.length, 0);
  }
  const { state, store } = world();
  await worker(store, meta({ status: 400, body: { error: { code: 10, error_subcode: 2534022, message: 'outside window for user 555' } } }).fetchImpl)();
  assert.deepEqual([state.jobs[0].status, state.jobs[0].reason], ['skipped', 'window_closed']);
  assert.ok(!JSON.stringify(state.jobs[0]).includes('555 ') && !JSON.stringify(state.jobs[0]).includes('outside'), "Meta's text is not stored");
});

test('lost answers stay unknown and are never re-sent; refusals fail; storage trouble before the request is retried', async () => {
  for (const [reply, expected] of [
    [Object.assign(new Error('timeout'), { name: 'TimeoutError' }), ['unknown', 'timeout']],
    [new TypeError('fetch failed'), ['unknown', 'no_response']],
    [{ status: 502, body: { error: { code: 2 } } }, ['unknown', 'meta_502']],
    [{ status: 200, body: { recipient_id: '555' } }, ['unknown', 'no_response']],            // accepted without a message ID: not confirmed
    [{ status: 400, body: { error: { code: 190, message: 'token' } } }, ['failed', 'meta_190']],
  ]) {
    const { state, store } = world();
    const { calls, fetchImpl } = meta(reply);
    await worker(store, fetchImpl)();
    assert.deepEqual([state.jobs[0].status, state.jobs[0].reason], expected);
    await worker(store, fetchImpl)(); assert.equal(calls.length, 1, 'no automatic second send');
  }
  // Sent, but recording it failed: the job stays "sending" with request_started_at, so the SQL lease expiry makes it unknown.
  const sentButUnrecorded = world(); sentButUnrecorded.state.failFinish = true;
  const first = meta({ body: { message_id: 'mid.2' } });
  assert.deepEqual(await worker(sentButUnrecorded.store, first.fetchImpl)(), { stuck: 1 });
  assert.equal(sentButUnrecorded.state.jobs[0].status, 'sending'); assert.ok(sentButUnrecorded.state.jobs[0].request_started_at);

  // The token cannot be loaded: nothing started, the job goes back to the queue.
  const retry = world();
  const noToken = createReminderWorker({ store: retry.store, fetchImpl: meta({ body: {} }).fetchImpl, loadAccessToken: async () => { throw new Error('blob'); },
    publicUrl: 'https://dimi.example', now: () => NOW, log: () => {} });
  assert.deepEqual(await noToken(), { retry: 1 });
  assert.equal(retry.state.jobs[0].status, 'scheduled'); assert.equal(retry.state.jobs[0].request_started_at, undefined);
  retry.state.jobs[0].attempts = 3;
  await noToken(); assert.deepEqual([retry.state.jobs[0].status, retry.state.jobs[0].reason], ['failed', 'retry_limit']);

  assert.deepEqual(classifySendError({ metaResponse: { httpStatus: 400, code: 551 } }), { status: 'skipped', reason: 'recipient_unavailable' });
});

test('a run that lost its lease, or two overlapping runs, never send the same job twice', async () => {
  const { state, store } = world();
  const { calls, fetchImpl } = meta({ body: { message_id: 'mid.3' } });
  const realBegin = store.begin;
  // Another run took over between this run's checks and its send.
  store.begin = async (job, at) => { state.jobs[0].claimed_at = 'someone-else'; return realBegin(job, at); };
  assert.deepEqual(await worker(store, fetchImpl)(), { lease_lost: 1 }); assert.equal(calls.length, 0);

  const two = world();
  const both = meta({ body: { message_id: 'mid.4' } });
  await Promise.all([worker(two.store, both.fetchImpl)(), worker(two.store, both.fetchImpl)()]);
  assert.equal(both.calls.length, 1); assert.equal(two.state.jobs[0].status, 'sent');
});

test('jobs reached more than 5 minutes late are skipped as stale', async () => {
  const { state, store } = world();
  state.jobs[0].scheduled_at = '2026-11-07T03:50:00Z';
  const { calls, fetchImpl } = meta({ body: { message_id: 'x' } });
  await worker(store, fetchImpl)();
  assert.deepEqual([state.jobs[0].status, state.jobs[0].reason], ['skipped', 'stale']); assert.equal(calls.length, 0);
});

test('the worker endpoint needs the exact cron secret and the feature switch', async () => {
  const run = async (options, headers = {}, method = 'GET') => {
    let ran = false;
    const handler = createRemindersHandler({ ...options, worker: () => async () => { ran = true; return { sent: 0 }; } });
    const res = { statusCode: 200, headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(body) { this.body = body; } };
    await handler({ method, headers }, res);
    return { status: res.statusCode, ran };
  };
  assert.deepEqual(await run({ secret: undefined, enabled: true }, { authorization: 'Bearer ' }), { status: 503, ran: false });
  assert.deepEqual(await run({ secret: 's3cret', enabled: true }, { authorization: 'Bearer wrong!' }), { status: 401, ran: false });
  assert.deepEqual(await run({ secret: 's3cret', enabled: true }), { status: 401, ran: false });
  assert.deepEqual(await run({ secret: 's3cret', enabled: true }, { authorization: 'Bearer s3cret' }, 'POST'), { status: 401, ran: false });
  assert.deepEqual(await run({ secret: 's3cret', enabled: false }, { authorization: 'Bearer s3cret' }), { status: 503, ran: false });
  assert.deepEqual(await run({ secret: 's3cret', enabled: true }, { authorization: 'Bearer s3cret' }), { status: 200, ran: true });
  const env = { DM_REMINDERS: 'on', REMINDER_WORKER_SECRET: 'x', SUPABASE_URL: 'x', SUPABASE_SECRET_KEY: 'x', META_APP_SECRET: 'x', BLOB_READ_WRITE_TOKEN: 'x', PUBLIC_URL: 'x' };
  assert.equal(remindersConfigured(env), true);
  assert.equal(remindersConfigured({ ...env, DM_REMINDERS: 'true' }), false, 'only an explicit "on"');
  assert.equal(remindersConfigured({ ...env, REMINDER_WORKER_SECRET: '' }), false);
  assert.equal(remindersConfigured({ ...env, REMINDER_WORKER_SECRET: undefined, CRON_SECRET: 'x' }), false, 'the cleanup secret is not reused');
});

test('only signed messages from a person to the bot record the reply window, never later than receipt', async () => {
  const secret = 'webhook-secret'; const noted = []; let clock = Date.parse('2026-11-07T04:00:00Z');
  const servers = createServers({ config: { accessToken: 'token', userId: IG_ID, webhookSecret: secret }, persist: () => {}, record: async () => {},
    now: () => clock, noteInbound: async (igsid, at) => { noted.push([igsid, at]); },
    apiFetch: async (_url, init) => Response.json(JSON.parse(init.body).sender_action ? {} : { message_id: 'm' }) });
  const deliver = async (messaging, signed = true) => {
    const raw = JSON.stringify({ object: 'instagram', entry: [{ id: IG_ID, messaging }] });
    const req = Object.assign(Readable.from([Buffer.from(raw)]), { method: 'POST', url: '/webhooks/instagram',
      headers: { 'x-hub-signature-256': 'sha256=' + createHmac('sha256', signed ? secret : 'other').update(raw).digest('hex') } });
    const res = { headersSent: false, writeHead(status) { this.status = status; this.headersSent = true; }, end() {} };
    await servers.publicServer.listeners('request')[0](req, res);
  };
  const message = (mid, timestamp, extra = {}) => ({ sender: { id: '555' }, recipient: { id: IG_ID }, timestamp, message: { mid, text: '안녕', ...extra } });
  await deliver([message('m1', clock - 60000)]);
  assert.deepEqual(noted, [['555', '2026-11-07T03:59:00.000Z']]);
  await deliver([message('m2', clock + 120000)]);
  assert.equal(noted[1][1], '2026-11-07T04:00:00.000Z', 'a future timestamp counts as the receipt time');
  await deliver([message('m3', clock, { is_echo: true }), { ...message('m4', clock), sender: { id: IG_ID }, recipient: { id: '555' } },
    message('m5', clock - 25 * 3600000), { sender: { id: '555' }, recipient: { id: IG_ID }, timestamp: clock, read: { mid: 'm1' } }]);
  await deliver([message('m6', clock)], false);
  assert.equal(noted.length, 2, 'echoes, bot messages, day-old redeliveries, read receipts and unsigned events do not count');
});
