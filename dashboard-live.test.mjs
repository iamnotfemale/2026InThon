import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { factcheckToItem, relative, stamp, linkState, displayName } from './public/js/dashboard-live.js';

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
