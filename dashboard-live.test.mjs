import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { factcheckToItem, relative, stamp, linkState, displayName, firstSentence, applyLiveMode, NOT_YET } from './public/js/dashboard-live.js';

const NOW = new Date('2026-10-31T12:00:00Z'); // 21:00 KST
const row = (over = {}) => ({ id: 7, created_at: '2026-10-31T05:20:00Z', status: 'done', verdict: 'refuted',
  claim: 'A시가 청년 전원에게 교통비를 준다', reason: '공고는 조건을 충족한 신청자만 지원해요.', dm_status: 'sent',
  dm_sent_at: '2026-10-31T05:21:00Z',
  sources: [{ url: 'https://www.example.org/notice', title: '공고', source: '예시시청' }, { url: 'javascript:alert(1)' }], ...over });

test('times are shown in KST, relative to today', () => {
  assert.equal(stamp(new Date('2026-10-31T05:20:00Z')), '2026.10.31 14:20');
  assert.equal(relative(new Date('2026-10-31T05:20:00Z'), NOW), '오늘 14:20');
  assert.equal(relative(new Date('2026-10-30T00:05:00Z'), NOW), '어제 09:05');
  assert.equal(relative(new Date('2026-10-28T03:00:00Z'), NOW), '10월 28일');
  // 23:30 UTC on the 30th is already the 31st in Seoul.
  assert.equal(relative(new Date('2026-10-30T23:30:00Z'), NOW), '오늘 08:30');
});

test('fact-check rows map onto the design item shape with honest DM status and safe sources', () => {
  const item = factcheckToItem(row(), NOW);
  assert.equal(item.id, 'fc7'); assert.equal(item.type, 'news'); assert.equal(item.status, 'done');
  assert.equal(item.verdict, 'false'); assert.equal(item.key, '판단 · 거짓');
  assert.equal(item.title, 'A시가 청년 전원에게 교통비를 준다');
  assert.equal(item.dm, 'sent'); assert.equal(item.dmAt, '오늘 14:21'); assert.equal(item.checkedAt, '2026.10.31 14:20 KST');
  assert.deepEqual(item.sources, [{ title: '공고', org: '예시시청', date: '', rel: '근거 자료', relCls: 'rel', why: '', url: 'https://www.example.org/notice' }]);

  const verdicts = Object.fromEntries(['supported', 'refuted', 'context', 'unverified', 'not_checkable', null]
    .map(v => [v, factcheckToItem(row({ verdict: v }), NOW).verdict]));
  assert.deepEqual(verdicts, { supported: 'true', refuted: 'false', context: 'mis', unverified: 'hold', not_checkable: 'hold', null: 'hold' });

  const recent = factcheckToItem(row({ dm_status: 'pending', dm_sent_at: null, created_at: '2026-10-31T11:55:00Z' }), NOW);
  assert.equal(recent.dm, 'waiting');
  const stale = factcheckToItem(row({ dm_status: 'pending', dm_sent_at: null }), NOW);
  assert.equal(stale.dm, 'unknown');

  const failed = factcheckToItem(row({ status: 'no_input', verdict: null, claim: null, reason: null }), NOW);
  assert.equal(failed.status, 'insufficient'); assert.equal(failed.title, '내용을 열지 못한 콘텐츠');
});

test('connection and profile fields', () => {
  assert.deepEqual(linkState(null), { connected: false, account: '', connectedAt: '' });
  assert.deepEqual(linkState({ linked_at: '2026-10-31T01:12:00Z', ig_accounts: { username: 'tester.one' } }),
    { connected: true, account: '@tester.one', connectedAt: '2026.10.31 10:12' });
  assert.equal(linkState({ linked_at: '2026-10-31T01:12:00Z', ig_accounts: { username: null } }).account, 'Instagram 계정 (아이디 확인 전)');
  assert.equal(displayName({ user_metadata: { full_name: '배지원' }, email: 'a@b.c' }), '배지원');
  assert.equal(displayName({ user_metadata: {}, email: 'jiwon@example.com' }), 'jiwon');
});

test('real items render through the original design logic in every view, including detail pages', () => {
  const source = readFileSync('frontend/design/Main.dc.html', 'utf8');
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(source)[1];
  class Base { constructor(props) { this.props = props; } setState() {} }
  const model = runInNewContext(script + '\nnew Component({theme:"light"})', { DCLogic: Base });
  const items = [row(), row({ id: 8, verdict: 'unverified', sources: [] }), row({ id: 9, status: 'failed', verdict: null, claim: null })]
    .map(r => factcheckToItem(r, NOW));
  model.allItems = () => items;
  Object.assign(model.state, { connected: true, dataset: 'empty' });
  for (const view of ['home', 'library', 'taste', 'settings']) {
    model.state.view = view;
    assert.equal(model.renderVals().totalCount, 3, view);
  }
  for (const item of items) {
    Object.assign(model.state, { view: 'detail', detailId: item.id });
    const values = model.renderVals();
    assert.ok(values.isDetail, item.id);
    assert.equal(values.d.id, item.id);
  }
  Object.assign(model.state, { view: 'detail', detailId: 'fc7' });
  const d = model.renderVals().d;
  assert.equal(d.verdictLabel, '거짓');
  assert.equal(d.sources[0].relText, '근거 자료');
  assert.deepEqual([...d.pipeline].map(p => p.label), ['접수됨', '정리 완료', 'DM 발송 확인']);
});

function designModel(items) {
  const source = readFileSync('frontend/design/Main.dc.html', 'utf8');
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(source)[1];
  class Base { constructor(props) { this.props = props; } setState() {} }
  const model = runInNewContext(script + '\nnew Component({theme:"light"})', { DCLogic: Base });
  if (items) model.allItems = () => items;
  return model;
}
const stubApp = () => {
  const calls = [];
  const record = name => (...args) => { calls.push([name, ...args]); };
  return { calls, app: Object.fromEntries(['openBotDm', 'showLinkGuide', 'setState', 'copy', 'checkLink', 'unlinkInstagram',
    'signOut', 'saveDisplayName', 'loadLive', 'toast'].map(name => [name, record(name)])) };
};

test('every template binding has a value in both demo and real-data mode, on every screen', () => {
  const template = readFileSync('public/data/dashboard-template.json', 'utf8');
  assert.doesNotMatch(template, /jimin@example\.com/, 'the login email must come from state, not markup');
  const loopVars = new Set([...template.matchAll(/"as":\s*"(\w+)"/g)].map(m => m[1]));
  const roots = new Set([...template.matchAll(/{{\s*([\w]+)[\w.]*\s*}}/g)].map(m => m[1])
    .filter(root => !loopVars.has(root) && root !== 'true' && root !== 'false'));

  const model = designModel();
  const views = [['home'], ['library'], ['taste'], ['settings'], ['detail', 'n1'], ['detail', 'r1']];
  for (const [view, detailId] of views) {
    Object.assign(model.state, { view, detailId: detailId ?? null });
    const demo = model.renderVals();
    const live = applyLiveMode(model.renderVals(), { ...model.state, email: 'me@example.org', connected: false }, stubApp().app);
    // Some original values (e.g. cook mode) exist only behind their own condition; the live layer must not add gaps.
    for (const root of roots) {
      if (demo[root] !== undefined) assert.notEqual(live[root], undefined, `live ${view}: ${root}`);
    }
    for (const root of MODE_BINDINGS) {
      assert.notEqual(demo[root], undefined, `demo ${view}: ${root}`);
      assert.notEqual(live[root], undefined, `live ${view}: ${root}`);
    }
  }
  for (const root of MODE_BINDINGS) assert.ok(roots.has(root), `template uses ${root}`);
});
const MODE_BINDINGS = ['email', 'isLive', 'dmModeDesc', 'linkGuideOn',
  'copyLinkWord', 'checkLink'];

test('demo mode keeps the original design values', () => {
  const values = designModel().renderVals();
  assert.equal(values.isDemo, true); assert.equal(values.modeBadge, 'DEMO');
  assert.equal(values.email, 'jimin@example.com'); assert.equal(values.linkGuideOn, false);
  assert.match(values.connectDesc, /연결 전에는 보낸 콘텐츠가 내 기록에 들어오지 않아요/);
});

test('real-data mode describes our actual workflow and never pretends demo-only actions succeeded', () => {
  const model = designModel([]);
  Object.assign(model.state, { view: 'settings', connected: false, account: '', email: 'me@example.org' });
  const { app, calls } = stubApp();
  const v = applyLiveMode(model.renderVals(), model.state, app);
  assert.equal(v.isDemo, false); assert.equal(v.modeBadge, '내 데이터'); assert.equal(v.email, 'me@example.org');
  assert.equal(v.linkGuideOn, true, 'not linked: show the DM-link steps');
  for (const flow of ['flowStart', 'flowIssuing', 'flowCode', 'flowVerifying', 'flowVerified', 'flowExpired', 'flowConflict']) {
    assert.equal(v[flow], false, flow);
  }
  assert.match(v.connectDesc, /전에 보낸 콘텐츠도 함께 보여요/);
  assert.equal(v.simDisabled, true);
  v.copyLinkWord(); v.startCode(); v.goConnect();
  assert.deepEqual(calls.map(c => c[0]), ['copy', 'showLinkGuide', 'showLinkGuide']);
  assert.equal(calls[0][1], '연결');
  calls.length = 0;
  for (const name of NOT_YET) v[name]();
  assert.equal(calls.filter(c => c[0] === 'toast').length, NOT_YET.length);
  assert.ok(calls.filter(c => c[0] === 'toast').every(c => /준비 중/.test(c[1])));

  Object.assign(model.state, { connected: true, account: '@tester.one', connModal: 'disconnect' });
  const linked = applyLiveMode(model.renderVals(), { ...model.state, liveGuide: false }, app);
  assert.equal(linked.linkGuideOn, false); assert.equal(linked.showConnected, true);
  assert.match(linked.connModalDesc, /기록은 지워지지 않고, 다시 연결하면 돌아와요/);
  const changing = applyLiveMode(model.renderVals(), { ...model.state, liveGuide: true }, app);
  assert.equal(changing.linkGuideOn, true); assert.equal(changing.changing, true); assert.equal(changing.showConnected, false);
});

test('first sentence for the verdict card and saved display names', () => {
  assert.equal(firstSentence('조건을 충족한 신청자만 받아요. 공고에 따르면 소득 조건이 있어요.'), '조건을 충족한 신청자만 받아요.');
  assert.equal(firstSentence('마침표 없는 이유'), '마침표 없는 이유');
  assert.equal(firstSentence('버전 2.5는 아직 없어요. 다음 문장'), '버전 2.5는 아직 없어요.');
  assert.equal(firstSentence(null), '');
  assert.equal(displayName({ user_metadata: { display_name: '지원', full_name: '배지원' } }), '지원');
});

test('recipe timers distinguish exact cooking duration from ranges, decimals and video timestamps', () => {
  const model = designModel();
  assert.equal(model.secsOf('중불 · 1분 30초'),90);
  assert.equal(model.secsOf('약 3분'),180);
  assert.equal(model.secsOf('약불 · 30초'),30);
  for(const meta of ['3~5분','1.5분','영상 00:12','시간 미기재']) assert.equal(model.secsOf(meta),0,meta);
});

test('the same shared post sent several times lists once with how many times it was sent', async () => {
  const { listItems } = await import('./public/js/dashboard-live.js');
  const post = url => JSON.stringify({ reason: '근거가 있어요.', sourceUrl: url });
  const rows = [
    row({ id: 9, created_at: '2026-10-31T08:00:00Z', reason: post('https://www.instagram.com/p/AbC123/') }),
    row({ id: 8, created_at: '2026-10-31T07:00:00Z', claim: '다른 주장', reason: post('https://www.instagram.com/p/Other1/') }),
    row({ id: 6, created_at: '2026-10-31T06:00:00Z', claim: '옛 제목', reason: post('https://www.instagram.com/p/AbC123/') }),
    row({ id: 5, created_at: '2026-10-31T05:00:00Z', reason: post('https://www.instagram.com/p/AbC123/') }),
    row({ id: 4, created_at: '2026-10-31T04:00:00Z', claim: '링크 없는 공유' }),
    row({ id: 3, created_at: '2026-10-31T03:00:00Z', claim: '링크 없는  공유' }),
  ];
  const { items, hiddenRows } = listItems(rows, NOW);
  assert.deepEqual(items.map(item => item.id), ['fc9', 'fc8', 'fc4']);
  assert.deepEqual(items.map(item => item.sentCount ?? 1), [3, 1, 2]);
  assert.match(items[0].received, /\(3번 보냄\)$/);
  assert.doesNotMatch(items[1].received, /보냄/);
  assert.deepEqual(hiddenRows, [6, 5, 3]);
});
