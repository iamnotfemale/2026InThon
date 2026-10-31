import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createContentChoices, readContentAction } from './content-choices.mjs';

function fixture() {
  const data = new Map(); const claims = new Set(); let clock = 1000;
  const options = { secret: 'test-secret', now: () => clock,
    getBlob: async key => data.has(key) ? { stream: new Response(data.get(key)).body } : null,
    putBlob: async (key, value, opts) => { assert.equal(opts.access, 'private'); data.set(key, value); },
    deleteBlob: async key => { data.delete(key); },
    claim: async key => { if (claims.has(key)) return false; claims.add(key); return true; } };
  return { choices: createContentChoices(options), data, options, advance: ms => { clock += ms; } };
}
const clicked = (offer, index) => ({ text: offer.messages[0].quick_replies[index].title,
  quick_reply: { payload: offer.messages[0].quick_replies[index].payload } });
test('offers exactly five native quick replies without processing media; tickets hide original content', async () => {
  const { choices, data } = fixture();
  const offer = await choices.offer({ mid: 'private-mid', text: 'private-caption' }, '123');
  assert.deepEqual(offer.messages[0].quick_replies.map(b => b.title), ['레시피 정리', '팩트체크', '일정 조회', '맛집 정리', '취향공간 정리']);
  assert.ok(offer.messages[0].quick_replies.every(b => b.content_type === 'text' && b.payload.length < 1000));
  assert.doesNotMatch([...data.values()].join(''), /private-mid|private-caption/);
  assert.doesNotMatch([...data.keys()].join(''), /\/123\//);
});
test('choices survive process restarts and select the correct content when several posts arrive', async () => {
  const { choices, options, data } = fixture();
  const one = await choices.offer({ mid: 'first', text: 'first' }, '123');
  const two = await choices.offer({ mid: 'second', text: 'second' }, '123');
  const restarted = createContentChoices(options); const sequence = [];
  const process = async message => { sequence.push(message.mid); return { status: 'done', messages: ['결과'] }; };
  const ack = async () => sequence.push('ack');
  assert.equal((await restarted.select(clicked(one, 1), '123', process, ack)).kind, 'content');
  await restarted.select(clicked(two, 1), '123', process, ack);
  assert.deepEqual(sequence, ['ack', 'first', 'ack', 'second']); assert.equal(data.size, 0);
});
test('wrong sender, malformed payload, expired and replayed tickets never reach AI', async () => {
  const { choices, advance, data } = fixture();
  const offer = await choices.offer({ mid: 'a' }, '123');
  const fail = () => assert.fail('Must not analyze');
  assert.equal((await choices.select(clicked(offer, 1), '456', fail)).status, 'expired');
  assert.equal((await choices.select({ quick_reply: { payload: '../invalid' } }, '123', fail)).status, 'expired');
  assert.equal(readContentAction({ quick_reply: { payload: {} } }), null);
  advance(20 * 60000);
  assert.equal((await choices.select(clicked(offer, 1), '123', fail)).status, 'expired');
  assert.equal(data.size, 0);
});
test('concurrent clicks run once; recipe and schedule each route their own action with the original post', async () => {
  const { choices } = fixture(); let calls = 0;
  const offer = await choices.offer({ mid: 'a' }, '123');
  const process = async () => { calls++; return { status: 'done', messages: ['결과'] }; };
  const results = await Promise.all([1, 2].map(() => choices.select(clicked(offer, 1), '123', process, async () => {})));
  assert.equal(calls, 1); assert.deepEqual(results.map(r => r.status).sort(), ['done', 'expired']);
  const recipe = await choices.offer({ mid: 'recipe-original' }, '123');
  let selected;
  const recipeResult = await choices.select(clicked(recipe, 0), '123', async (message, action) => {
    assert.equal(message.mid, 'recipe-original'); selected = action; return {status:'done',messages:['레시피']};
  }, async action => assert.equal(action, 'recipe'));
  assert.equal(selected, 'recipe'); assert.equal(recipeResult.action, 'recipe'); assert.equal(recipeResult.kind, 'content');
  // 일정 조회 now runs the 공모전·대외활동 processor (exhibitions are answered as not ready inside it).
  const schedule = await choices.offer({ mid: 'contest-original' }, '123');
  let acknowledged;
  const scheduleResult = await choices.select(clicked(schedule, 2), '123', async (message, action) => {
    assert.equal(message.mid, 'contest-original'); assert.equal(action, 'schedule'); return { status: 'done', messages: ['공고'] };
  }, async action => { acknowledged = action; });
  assert.equal(acknowledged, 'schedule'); assert.equal(scheduleResult.action, 'schedule'); assert.equal(scheduleResult.kind, 'content');
});
test('analysis failure cleans up original input and reports failure without allowing a second analysis', async () => {
  const { choices, data } = fixture();
  const offer = await choices.offer({ mid: 'a' }, '123');
  const result = await choices.select(clicked(offer, 1), '123', async () => { throw new Error('private failure'); }, async () => {});
  assert.equal(result.status, 'failed'); assert.equal(result.kind, 'content'); assert.equal(data.size, 0);
  assert.doesNotMatch(result.messages.join(''), /private failure/);
});
