import { test } from 'node:test';
import assert from 'node:assert/strict';
import { withinTime, exhibitWorthSearching, contestImportantMissing } from './web-fill-policy.mjs';
import { normalizeContest, validateContest, applyContestFills, contestMissingFields } from './public/js/contest-data.js';
import { createContestFiller, createContestProcessor, contestMessages } from './contest.mjs';
import { createExhibitFiller } from './exhibit.mjs';
import { factcheckToItem } from './public/js/dashboard-live.js';

const REF = '2026-10-31';
const contest = (over = {}) => normalizeContest({
  kind: 'contest', title: '디미 청년 아이디어 공모전', summary: '아이디어를 모집해요.', host: null, organizer: null, sponsors: [],
  schedule: [], eligibility: [], submissions: [], process: [], benefits: [], fee: null, contact: null, links: [], checks: [], ...over,
}, { reference: REF, sourceText: '' });

const page = (url, text) => ({ url, contentType: 'text/html; charset=utf-8',
  body: Buffer.from(`<html><head><title>디미 청년 아이디어 공모전 공고</title></head><body><p>${text}</p><p>${'안내 문구입니다. '.repeat(30)}</p></body></html>`) });
const PAGE_TEXT = '디미 청년 아이디어 공모전 접수기간 2026. 10. 20.(화) ~ 2026. 11. 14.(토) 18:00 '
  + '지원자격 만 19~34세 청년 누구나 시상 대상 1팀 상금 300만 원 주최 디미재단 신청 https://apply.example.org/form 에서 접수';

test('policy: search only for what matters, and never for things already over', () => {
  const event = over => ({ title: '빛의 방', titleGenerated: false, place: '가상 미술관', end: '2026-12-20', booking: null, ...over });
  assert.equal(exhibitWorthSearching(event(), ['hours'], REF), true);
  assert.equal(exhibitWorthSearching(event(), ['closed', 'conditions', 'official_url'], REF), false, 'minor fields alone do not justify a search');
  assert.equal(exhibitWorthSearching(event({ end: '2026-10-01' }), ['hours'], REF), false, 'ended');
  assert.equal(exhibitWorthSearching(event({ titleGenerated: true, place: null }), ['hours'], REF), false, 'nothing specific to search');
  assert.equal(exhibitWorthSearching(event({ place: null }), ['address'], REF), false, 'no place to look up an address for');
  assert.equal(exhibitWorthSearching(event({ booking: '네이버 예약 필수' }), ['reserve_url'], REF), true);
  assert.equal(exhibitWorthSearching(event({ booking: '예약 없이 입장' }), ['reserve_url'], REF), false);

  assert.deepEqual(contestImportantMissing(contest(), REF), ['deadline', 'links', 'eligibility']);
  const closed = contest({ schedule: [{ label: '접수 마감', type: 'deadline', year: 2026, month: 10, day: 1, time: null, raw: '10.1' }] });
  assert.deepEqual(contestImportantMissing(closed, REF), [], 'recruitment over: no search');
  const complete = contest({ schedule: [{ label: '접수 마감', type: 'deadline', year: 2026, month: 11, day: 14, time: null, raw: '11.14' }],
    eligibility: [{ text: '누구나' }], links: [{ label: 'apply', url: 'https://a.example' }] });
  assert.deepEqual(contestImportantMissing({ ...complete, applyUrl: 'https://a.example' }, REF), [], 'only a missing time: not worth a search');
});

test('withinTime abandons slow work and returns the fallback on time', async () => {
  const started = Date.now();
  assert.deepEqual(await withinTime(new Promise(() => {}), 50, []), []);
  assert.ok(Date.now() - started < 1000);
  assert.equal(await withinTime(Promise.resolve('fast'), 50, 'late'), 'fast');
});

test('contest fills keep only verbatim-quoted values from opened pages, never overriding the post', () => {
  const c = contest({ schedule: [{ label: '접수 시작', type: 'start', year: 2026, month: 10, day: 20, time: '10:00', raw: '10.20' }] });
  const pages = [{ id: 'W1', url: 'https://contest.example.org/notice', title: '공고', text: PAGE_TEXT }];
  const filled = applyContestFills(c, { fills: [
    { field: 'deadline', value: { date: '2026-11-14', time: '18:00' }, source: 'W1', quote: '2026. 11. 14.(토) 18:00' },
    { field: 'host', value: '디미재단', source: 'W1', quote: '주최 디미재단' },
    { field: 'eligibility', value: ['만 19~34세 청년 누구나'], source: 'W1', quote: '지원자격 만 19~34세 청년 누구나' },
    { field: 'apply_url', value: 'https://apply.example.org/form', source: 'W1', quote: '신청 https://apply.example.org/form' },
    { field: 'benefits', value: ['상금 1억'], source: 'W1', quote: '상금 1억 원 지급' },             // quote not in the page
    { field: 'notice_url', value: 'https://invented.example/x', source: 'W1', quote: '주최 디미재단' }, // URL not in the page
    { field: 'organizer', value: 'X', source: 'W9', quote: '주최 디미재단' },                         // page we did not open
    { field: 'start', value: { date: '2026-09-01', time: null }, source: 'W1', quote: '주최 디미재단' }, // the post already has it
  ], conflicts: ['페이지의 마감 시간이 게시물과 달라요'] }, pages);
  assert.equal(filled, 4);
  const deadline = c.schedule.find(x => x.type === 'deadline');
  assert.deepEqual([deadline.date, deadline.time, deadline.web], ['2026-11-14', '18:00', true]);
  assert.equal(c.host, '디미재단'); assert.equal(c.applyUrl, 'https://apply.example.org/form'); assert.equal(c.noticeUrl, null);
  assert.equal(c.organizer, null); assert.deepEqual(c.benefits, []);
  assert.equal(c.schedule.filter(x => x.type === 'start').length, 1, 'post value kept');
  assert.deepEqual(Object.keys(c.web).sort(), ['apply_url', 'deadline', 'eligibility', 'host']);
  assert.ok(c.checks.includes('웹 안내와 다름: 페이지의 마감 시간이 게시물과 달라요'));
  assert.ok(!c.checks.includes('접수 마감일이 원본에 없어요.'), 'the now-answered gap is no longer listed');
  // Stored and re-read without losing the web marks.
  const stored = validateContest(JSON.parse(JSON.stringify(c)));
  assert.equal(stored.schedule.find(x => x.type === 'deadline').web, true); assert.equal(stored.web.host.url, 'https://contest.example.org/notice');
  const dm = contestMessages(stored, new Date('2026-10-31T03:00:00Z')).join('\n');
  assert.match(dm, /주최 디미재단 \*/); assert.match(dm, /만 19~34세 청년 누구나 \*/); assert.match(dm, /\* 표시는 게시물에 없어 웹에서 찾은 정보예요/);
});

test('contest fills reject earlier rounds and deadlines before the application start', () => {
  const c = contest({ schedule: [{ label: '접수 시작', type: 'start', year: 2026, month: 11, day: 1, time: null, raw: '11.1' }] });
  const pages = [{ id: 'W1', url: 'https://contest.example.org/2025', title: '작년', text: '2025년 접수 마감 2025. 11. 14. / 마감 2026. 10. 25.' }];
  const n = applyContestFills(c, { fills: [
    { field: 'deadline', value: { date: '2025-11-14', time: null }, source: 'W1', quote: '2025년 접수 마감 2025. 11. 14.' },
    { field: 'deadline', value: { date: '2026-10-25', time: null }, source: 'W1', quote: '마감 2026. 10. 25.' },
  ] }, pages);
  assert.equal(n, 0); assert.ok(!c.schedule.some(x => x.type === 'deadline'));
});

test('the contest filler skips the web when nothing important is missing, and stays within its time budget', async () => {
  let searches = 0; let modelCalls = 0;
  const model = async () => { modelCalls++; return JSON.stringify({ fills: [] }); };
  const complete = contest({ schedule: [{ label: '접수 마감', type: 'deadline', year: 2026, month: 11, day: 14, time: '18:00', raw: '11.14' }],
    eligibility: [{ text: '누구나' }] });
  complete.applyUrl = 'https://a.example';
  const filler = createContestFiller({ model, search: { bing: async () => { searches++; return []; } }, fetchPage: async () => assert.fail() });
  assert.deepEqual(await filler(complete), { searched: false, filled: 0 }); assert.equal(searches, 0);

  // A search that never answers is abandoned at the gather deadline and the model is not called.
  const slow = createContestFiller({ model, search: { bing: () => new Promise(() => {}) }, fetchPage: async () => assert.fail(),
    budget: { totalMs: 300, gatherMs: 60, pageMs: 50, maxTargets: 3, pagesPerTarget: 3 } });
  const started = Date.now();
  assert.deepEqual(await slow(contest()), { searched: true, filled: 0 });
  assert.ok(Date.now() - started < 1000); assert.equal(modelCalls, 0);
});

test('the contest filler opens only results naming the contest and fills from them', async () => {
  const fetched = []; let prompt;
  const filler = createContestFiller({
    search: { bing: async query => { assert.match(query, /디미 청년 아이디어 공모전 접수 마감/); return [
      { url: 'https://contest.example.org/notice', title: '디미 청년 아이디어 공모전 모집', snippet: '' },
      { url: 'https://unrelated.example/ad', title: '다이어트 보조제 할인', snippet: '' }]; } },
    fetchPage: async url => { fetched.push(url); return page(url, PAGE_TEXT); },
    model: async ({ content }) => { prompt = content[0].text; return JSON.stringify({ fills: [
      { field: 'deadline', value: { date: '2026-11-14', time: '18:00' }, source: 'W1', quote: '2026. 11. 14.(토) 18:00' }] }); },
  });
  const c = contest();
  assert.deepEqual(await filler(c), { searched: true, filled: 1 });
  assert.deepEqual(fetched, ['https://contest.example.org/notice'], 'the unrelated result is never fetched');
  assert.match(prompt, /비어 있는 칸: deadline, start, host, organizer, notice_url, apply_url, eligibility/);
  assert.equal(contestMissingFields(c).includes('deadline'), false);
});

test('a failing web step never loses the post-only contest result', async () => {
  const jpeg = { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg' };
  const raw = { kind: 'contest', title: '디미 공모전', summary: null, host: null, organizer: null, sponsors: [], schedule: [], eligibility: [],
    submissions: [], process: [], benefits: [], fee: null, contact: null, links: [], checks: [] };
  const processor = createContestProcessor({ now: () => new Date('2026-10-31T03:00:00Z'), model: async () => JSON.stringify(raw),
    fill: async () => { throw new Error('search down'); } });
  const result = await processor({ text: '', attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.example/1.jpg' } }] },
    { fetchMedia: async () => jpeg });
  assert.equal(result.status, 'done'); assert.equal(result.contest.title, '디미 공모전');
});

test('the exhibition filler does not search ended events and abandons slow searches', async () => {
  let searches = 0; let modelCalls = 0;
  const exhibit = { reference: REF, events: [
    { title: '끝난 전시', titleGenerated: false, place: '가상 미술관', end: '2026-10-01', web: {} },
    { title: '진행 중 전시', titleGenerated: false, place: '가상 미술관', end: '2026-12-20', web: {} },
  ] };
  const filler = createExhibitFiller({ model: async () => { modelCalls++; return '{}'; },
    search: { bing: () => { searches++; return new Promise(() => {}); } }, fetchPage: async () => assert.fail(),
    budget: { totalMs: 300, gatherMs: 60, pageMs: 50, maxTargets: 3, pagesPerTarget: 3 } });
  const started = Date.now();
  assert.deepEqual(await filler(exhibit), { searched: 1, filled: 0 });
  assert.equal(searches, 1, 'only the running event is searched'); assert.equal(modelCalls, 0); assert.ok(Date.now() - started < 1000);
});

test('the dashboard marks web values and lists their sources', () => {
  const c = contest();
  applyContestFills(c, { fills: [{ field: 'host', value: '디미재단', source: 'W1', quote: '주최 디미재단' },
    { field: 'eligibility', value: ['만 19~34세 청년 누구나'], source: 'W1', quote: '지원자격 만 19~34세 청년 누구나' }] },
  [{ id: 'W1', url: 'https://contest.example.org/notice', title: '공고', text: PAGE_TEXT }]);
  const item = factcheckToItem({ id: 9, created_at: '2026-10-31T02:00:00Z', status: 'done', topic: 'contest', claim: c.title, verdict: null,
    reason: JSON.stringify({ contest: c, sourceUrl: null }), sources: [], dm_status: 'sent', dm_sent_at: null }, new Date('2026-10-31T03:00:00Z'));
  assert.equal(item.host, '디미재단 (웹 확인)');
  assert.deepEqual(item.elig, ['만 19~34세 청년 누구나 (웹 확인)']);
  assert.ok(item.checks.some(x => x.startsWith('웹에서 확인한 주최·지원 대상: 공고 (https://contest.example.org/notice)')));
});
