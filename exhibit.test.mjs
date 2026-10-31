import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { normalizeExhibit, validateExhibit, exhibitView, closedWeekdays, rawWeekdays, visitCalendarLink } from './public/js/exhibit-data.js';
import { createExhibitExtractor, exhibitMessages, exhibitContent } from './exhibit.mjs';
import { createContestProcessor } from './contest.mjs';
import { factcheckToItem, exhibitRowItems, contestLiveValues, rowIdOf } from './public/js/dashboard-live.js';
import { createSupabaseState } from './supabase-state.mjs';

const REF = '2026-10-31';
const CAPTION = '11월 서울 무료 전시 9곳 · 예약 https://songeun.example/reserve';
// What the model returned for the @seoultravel card news (two of its nine events), plus one invented link.
const songeun = (over = {}) => ({
  title: '송은 X 불가리 《LIGHT, FORM AND VISION》', title_is_generated: false, name: 'LIGHT, FORM AND VISION', host_or_artist: '송은 X 불가리',
  kind: '전시', media: '이미지1', intro: '불가리 대표 주얼리 컬렉션을 한국 작가들의 시선으로 재해석한 현대미술 전시예요.',
  date_raw: '26.10.29(목)~11.14(토)', start_date: '2026-10-29', end_date: '2026-11-14', period_text: null, year_inferred: false,
  hours: null, closed: null, place: '송은', address: '서울 강남구 도산대로 441', area: null, fee: '무료', is_free: true,
  booking: '사전예약 필수', conditions: null, reserve_url: 'https://songeun.example/reserve', official_url: 'https://made-up.example/songeun',
  evidence: { title: '이미지1', date_raw: '이미지1', fee: '본문' }, conflicts: [], notices: [], checks: [], ...over,
});
const gander = (over = {}) => songeun({ title: '라이언 갠더 개인전', name: null, host_or_artist: null, media: '이미지9',
  intro: '라이언 갠더의 일상 속 사물 재해석 전시예요.', date_raw: '26.11.21(토)~27.01.26(화)', start_date: '2026-11-21', end_date: '2027-01-26',
  place: '에스더쉬퍼', address: '서울 용산구 한남대로46길 24', booking: null, reserve_url: null, official_url: null,
  hours: '화–토 11:00 – 18:00', closed: '매주 일·월요일', ...over });
const rawExhibit = (events = [songeun(), gander()]) => ({ is_event: true, content_type: 'carousel',
  shared: { fee: '무료', area: '서울', booking: null, notes: null }, events });

test('normalising keeps only links found in the received text and flags weekday or year doubts without changing dates', () => {
  const e = normalizeExhibit(rawExhibit(), { reference: REF, sourceText: CAPTION });
  assert.equal(e.events.length, 2);
  const [first, second] = e.events;
  assert.equal(first.reserveUrl, 'https://songeun.example/reserve');
  assert.equal(first.officialUrl, null, 'a link that is not in the caption is dropped');
  assert.ok(first.checks.some(c => c.includes('이미지 속 링크')));
  assert.equal(first.dateRaw, '26.10.29(목)~11.14(토)'); assert.equal(first.start, '2026-10-29');
  assert.ok(!first.checks.some(c => c.includes('요일')), '목/토 match 2026-10-29 and 2026-11-14');
  const wrong = normalizeExhibit(rawExhibit([songeun({ date_raw: '10.29(금)~11.14(토)' })]), { reference: REF, sourceText: '' });
  assert.ok(wrong.events[0].checks.some(c => c.includes('요일(금·토)')), 'a weekday mismatch is reported, the date is kept');
  assert.equal(wrong.events[0].start, '2026-10-29');
  const inferred = normalizeExhibit(rawExhibit([songeun({ year_inferred: true, start_date: '2026-12-10', end_date: '2026-01-15', date_raw: '12.10~1.15' })]),
    { reference: REF, sourceText: '' });
  assert.equal(inferred.events[0].end, '2027-01-15', 'an inferred end before the start moves a year on');
  assert.ok(inferred.events[0].checks.some(c => c.includes('연도를 정했어요')));
  assert.equal(second.closed, '매주 일·월요일');
  assert.deepEqual(normalizeExhibit({ is_event: false, events: [] }, { reference: REF }), { kind: 'none' });
  assert.deepEqual(normalizeExhibit(rawExhibit([{ title: '' }]), { reference: REF }), { kind: 'none' }, 'unreadable entries are skipped');
  assert.deepEqual(validateExhibit(JSON.parse(JSON.stringify(e))), e, 'stored JSON round-trips');
  assert.throws(() => validateExhibit({ ...e, version: 2 }), /Unsupported/);
});

test('closing days are read only from weekly wording, so visit dates never come from a guess', () => {
  assert.deepEqual(closedWeekdays('매주 월요일'), ['월']);
  assert.deepEqual(closedWeekdays('매주 일·월요일'), ['일', '월']);
  assert.deepEqual(closedWeekdays('월·화 휴관'), ['월', '화']);
  assert.deepEqual(closedWeekdays('휴관일: 매주 월요일'), ['월'], 'the 일 of 휴관일 is not Sunday');
  assert.deepEqual(closedWeekdays('연중무휴'), []);
  assert.deepEqual(closedWeekdays(null), []);
  assert.equal(closedWeekdays('매주 월요일 (공휴일인 경우 다음 날)'), null);
  assert.equal(closedWeekdays('11월 3일 휴관'), null);
  assert.deepEqual(rawWeekdays('26.10.29(목)~11.14(토)'), ['목', '토']);
});

test('phase, period and visit dates are computed at view time in KST', () => {
  const [first, second] = normalizeExhibit(rawExhibit(), { reference: REF, sourceText: CAPTION }).events;
  const now = new Date('2026-10-31T03:00:00Z');
  const a = exhibitView(first, now);
  assert.equal(a.phase, '진행 중'); assert.equal(a.period, '2026.10.29 – 2026.11.14'); assert.equal(a.keyLine, '10.29 – 11.14 · 송은');
  assert.deepEqual(a.visits.map(v => v.label), ['10월 31일 (토)', '11월 1일 (일)', '11월 2일 (월)', '11월 3일 (화)', '11월 4일 (수)'],
    'no closing day in the post: every day is offered');
  assert.equal(a.daysLeft, 14);
  assert.match(a.mapUrl, /^https:\/\/map\.naver\.com\/p\/search\//);
  const b = exhibitView(second, now);
  assert.equal(b.phase, '예정'); assert.equal(b.keyLine, '예정 · 11.21 – 1.26 · 에스더쉬퍼');
  assert.deepEqual(b.visits.map(v => v.label), ['11월 21일 (토)', '11월 24일 (화)', '11월 25일 (수)', '11월 26일 (목)', '11월 27일 (금)'],
    'visits start on the opening day and skip 일·월');
  assert.equal(exhibitView(first, new Date('2026-11-15T03:00:00Z')).phase, '종료');
  assert.deepEqual(exhibitView({ ...first, closed: '11월 3일 휴관' }, now).visits, [], 'irregular closing days give no suggestions');
  const permanent = exhibitView({ ...first, start: null, end: null, periodText: '상설' }, now);
  assert.equal(permanent.phase, '기간 미확인'); assert.equal(permanent.period, '상설');
  const cal = new URL(visitCalendarLink(first, '2026-11-01'));
  assert.equal(cal.searchParams.get('dates'), '20261101/20261102'); assert.equal(cal.searchParams.get('location'), '서울 강남구 도산대로 441');
});

test('the 일정 조회 action hands exhibitions to their own prompt over the media it already holds', async () => {
  const calls = [];
  const message = { text: '', attachments: [{ type: 'ig_post', payload: { url: 'https://cdn.example/1.jpg', title: CAPTION } }] };
  const jpeg = { body: Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]), contentType: 'image/jpeg' };
  const model = async args => {
    calls.push(args);
    return JSON.stringify(args.system.includes('공모전·대외활동') ? { kind: 'exhibit' } : rawExhibit());
  };
  const now = () => new Date('2026-10-31T03:00:00Z');
  const processor = createContestProcessor({ model, now, exhibit: createExhibitExtractor({ model, now }) });
  const done = await processor(message, { fetchMedia: async () => jpeg });
  assert.equal(done.status, 'done'); assert.equal(done.action, 'schedule'); assert.equal(done.extracted.topic, 'exhibit');
  assert.equal(done.extracted.claim, '송은 X 불가리 《LIGHT, FORM AND VISION》 외 1곳');
  assert.equal(calls.length, 2, 'classification, then the exhibition prompt');
  assert.deepEqual(calls[1].content.slice(0, 2).map(c => c.type === 'text' ? c.text : c.type), ['[이미지1]', 'image'], 'images carry the labels evidence refers to');
  assert.match(calls[1].content.at(-1).text, /기준일: 2026-10-31/);
  const dm = done.messages.join('\n');
  assert.match(dm, /\[1\/2\] 송은 X 불가리 《LIGHT, FORM AND VISION》 · 진행 중/);
  assert.match(dm, /기간: 2026\.10\.29 – 2026\.11\.14/); assert.match(dm, /예약 링크: https:\/\/songeun\.example\/reserve/);
  assert.ok(!dm.includes('made-up.example'));

  const none = await createExhibitExtractor({ model: async () => '{"is_event":false,"events":[]}', now })(
    { images: [], videos: [], captions: [], text: '카페 소개', scope: [], notes: [] });
  assert.equal(none.status, 'not_checkable');
});

test('an exhibition result is saved as topic "exhibit" with its v1 JSON, never as a news verdict', async () => {
  const exhibit = normalizeExhibit(rawExhibit(), { reference: REF, sourceText: CAPTION });
  let body;
  const state = createSupabaseState({ url: 'https://x.supabase.co', key: 'sb_secret_t',
    fetchImpl: async (url, init) => { body = JSON.parse(init.body); return new Response('[{"id":8}]', { status: 201 }); } });
  await state.saveFactCheck('123', { status: 'done', action: 'schedule', exhibit, verdict: 'supported',
    extracted: { claim: '송은 외 1곳', topic: 'exhibit' }, media: { sourceUrl: 'https://www.instagram.com/p/DfGWmhJk7NC/' } });
  assert.equal(body.topic, 'exhibit'); assert.equal(body.claim, '송은 외 1곳'); assert.equal(body.verdict, null);
  assert.deepEqual(JSON.parse(body.reason), { exhibit, sourceUrl: 'https://www.instagram.com/p/DfGWmhJk7NC/' });
});

function designModel(items) {
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync('frontend/design/Main.dc.html', 'utf8'))[1];
  class Base { constructor(props) { this.props = props; } setState() {} }
  const model = runInNewContext(script + '\nnew Component({theme:"light"})', { DCLogic: Base });
  model.allItems = () => items;
  return model;
}

test('a stored exhibition post becomes one item per event and renders through the original design', () => {
  const now = new Date('2026-10-31T03:00:00Z');
  const exhibit = normalizeExhibit(rawExhibit(), { reference: REF, sourceText: CAPTION });
  const row = { id: 42, created_at: '2026-10-31T02:00:00Z', status: 'done', topic: 'exhibit', claim: '송은 외 1곳', verdict: null,
    reason: JSON.stringify({ exhibit, sourceUrl: 'https://www.instagram.com/p/DfGWmhJk7NC/' }), sources: [], dm_status: 'sent', dm_sent_at: '2026-10-31T02:01:00Z' };
  const items = exhibitRowItems(row, now);
  assert.deepEqual(items.map(i => [i.id, i.rowId, i.type]), [['fc42', 'fc42', 'exhibit'], ['fc42-2', 'fc42', 'exhibit']]);
  assert.equal(rowIdOf('fc42-2'), 'fc42'); assert.equal(rowIdOf('fc42'), 'fc42');
  const [first, second] = items;
  assert.equal(first.hours, '운영 시간 미기재'); assert.equal(first.closed, '휴무일 미기재'); assert.equal(first.fee, '무료');
  assert.equal(first.reserveUrl, 'https://songeun.example/reserve'); assert.equal(first.origin, 'https://www.instagram.com/p/DfGWmhJk7NC/');
  assert.equal(second.phase, '예정'); assert.equal(second.closed, '매주 일·월요일');
  assert.equal(factcheckToItem(row, now).id, 'fc42', 'the single-item mapper returns the first event');
  assert.deepEqual(exhibitRowItems({ ...row, reason: '{"exhibit":{"version":9}}' }, now), [], 'unsupported versions are skipped');

  const model = designModel(items);
  Object.assign(model.state, { view: 'detail', detailId: 'fc42', connected: true, dataset: 'empty' });
  const v = model.renderVals();
  assert.ok(v.isDetail && v.d.isExhibit);
  assert.equal(v.d.closedCls, 'v miss'); assert.equal(v.d.bookingCls, 'v'); assert.ok(v.d.hasReserve);

  const opened = [];
  const app = { allItems: () => items, openDetail: id => opened.push(['detail', id]), openExternal: url => opened.push(['url', url]),
    setState: () => {}, toast: () => {} };
  const live = contestLiveValues(v, { detailId: 'fc42' }, app);
  assert.deepEqual(live.schedule.map(e => [e.mon, e.day, e.what, e.badge]), [['11월', '14', '전시 종료일 · 진행 중', 'D-14']],
    'only closings in the next 60 days; the January closing is later');
  live.d.visitDates[1].pick();
  assert.match(opened[0][1], /^https:\/\/calendar\.google\.com\/calendar\/render\?.*dates=20261101%2F20261102/);
});

test('empty fields are filled only from opened pages, with a verbatim quote, and stay marked as web information', async () => {
  const { createExhibitFiller } = await import('./exhibit.mjs');
  const { missingFields, shownValue } = await import('./public/js/exhibit-data.js');
  const exhibit = normalizeExhibit(rawExhibit([songeun({ reserve_url: null, official_url: null })]), { reference: REF, sourceText: CAPTION });
  const event = exhibit.events[0];
  assert.deepEqual(missingFields(event), ['hours', 'closed', 'conditions', 'official_url', 'reserve_url']);
  const html = body => ({ url: 'https://www.songeun.or.kr/exhibition/now', contentType: 'text/html',
    body: Buffer.from(`<html><head><title>송은 LIGHT, FORM AND VISION</title></head><body><article><p>${body}</p></article></body></html>`) });
  const page = '송은 LIGHT, FORM AND VISION 전시 안내입니다. 관람시간 화요일부터 토요일 11:00~18:30 (입장 마감 18:00) 입니다. '
    + '휴관일은 매주 일요일, 월요일 및 공휴일입니다. 사전예약은 https://www.songeun.or.kr/reserve 에서 할 수 있어요. 이 문장은 길이를 채우기 위한 설명 문장입니다. '.repeat(2);
  const queries = [];
  const search = { bing: async (q) => { queries.push(q); return [
    { url: 'https://www.songeun.or.kr/exhibition/now', title: '송은 LIGHT, FORM AND VISION', snippet: '관람 안내' },
    { url: 'https://spam.example/', title: '무관한 광고', snippet: '대출' }]; } };
  const fetched = [];
  const model = async ({ content }) => {
    assert.match(content[0].text, /비어 있는 칸: hours, closed, conditions, official_url, reserve_url/);
    return JSON.stringify({ events: [{ id: 'T1', fills: [
      { field: 'hours', value: '화–토 11:00 – 18:30 (입장 마감 18:00)', source: 'W1', basis: 'venue', quote: '관람시간 화요일부터 토요일 11:00~18:30 (입장 마감 18:00) 입니다.' },
      { field: 'closed', value: '매주 일·월요일, 공휴일', source: 'W1', basis: 'venue', quote: '휴관일은 매주 일요일, 월요일 및 공휴일입니다.' },
      { field: 'conditions', value: '만 19세 이상', source: 'W1', basis: 'event', quote: '만 19세 이상 관람 가능합니다.' },
      { field: 'fee', value: '10,000원', source: 'W1', basis: 'event', quote: '관람시간 화요일부터' },
      { field: 'reserve_url', value: 'https://www.songeun.or.kr/reserve', source: 'W1', basis: 'event', quote: '사전예약은 https://www.songeun.or.kr/reserve 에서 할 수 있어요.' },
      { field: 'official_url', value: 'https://made-up.example/', source: 'W1', basis: 'event', quote: '송은 LIGHT, FORM AND VISION 전시 안내입니다.' },
      { field: 'hours', value: '중복', source: 'W9', basis: 'event', quote: 'x' },
    ], conflicts: ['페이지의 종료일은 11월 15일이에요.'] }] });
  };
  const fill = createExhibitFiller({ model, search, fetchPage: async url => { fetched.push(url); return html(page); } });
  const stats = await fill(exhibit);
  assert.match(queries[0], /LIGHT, FORM AND VISION 송은 운영시간 휴관일/);
  assert.deepEqual(fetched, ['https://www.songeun.or.kr/exhibition/now'], 'unrelated results are not opened');
  assert.deepEqual(Object.keys(event.web), ['hours', 'closed', 'reserve_url'],
    'a made-up quote, an already-filled field, an unknown page and a link not on the page are all dropped');
  assert.equal(stats.filled, 3);
  assert.equal(event.hours, null, "the post's own field stays empty");
  assert.deepEqual(shownValue(event, 'hours'), { value: '화–토 11:00 – 18:30 (입장 마감 18:00)', web: event.web.hours });
  assert.equal(event.web.closed.basis, 'venue');
  assert.ok(event.conflicts.includes('웹 안내와 다름: 페이지의 종료일은 11월 15일이에요.'));
  assert.deepEqual(validateExhibit(JSON.parse(JSON.stringify(exhibit))), exhibit, 'web fills round-trip through storage');

  // The view uses the web closing days for visit suggestions; the dashboard and DM mark web values.
  const view = exhibitView(event, new Date('2026-10-31T03:00:00Z'));
  assert.equal(view.visits.length, 0, '"공휴일" makes closing days irregular, so no visit dates are guessed');
  const row = { id: 9, created_at: '2026-10-31T02:00:00Z', status: 'done', topic: 'exhibit', claim: event.title, verdict: null,
    reason: JSON.stringify({ exhibit, sourceUrl: null }), sources: [], dm_status: 'sent' };
  const [item] = exhibitRowItems(row, new Date('2026-10-31T03:00:00Z'));
  assert.equal(item.hours, '화–토 11:00 – 18:30 (입장 마감 18:00) (웹 확인)');
  assert.equal(item.reserveUrl, 'https://www.songeun.or.kr/reserve');
  assert.ok(item.checks.some(c => c.startsWith('웹에서 찾은 운영 시간·휴무일·예약 링크: 송은 LIGHT, FORM AND VISION')));
  const dm = exhibitMessages(exhibit, new Date('2026-10-31T03:00:00Z')).join('\n');
  assert.match(dm, /운영: 화–토 11:00 – 18:30 \(입장 마감 18:00\) \*/);
  assert.match(dm, /\* 표시는 게시물에 없어 웹에서 찾은 정보예요/);
  assert.match(dm, /https:\/\/www\.songeun\.or\.kr\/exhibition\/now/);
});

test('a search outage keeps the post-only result', async () => {
  const model = async () => JSON.stringify(rawExhibit());
  const extractor = createExhibitExtractor({ model, now: () => new Date('2026-10-31T03:00:00Z'), fill: async () => { throw new Error('Bing down'); } });
  const done = await extractor({ images: [], videos: [], captions: [CAPTION], text: '', scope: [], notes: [] });
  assert.equal(done.status, 'done'); assert.equal(done.exhibit.events.length, 2);
});
