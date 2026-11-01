import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarDashboard, calendarContent, validCalendarDate, serverEvent } from './public/js/dashboard-calendar.js';
import { MemberApiError } from './public/js/member-sync.js';
import { reminderAt, reminderText } from './public/js/reminder-rules.js';

const now = () => new Date(2026, 10, 1, 10);
const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
const recipe = { id:'fc1',type:'recipe',status:'done',title:'오늘의 요리',key:'재료 2개',ingredients:[{name:'면',qty:'1인분'}] };
const exhibit = { id:'fc9-2',type:'exhibit',status:'done',title:'두 번째 전시',exhibitEvent:{start:'2026-11-04',end:'2026-11-12'} };

/** In-memory stand-in for /api/calendar: per-member rows, revisions and idempotency keys. */
function fakeServer({ reminders = false, eligibility = null } = {}) {
  const rows = new Map(); const keys = new Map(); const calls = []; let n = 0; const fail = {};
  // With reminders on, the server answers with this revision's jobs (the database trigger's work).
  const view = ({ owner, ...e }) => !reminders ? e : { ...e, reminders: e.reminders ?? [],
    reminder_jobs: e.jobStatus ? e.jobStatus : (e.reminders ?? []).flatMap(key => { const at = reminderAt(key, e.date, e.time ?? null);
      return at ? [{ key, scheduled_at: at.toISOString(), status: 'scheduled', reason: null, sent_at: null }] : []; }) };
  const uuid = () => `00000000-0000-4000-8000-${String(++n).padStart(12, '0')}`;
  const api = member => ({
    async listEvents(from, to) { calls.push(['list', member(), from, to]); if (fail.list) throw fail.list;
      return { events: [...rows.values()].filter(r => r.owner === member() && r.date >= from && r.date <= to).map(view),
        reminders_available: reminders, dm_eligibility: eligibility }; },
    async createEvent(body, key) { calls.push(['create', member(), body, key]); if (fail.create) throw fail.create;
      const seen = keys.get(member() + key); if (seen) return seen;
      const { import: _, ...fields } = body;
      const row = { id: uuid(), ...fields, revision: 1, owner: member() }; rows.set(row.id, row);
      const e = view(row); keys.set(member() + key, e); return e; },
    async updateEvent(id, body) { calls.push(['update', member(), id, body]); if (fail.update) throw fail.update;
      const row = rows.get(id); if (!row || row.owner !== member()) throw new MemberApiError(404);
      if (row.revision !== body.revision) throw new MemberApiError(409, '다른 화면에서 이 일정이 바뀌었어요.');
      const { revision, ...fields } = body; Object.assign(row, fields, { revision: revision + 1 }); return view(row); },
    async deleteEvent(id) { calls.push(['delete', member(), id]); if (fail.delete) throw fail.delete; rows.delete(id); return null; },
  });
  return { rows, calls, fail, api };
}
function fixture(server = fakeServer(), storage = new Map()) {
  const messages = [];
  const app = { state: { mode: 'live', user: { id: 'member-a' } }, allItems: () => [recipe, exhibit], refs: [],
    setState: patch => Object.assign(app.state, patch), toast: msg => messages.push(msg), openDetail: id => messages.push(id),
    ensureReferences: ids => app.refs.push(...ids) };
  const store = { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value), removeItem: key => storage.delete(key) };
  const make = () => createCalendarDashboard(app, { api: server.api(() => app.state.user?.id), storage: store, now });
  return { app, server, storage, messages, make, calendar: make() };
}
function draft(calendar, date = '2026-11-07') {
  calendar.values().openAddSel(); calendar.values().contentOpts[0].pick();
  calendar.model.setDraft({ date, mini: date.slice(0, 7) + '-01', time: '18:30' });
}

test('schedules are saved on the server only after it confirms, shared across devices and kept per member', async () => {
  const { app, server, messages, make, calendar } = fixture();
  assert.match(calendar.values().storageNote, /불러오고/);
  assert.equal(calendar.values(true).showStorageStatus, true);
  await settle();
  assert.equal(calendar.values().filters[0].count, 0);
  assert.deepEqual(server.calls[0], ['list', 'member-a', '2025-11-01', '2028-10-31'], 'one year back, two years ahead');
  draft(calendar); assert.equal(calendar.values().dmUnavailable, true);
  assert.ok(calendar.values().remOpts.every(option => option.disabled));
  calendar.values().save();
  assert.equal(calendar.values().modalOpen, true, 'the draft stays open until the server answers');
  assert.equal(calendar.values().saveLabel, '저장 중…'); assert.equal(calendar.values().saveDisabled, true);
  await settle();
  assert.equal(calendar.values().modalOpen, false); assert.equal(calendar.values().filters[0].count, 1);
  assert.ok(messages.some(msg => msg.includes('등록했어요')));
  const [, , body, key] = server.calls.find(c => c[0] === 'create');
  assert.deepEqual(body, { content_id: 'fc1', kind: 'cook', date: '2026-11-07', time: '18:30', timezone: 'Asia/Seoul' });
  assert.match(key, /^ev:/);

  const otherDevice = make(); otherDevice.values(); await settle();
  assert.equal(otherDevice.values().filters[0].count, 1, 'a second dashboard sees the same server schedule');
  const id = otherDevice.model.state.events[0].id;
  otherDevice.model.openModal({ id }); otherDevice.model.setDraft({ time: '19:20' }); otherDevice.values().save(); await settle();
  assert.deepEqual(server.calls.find(c => c[0] === 'update').slice(2), [id, { content_id: 'fc1', kind: 'cook', date: '2026-11-07', time: '19:20', timezone: 'Asia/Seoul', revision: 1 }]);
  otherDevice.model.setState({ sel: '2026-11-07' });
  assert.equal(otherDevice.values().selEvents[0].timeLabel, '19:20');

  // The first screen still holds revision 1: its edit is refused as a conflict and the draft stays.
  calendar.model.openModal({ id }); calendar.model.setDraft({ time: '20:00' }); calendar.values().save(); await settle();
  assert.equal(calendar.values().modalOpen, true); assert.match(messages.at(-1), /다른 화면/);
  calendar.close();

  app.state.user = { id: 'member-b' }; calendar.values(); await settle();
  assert.equal(calendar.values().filters[0].count, 0, 'another member never sees these schedules');
  app.state.user = { id: 'member-a' }; calendar.values(); await settle();
  calendar.model.setState({ sel: '2026-11-07' });
  const before = messages.length;
  calendar.values().selEvents[0].remove();
  assert.equal(calendar.values().filters[0].count, 1, 'removed only after the server confirms');
  assert.ok(!messages.slice(before).includes('일정을 삭제했어요.'));
  await settle();
  assert.equal(calendar.values().filters[0].count, 0); assert.equal(messages.at(-1), '일정을 삭제했어요.');
  assert.equal(server.rows.size, 0);
});

test('home loads the member calendar without opening it and mirrors confirmed create/edit/delete', async () => {
  const { app, calendar, server } = fixture();
  app.go = view => { app.state.view = view; };
  assert.match(calendar.homeValues().scheduleNote, /불러오고/);
  await settle();
  assert.equal(calendar.homeValues().hasSchedule, false, 'content with known dates is not a registered event');
  draft(calendar, '2026-11-07'); calendar.values().save();
  assert.deepEqual(calendar.homeValues().schedule, [], 'unconfirmed saves stay out of home');
  await settle();
  let v = calendar.homeValues();
  assert.deepEqual(v.schedule.map(e => [e.title, e.day, e.what, e.badge]), [['오늘의 요리', '07', '요리할 날 · 18:30 KST', 'D-6']]);
  const id = v.schedule[0].id;
  calendar.model.openModal({ id }); calendar.model.setDraft({ date: '2026-11-08', time: '19:20' }); calendar.values().save(); await settle();
  v = calendar.homeValues(); assert.equal(v.schedule[0].day, '08'); assert.match(v.schedule[0].what, /19:20 KST/);
  v.schedule[0].open();
  assert.equal(app.state.view, 'calendar'); assert.equal(calendar.model.state.sel, '2026-11-08');
  assert.equal(calendar.model.state.cursor, '2026-11-01');
  calendar.values().selEvents[0].remove(); await settle();
  assert.equal(calendar.homeValues().hasSchedule, false);
  assert.equal(server.calls.filter(c => c[0] === 'list').length, 1, 'rendering home reuses the same loaded calendar');
});

test('home uses chronological KST events, excludes elapsed or missing content and keeps account/load states separate', async () => {
  const server = fakeServer(); let n = 0;
  const add = (date, time, content_id = 'fc1') => {
    const id = `00000000-0000-4000-9000-${String(++n).padStart(12, '0')}`;
    server.rows.set(id, { id, content_id, kind: 'cook', date, time, revision: 1, owner: 'member-a' });
  };
  add('2026-11-01', '09:59'); add('2026-10-31', null); add('2026-11-01', '11:00'); add('2026-11-01', null);
  add('2026-11-01', '10:00', 'fc404');
  for (const day of ['08', '03', '05', '02', '06', '04', '07']) add('2026-11-' + day, '18:00');
  const { app, calendar } = fixture(server);
  calendar.homeValues(); await settle();
  const v = calendar.homeValues();
  assert.deepEqual(v.schedule.map(e => [e.day, e.what, e.badge]), [
    ['01', '요리할 날 · 종일', 'D-DAY'], ['01', '요리할 날 · 11:00 KST', 'D-DAY'],
    ['02', '요리할 날 · 18:00 KST', 'D-1'], ['03', '요리할 날 · 18:00 KST', 'D-2'],
    ['04', '요리할 날 · 18:00 KST', 'D-3'], ['05', '요리할 날 · 18:00 KST', 'D-4']]);
  assert.equal(calendar.values().upCount, 9, 'calendar and home use the same upcoming event selection');
  app.state.user = { id: 'member-b' };
  assert.deepEqual(calendar.homeValues().schedule, []); await settle();
  assert.equal(calendar.homeValues().hasSchedule, false);
  const broken = fakeServer(); broken.fail.list = new MemberApiError(503);
  const other = fixture(broken).calendar;
  other.homeValues(); await settle();
  assert.equal(other.homeValues().hasSchedule, true); assert.match(other.homeValues().scheduleNote, /불러오지 못/);
  assert.deepEqual(other.homeValues().schedule, []);
});

test('a failed save keeps the draft, retries with the same key and never reports success', async () => {
  const { server, messages, calendar } = fixture();
  calendar.values(); await settle();
  draft(calendar);
  server.fail.create = new MemberApiError(0);
  calendar.values().save(); await settle();
  assert.equal(calendar.values().modalOpen, true); assert.equal(calendar.model.state.modal.time, '18:30');
  assert.match(messages.at(-1), /저장하지 못했어요/); assert.ok(!messages.some(msg => msg.includes('등록했어요')));
  delete server.fail.create;
  calendar.values().save(); await settle();
  const keys = server.calls.filter(c => c[0] === 'create').map(c => c[3]);
  assert.equal(keys.length, 2); assert.equal(keys[0], keys[1], 'the retry is idempotent');
  assert.equal(calendar.values().filters[0].count, 1);

  calendar.model.setState({ sel: '2026-11-07' });
  server.fail.delete = new MemberApiError(503);
  calendar.values().selEvents[0].remove(); await settle();
  assert.equal(calendar.values().filters[0].count, 1); assert.match(messages.at(-1), /삭제하지 못했어요/);
});

test('a failed load says so instead of showing an empty calendar as saved, and a late answer for another member is dropped', async () => {
  const server = fakeServer(); server.fail.list = new MemberApiError(503);
  const { app, calendar } = fixture(server);
  calendar.values(); await settle();
  assert.match(calendar.values().storageNote, /불러오지 못했어요/); assert.equal(calendar.values().saveDisabled, true);
  assert.equal(calendar.values(true).showStorageStatus, true);

  const slow = fakeServer(); const pending = [];
  slow.rows.set('x', { id: '00000000-0000-4000-8000-000000000099', content_id: 'fc1', kind: 'cook', date: '2026-11-07', time: null, revision: 1, owner: 'member-a' });
  const api = slow.api(() => 'member-a'); const list = api.listEvents;
  api.listEvents = (...args) => new Promise(resolve => { pending.push(() => resolve(list(...args))); });
  const late = createCalendarDashboard(app, { api, storage: null, now });
  app.state.user = { id: 'member-a' }; late.values();
  app.state.user = { id: 'member-b' }; late.values();
  pending[0](); await settle();   // only the request made for member A answers
  assert.equal(late.model.state.events.length, 0, "member A's answer never lands on member B's calendar");
});

test('browser-only schedules move to the account once, keep failures and never cross members', async () => {
  const storage = new Map([
    ['dimi-calendar:v1:member-a', JSON.stringify([
      { id: 1, item: 'fc1', kind: 'cook', date: '2026-10-20', time: null, dm: false, rem: [] },
      { id: 2, item: 'fc9-2', kind: 'visit', date: '2026-11-05', time: '14:00', dm: false, rem: [] },
      { id: 3, item: 'fc77', kind: 'visit', date: '2026-11-05', time: null, dm: false, rem: [] }])],
    ['dimi-calendar:v1:member-b', JSON.stringify([{ id: 1, item: 'fc1', kind: 'cook', date: '2026-11-03', time: null, dm: false, rem: [] }])],
    ['dimi-browser-id', 'browser-1234'],
  ]);
  const server = fakeServer();
  const create = server.api; server.api = member => { const api = create(member); const add = api.createEvent;
    api.createEvent = async (body, key) => { if (body.content_id === 'fc77') throw new MemberApiError(404); return add(body, key); }; return api; };
  const { app, messages, calendar } = fixture(server, storage);
  calendar.values(); await settle();
  const creates = server.calls.filter(c => c[0] === 'create');
  assert.deepEqual(creates.map(c => [c[1], c[2].content_id, c[2].import, c[3]]),
    [['member-a', 'fc1', true, 'import:browser-1234:1'], ['member-a', 'fc9-2', true, 'import:browser-1234:2']]);
  assert.equal(creates[0][2].date, '2026-10-20', 'past records are imported with their own date');
  assert.deepEqual(JSON.parse(storage.get('dimi-calendar:v1:member-a')).map(e => e.id), [3], 'an unreachable item stays in the browser');
  assert.ok(storage.has('dimi-calendar:v1:member-b'), "member B's records are not touched by member A");
  assert.match(messages.at(-1), /일정 2개를 계정에 저장/);
  assert.deepEqual(app.refs.sort(), ['fc1', 'fc9-2'], 'imported references are fetched if older than the list');
  // A second login retries only what is left and does not duplicate.
  const again = createCalendarDashboard(app, { api: server.api(() => 'member-a'), storage: { getItem: k => storage.get(k) ?? null, setItem: (k, v) => storage.set(k, v), removeItem: k => storage.delete(k) }, now });
  again.values(); await settle();
  assert.equal(server.rows.size, 2);
});

test('calendar rejects invalid dates/times and out-of-period visits before calling the server', async () => {
  const { server, calendar, messages } = fixture();
  calendar.values(); await settle();
  assert.equal(validCalendarDate('2026-02-30'), false); assert.equal(validCalendarDate('2028-02-29'), true);
  draft(calendar, '2026-02-30'); calendar.values().save();
  calendar.model.setDraft({ date: '2026-11-07', time: '25:10' }); calendar.values().save();
  calendar.values().contentOpts[1].pick(); calendar.model.setDraft({ date: '2026-11-15' });
  assert.equal(calendar.values().saveDisabled, true); calendar.values().save();
  await settle();
  assert.equal(server.calls.filter(c => c[0] === 'create').length, 0);
  assert.ok(messages.every(msg => !msg.includes('등록했어요')));
});

test('unavailable content is omitted, fixed contest facts stay locked and no dates are invented', async () => {
  const { app, calendar } = fixture();
  calendar.values(); await settle();
  assert.equal(calendarContent(recipe).from, undefined);
  app.allItems = () => [{ ...recipe, type: 'contest', contestEvents: [{ type: 'deadline', date: '2026-11-09', time: '18:00' }] }];
  calendar.values().openAddSel(); calendar.values().contentOpts[0].pick();
  assert.equal(calendar.values().dateLocked, true); calendar.model.setDraft({ date: '2026-11-10' });
  calendar.values().save(); await settle(); assert.equal(calendar.values().filters[0].count, 0);
  calendar.model.setDraft({ date: '2026-11-09' }); calendar.values().save(); await settle();
  assert.equal(calendar.values().filters[0].count, 1);
  app.allItems = () => []; assert.equal(calendar.values().filters[0].count, 0);
  assert.equal(calendar.values().upcoming.length, 0);
});

test('restaurant and space visits save, reload, filter and open the exact content without invented restrictions', async () => {
  const { app, make, calendar, messages } = fixture();
  app.allItems = () => [
    { ...recipe, type: 'restaurant', id: 'fc12-2', title: '두 번째 맛집', address: '서울 성동구', priceRange: '1만 원대' },
    { ...recipe, type: 'space', id: 'fc15', title: '서점', address: '서울 마포구' },
    { ...recipe, type: 'news', id: 'fc16' },
  ];
  let v = calendar.values(); await settle(); v = calendar.values();
  assert.deepEqual(v.filters.map(f => f.label), ['전체', '전시·팝업', '취향공간', '맛집', '공모전·대외활동', '레시피']);
  v.openAddSel(); calendar.values().contentOpts[0].pick();
  assert.equal(calendar.model.state.modal.kind, 'visit');
  calendar.model.setDraft({ date: '2026-11-07', time: '12:00' }); calendar.values().save(); await settle();
  calendar.values().openAddSel(); calendar.values().contentOpts[1].pick();
  calendar.model.setDraft({ date: '2026-11-07', allDay: true }); calendar.values().save(); await settle();
  const reloaded = make(); reloaded.values(); await settle();
  v = reloaded.values();
  assert.equal(v.contentOpts.length, 0);
  assert.equal(reloaded.model.consts().CONTENT.fc16, undefined);
  assert.equal(reloaded.model.consts().CONTENT.fc15.from, undefined);
  assert.equal(v.filters[0].count, 2); assert.equal(v.filters[3].count, 1); assert.equal(v.filters[2].count, 1);
  reloaded.model.setState({ sel: '2026-11-07' });
  reloaded.values().filters[3].toggle();
  assert.deepEqual(reloaded.values().selEvents.map(e => e.title), ['두 번째 맛집']);
  reloaded.values().selEvents[0].view();
  assert.equal(reloaded.values().cvType, '맛집');
  assert.deepEqual(reloaded.values().cvFacts.map(f => f.k).filter(k => ['가격대', '운영', '휴무', '예약'].includes(k)), []);
  reloaded.values().openFullContent();
  assert.equal(messages.at(-1), 'fc12-2');
  reloaded.values().filters[2].toggle();
  assert.deepEqual(reloaded.values().selEvents.map(e => e.title), ['서점']);
  assert.equal(reloaded.values().selEvents[0].timeLabel, '종일');
  reloaded.values().filters[0].toggle();
  assert.equal(reloaded.values().selEvents.length, 2);
});

test('server events are checked before they render', () => {
  const ok = { id: '00000000-0000-4000-8000-000000000001', content_id: 'fc42-2', kind: 'visit', date: '2026-11-07', time: null, timezone: 'Asia/Seoul', revision: 3 };
  assert.deepEqual(serverEvent(ok), { id: ok.id, item: 'fc42-2', kind: 'visit', date: '2026-11-07', time: null, revision: 3, dm: false, rem: [], jobs: [] });
  const withJobs = serverEvent({ ...ok, time: '14:00', reminders: ['eve', 'h1', 'bogus'], reminder_jobs: [
    { key: 'h1', scheduled_at: '2026-11-07T04:00:00Z', status: 'sent', reason: null }, { key: 'eve', scheduled_at: 'soon', status: 'scheduled' },
    { key: 'day9', scheduled_at: '2026-11-07T00:00:00Z', status: 'made-up' }] });
  assert.deepEqual([withJobs.dm, withJobs.rem, withJobs.jobs.map(j => j.key)], [true, ['h1', 'eve'], ['h1']], 'unknown keys, states and times are dropped');
  for (const bad of [{ ...ok, id: 1 }, { ...ok, content_id: 'x' }, { ...ok, kind: 'party' }, { ...ok, date: '2026-02-30' }, { ...ok, time: '24:00' }]) {
    assert.throws(() => serverEvent(bad));
  }
});

test('the mobile calendar shares stored schedules and actions with desktop and renders date dots and sheets',async()=>{
  const {calendar,messages}=fixture();
  calendar.values(); await settle();
  draft(calendar); calendar.values().save(); await settle();
  const mobile=calendar.values(true);
  const day=mobile.cells.find(c=>c.aria.startsWith('11월 7일'));
  assert.match(day.cls,/^mday/); assert.deepEqual(day.dots,[{cls:'dot t-recipe'}]);
  assert.equal(mobile.selCount,'일정 1개');
  assert.equal(mobile.selEvents[0].orb,'orb o-recipe');
  mobile.selEvents[0].view();
  assert.match(calendar.values(true).cvEvents[0].cls,/^cvev/);
  calendar.values(true).openFullContent(); assert.equal(messages.at(-1),'fc1');
  calendar.values(true).viewWeek();
  assert.equal(calendar.values(true).weekCols.filter(c=>c.pressed==='true').length,1);
  assert.match(calendar.values().cells[0].cls,/^mc/);
  calendar.values(true).selEvents[0].remove(); await settle(); assert.equal(calendar.values().filters[0].count,0);
});

test('with reminders on, PC and mobile use the real options, server send states, upcoming jobs and the exact DM preview', async () => {
  const ends = new Date(Date.now() + 3 * 3600000).toISOString();
  const server = fakeServer({ reminders: true, eligibility: { eligible_now: true, reason: null, window_ends_at: ends } });
  const { calendar, messages } = fixture(server);
  calendar.values(); await settle();
  let v = calendar.values();
  assert.equal(v.dmUnavailable, false); assert.equal(v.upcomingTitle, '다가오는 DM 리마인드');
  assert.match(v.reminderNote, /24시간 안에만/); assert.match(v.reminderNote, /까지 보낼 수 있어요/);
  draft(calendar);
  assert.equal(calendar.model.state.modal.dm, false, 'opt-in: a new schedule starts without DM');
  assert.equal(calendar.values().showPreview, false);
  calendar.values().toggleDraftDm();
  v = calendar.values();
  assert.ok(v.remOpts.some(option => !option.disabled && option.pressed === 'true'), '"당일 오전 9시" is ready');
  assert.equal(v.showPreview, true);
  assert.equal(v.previewText, reminderText({ kind: 'cook', date: '2026-11-07', time: '18:30', title: '오늘의 요리', contentId: 'fc1',
    now: reminderAt('day9', '2026-11-07', '18:30') }), 'the preview is the text the worker sends');
  assert.match(v.previewAt, /11\/7 \(토\) 09:00/);
  v.save(); await settle();
  const [, , body] = server.calls.find(c => c[0] === 'create');
  assert.deepEqual(body.reminders, ['day9']);
  assert.ok(messages.some(msg => /DM 알림 1개 예약/.test(msg)));

  calendar.model.setState({ sel: '2026-11-07' });
  for (const [values, mobile] of [[calendar.values(), false], [calendar.values(true), true]]) {
    const card = values.selEvents[0];
    assert.equal(card.rems.length, 1); assert.equal(card.rems[0].at, '11/7 (토) 09:00');
    assert.equal(card.rems[0].st, '예약됨');
    if (mobile) assert.match(card.rems[0].label, /당일 오전 9시 · 예약됨/);
    assert.equal(values.upCount, 1); assert.equal(values.upcoming[0].at, '11/7 (토) 09:00');
  }

  // The worker skipped it: the next load shows the server's wording, not a time-based "보냄".
  const [row] = server.rows.values();
  row.jobStatus = [{ key: 'day9', scheduled_at: '2026-11-07T00:00:00Z', status: 'skipped', reason: 'window_closed', sent_at: null }];
  const reloaded = fixture(server).calendar; reloaded.values(); await settle(); reloaded.model.setState({ sel: '2026-11-07' });
  assert.match(reloaded.values().selEvents[0].rems[0].label, /메시지를 보낼 수 있는 시간이 지나 DM 알림을 보내지 못했어요/);
  assert.equal(reloaded.values().selEvents[0].rems[0].st, '보낼 수 없음'); assert.equal(reloaded.values().upCount, 0);
  row.jobStatus = [{ key: 'day9', scheduled_at: '2026-11-07T00:00:00Z', status: 'unknown', reason: 'timeout', sent_at: null }];
  const again = fixture(server).calendar; again.values(); await settle(); again.model.setState({ sel: '2026-11-07' });
  assert.match(again.values(true).selEvents[0].rems[0].label, /전송 여부를 확인하고 있어요/);
  delete row.jobStatus;

  // The card switch turns reminders off with one PATCH, and the design's instant toast waits for the server.
  messages.length = 0;
  calendar.values().selEvents[0].toggleDm();
  assert.ok(!messages.includes('DM 리마인드를 껐어요'), 'no success message before the server answers');
  await settle();
  const update = server.calls.filter(c => c[0] === 'update').at(-1);
  assert.deepEqual(update[3].reminders, []); assert.equal(update[3].revision, 1);
  assert.deepEqual(messages, ['DM 리마인드를 껐어요']);
  assert.equal(calendar.values().selEvents[0].rems.length, 0); assert.equal(calendar.values().upCount, 0);
});

test('reminders stay off when the server does not offer them, and the window note covers unlinked members', async () => {
  const { calendar, server, messages } = fixture(fakeServer({ reminders: false }));
  calendar.values(); await settle();
  draft(calendar); calendar.model.setDraft({ dm: true, rem: ['day9'] }); calendar.values().save(); await settle();
  const [, , body] = server.calls.find(c => c[0] === 'create');
  assert.equal('reminders' in body, false, 'nothing is sent while unavailable');
  calendar.model.setState({ sel: '2026-11-07' });
  messages.length = 0; calendar.values().selEvents[0].toggleDm(); await settle();
  assert.deepEqual(messages, ['DM 리마인드는 아직 준비 중이에요.']);
  assert.equal(server.calls.filter(c => c[0] === 'update').length, 0);

  const unlinked = fixture(fakeServer({ reminders: true, eligibility: { eligible_now: false, reason: 'not_linked', window_ends_at: null } }));
  unlinked.calendar.values(); await settle();
  assert.match(unlinked.calendar.values().reminderNote, /Instagram 계정을 연결해야/);
});
