import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { resolveDate, normalizeContest, validateContest, contestTimeline, calendarLink, kstDate } from './public/js/contest-data.js';
import { createContestProcessor, contestMessages } from './contest.mjs';
import { factcheckToItem, contestLiveValues } from './public/js/dashboard-live.js';
import { createSupabaseState } from './supabase-state.mjs';

const REF = '2026-10-31';
const SOURCE = '공식 공고 https://example.org/notice 신청 https://forms.example.org/apply';
// What the model returns for a typical poster: dates without a year, a deadline with a time, one invented link.
const rawContest = (over = {}) => ({
  kind: 'contest', title: '대학생 생활 아이디어 공모전', summary: '생활 속 불편을 해결하는 아이디어를 공모해요.',
  host: '가상 재단', organizer: '가상 운영사무국', sponsors: [],
  schedule: [
    { label: '접수 시작', type: 'start', year: null, month: 10, day: 20, time: '10:00', raw: '10.20(화) 10:00', evidence: '이미지 1' },
    { label: '접수 마감', type: 'deadline', year: null, month: 11, day: 14, time: '18:00', raw: '11.14(토) 18시', evidence: '이미지 1' },
    { label: '본선 발표', type: 'announce', year: null, month: 1, day: 5, time: null, raw: '1.5', evidence: '본문' },
  ],
  eligibility: [{ text: '국내 대학 재학생·휴학생', evidence: '이미지 2' }, { text: ' ', evidence: null }],
  submissions: [{ text: '아이디어 기획서 (PDF)', evidence: '이미지 2' }], process: [{ text: '공식 홈페이지에서 신청', evidence: '본문' }],
  benefits: [{ text: '대상 1팀 상금 300만 원', evidence: '이미지 3' }], fee: '무료', contact: null,
  links: [{ label: 'notice', url: 'https://example.org/notice' }, { label: 'apply', url: 'https://forms.example.org/apply' },
    { label: 'other', url: 'https://made-up.example/never-in-post' }],
  checks: [], ...over,
});

test('years are inferred from the day the DM was received, keeping the recruitment order', () => {
  assert.deepEqual(resolveDate({ year: null, month: 11, day: 14 }, REF), { date: '2026-11-14', yearInferred: true });
  assert.deepEqual(resolveDate({ year: null, month: 1, day: 5 }, REF), { date: '2027-01-05', yearInferred: true }, 'January after an October post is next year');
  assert.deepEqual(resolveDate({ year: null, month: 9, day: 20 }, REF), { date: '2026-09-20', yearInferred: true }, 'up to 2 months back stays this year');
  assert.deepEqual(resolveDate({ year: 2025, month: 12, day: 1 }, REF), { date: '2025-12-01', yearInferred: false }, 'an explicit year wins');
  assert.equal(resolveDate({ year: null, month: 2, day: 30 }, REF), null);
  // Start in December, deadline "1.10" → the deadline belongs to next year even though 1.10 alone would too.
  const c = normalizeContest(rawContest({ schedule: [
    { label: '접수 시작', type: 'start', year: 2026, month: 12, day: 20, time: null, raw: '2026.12.20' },
    { label: '접수 마감', type: 'deadline', year: null, month: 12, day: 10, time: null, raw: '12.10' },
  ] }), { reference: REF, sourceText: SOURCE });
  assert.equal(c.schedule.find(s => s.type === 'deadline').date, '2027-12-10', 'a deadline before the start moves a year on');
});

test('normalising keeps only links that appear in the received text and records what is missing', () => {
  const c = normalizeContest(rawContest(), { reference: REF, sourceText: SOURCE });
  assert.equal(c.noticeUrl, 'https://example.org/notice'); assert.equal(c.applyUrl, 'https://forms.example.org/apply');
  assert.ok(!JSON.stringify(c).includes('made-up.example'), 'invented links are dropped');
  assert.deepEqual(c.eligibility.map(x => x.text), ['국내 대학 재학생·휴학생'], 'empty entries are skipped');
  assert.deepEqual(c.schedule.map(s => s.date), ['2026-10-20', '2026-11-14', '2027-01-05']);
  assert.ok(c.checks.some(x => x.includes('연도를 추정')));
  const noTime = normalizeContest(rawContest({ schedule: [{ label: '접수 마감', type: 'deadline', month: 11, day: 14, time: null }], links: [] }),
    { reference: REF, sourceText: '' });
  assert.ok(noTime.checks.some(x => x.includes('마감 시간이 원본에 없어요')));
  assert.equal(noTime.noticeUrl, null);
  assert.deepEqual(normalizeContest({ kind: 'exhibit' }, { reference: REF }), { kind: 'exhibit' });
  assert.throws(() => normalizeContest({ kind: 'party' }, { reference: REF }), /kind/);
  assert.deepEqual(validateContest(JSON.parse(JSON.stringify(c))), c, 'stored JSON round-trips');
});

test('phase, D-day and timeline are computed at view time in KST', () => {
  const c = normalizeContest(rawContest(), { reference: REF, sourceText: SOURCE });
  const at = iso => contestTimeline(c, new Date(iso));
  const before = at('2026-10-15T03:00:00Z');
  assert.equal(before.phase, '모집 예정'); assert.equal(before.schedule[0].st, 'wait');
  const open = at('2026-10-31T03:00:00Z');
  assert.equal(open.phase, '모집 중'); assert.equal(open.dday, 'D-14');
  assert.equal(open.keyLine, '마감 11.14 (토) 18:00 · D-14');
  assert.equal(open.deadlineLabel, '2026.11.14 (토) 18:00 KST');
  assert.deepEqual(open.schedule.map(s => s.st), ['ok', 'run', 'wait']);
  assert.match(open.schedule[2].date, /2027\.01\.05 \(화\) · 연도 추정/);
  assert.equal(at('2026-11-14T08:59:00Z').dday, 'D-DAY', '17:59 KST on the deadline day');
  const closed = at('2026-11-14T09:01:00Z');
  assert.equal(closed.phase, '마감'); assert.equal(closed.dday, null); assert.equal(closed.schedule[1].st, 'ok');
  const unknown = contestTimeline(normalizeContest(rawContest({ schedule: [] }), { reference: REF, sourceText: SOURCE }), new Date('2026-10-31T00:00:00Z'));
  assert.equal(unknown.phase, '마감일 미확인'); assert.equal(unknown.keyLine, '마감일 미확인');
  assert.equal(kstDate(new Date('2026-10-31T15:30:00Z')), '2026-11-01', 'after midnight in Seoul');
});

test('calendar links use Seoul time, all-day when the post gives no time', () => {
  const timed = new URL(calendarLink('공모전', { label: '접수 마감', date: '2026-11-14', time: '18:00' }));
  assert.equal(timed.searchParams.get('dates'), '20261114T180000/20261114T190000');
  assert.equal(timed.searchParams.get('ctz'), 'Asia/Seoul'); assert.equal(timed.searchParams.get('text'), '공모전 · 접수 마감');
  assert.equal(new URL(calendarLink('공모전', { label: '마감', date: '2026-12-31', time: null })).searchParams.get('dates'), '20261231/20270101');
  assert.equal(calendarLink('x', { label: 'y', date: null }), null);
});

test('the processor makes one model call over every input and answers exhibitions and non-recruitment posts honestly', async () => {
  const calls = [];
  const message = { text: '', attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.example/1.jpg', title: SOURCE } }] };
  const jpeg = { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg' };
  const make = reply => createContestProcessor({ now: () => new Date('2026-10-31T03:00:00Z'),
    model: async args => { calls.push(args); return typeof reply === 'string' ? reply : JSON.stringify(reply); } });
  const done = await make(rawContest())(message, { fetchMedia: async () => jpeg });
  assert.equal(done.status, 'done'); assert.equal(done.action, 'schedule'); assert.equal(done.extracted.topic, 'contest');
  assert.equal(calls.length, 1); assert.equal(calls[0].content.filter(c => c.type === 'image').length, 1);
  assert.ok(done.messages.join('\n').includes('모집 중 · D-14'));
  assert.ok(done.messages.join('\n').includes('지원 대상·조건'));
  const exhibit = await make({ kind: 'exhibit' })(message, { fetchMedia: async () => jpeg });
  assert.equal(exhibit.status, 'not_checkable'); assert.match(exhibit.messages[0], /전시·팝업 일정 정리는 준비 중/);
  const none = await make({ kind: 'none' })(message, { fetchMedia: async () => jpeg });
  assert.match(none.messages[0], /모집 정보를 찾지 못했어요/);
  const broken = await make('not json')(message, { fetchMedia: async () => jpeg });
  assert.equal(broken.status, 'failed');
  const unreadable = await make(rawContest())(message, { fetchMedia: async () => { throw new Error('403'); } });
  assert.equal(unreadable.status, 'no_input');
});

test('a contest result is saved as topic "contest" with its v1 JSON, never as a news verdict', async () => {
  const contest = normalizeContest(rawContest(), { reference: REF, sourceText: SOURCE });
  let body;
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_t',
    fetchImpl: async (url, init) => { body = JSON.parse(init.body); return new Response('[{"id":7}]', { status: 201 }); } });
  await state.saveFactCheck('123', { status: 'done', action: 'schedule', contest, verdict: 'supported', reason: 'x',
    extracted: { claim: contest.title, topic: 'contest' }, media: { sourceUrl: 'https://www.instagram.com/p/ABC/' } });
  assert.equal(body.topic, 'contest'); assert.equal(body.claim, contest.title); assert.equal(body.verdict, null);
  assert.deepEqual(JSON.parse(body.reason), { contest, sourceUrl: 'https://www.instagram.com/p/ABC/' });
});

function designModel(items) {
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync('frontend/design/Main.dc.html', 'utf8'))[1];
  class Base { constructor(props) { this.props = props; } setState() {} }
  const model = runInNewContext(script + '\nnew Component({theme:"light"})', { DCLogic: Base });
  model.allItems = () => items;
  return model;
}

test('stored contests render through the original design logic, and fill the home schedule and calendar action', () => {
  const now = new Date('2026-10-31T03:00:00Z');
  const contest = normalizeContest(rawContest(), { reference: REF, sourceText: SOURCE });
  const row = { id: 42, created_at: '2026-10-31T02:00:00Z', status: 'done', topic: 'contest', claim: contest.title, verdict: null,
    reason: JSON.stringify({ contest, sourceUrl: 'https://www.instagram.com/p/ABC123/' }), sources: [], dm_status: 'sent', dm_sent_at: '2026-10-31T02:01:00Z' };
  const item = factcheckToItem(row, now);
  assert.equal(item.type, 'contest'); assert.equal(item.dday, 'D-14'); assert.equal(item.phase, '모집 중');
  assert.equal(item.host, '가상 재단'); assert.equal(item.organizer, '주관 · 가상 운영사무국');
  assert.equal(item.origin, 'https://www.instagram.com/p/ABC123/');
  assert.equal(factcheckToItem({ ...row, reason: '{"contest":{"version":9}}' }, now), null, 'unsupported versions are skipped');

  const model = designModel([item]);
  Object.assign(model.state, { view: 'detail', detailId: 'fc42', connected: true, dataset: 'empty' });
  const v = model.renderVals();
  assert.ok(v.isDetail && v.d.isContest);
  assert.equal(v.d.host, '가상 재단'); assert.ok(v.d.hasDday);
  assert.deepEqual([...v.d.schedule].map(s => s.cls), ['pstep ok', 'pstep run', 'pstep wait']);
  assert.equal(v.d.submit[0].t, '아이디어 기획서 (PDF)'); assert.ok(v.d.hasApply);

  const opened = [];
  const app = { allItems: () => [item], openDetail: id => opened.push(['detail', id]), openExternal: url => opened.push(['url', url]), toast: () => {} };
  const live = contestLiveValues(v, { detailId: 'fc42' }, app);
  assert.equal(live.hasSchedule, true);
  assert.deepEqual(live.schedule.map(e => [e.mon, e.day, e.badge, e.what]),
    [['11월', '14', 'D-14', '접수 마감 · 18:00 KST']], 'only the next 60 days; the January announcement is later');
  live.schedule[0].open(); live.addDeadline();
  assert.deepEqual(opened[0], ['detail', 'fc42']);
  assert.match(opened[1][1], /^https:\/\/calendar\.google\.com\/calendar\/render\?/);
});
