import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { normalizeContentIndex, indexFromRow, indexedItems, inferInterests, matchesContent } from './public/js/content-index.js';
import { createOpenAIDecisions, embeddingMatches } from './openai-decisions.mjs';
import { createContentSearchHandler } from './api/content-search.mjs';
import { createRecipeProcessor } from './recipe.mjs';
import { createSupabaseState } from './supabase-state.mjs';
import { factcheckToItem, exhibitRowItems } from './public/js/dashboard-live.js';
import { normalizeExhibit } from './public/js/exhibit-data.js';
import { applyIndexValues } from './public/js/dashboard-index.js';

const rawIndex = { description: '우삼겹과 면으로 만드는 국물 요리', tags: [{ label: '국물 요리', evidence: '영상1 00:05 국물에 면을 넣음' }],
  entities: ['우삼겹'], attributes: [{ name: '시간', value: null, evidence: '미확인' }] };
const row = (id, topic = 'recipe', source = id) => ({ id, status: 'done', topic, claim: '우동 ' + id,
  created_at: '2026-11-01T00:00:00Z', reason: JSON.stringify({ contentIndex: normalizeContentIndex(rawIndex, { category: topic, title: '우동 ' + id }),
    sourceUrl: 'https://www.instagram.com/reel/' + source + '/' }) });

test('one bounded factual index supports search; unknown attributes and unevidenced tags are not stored', () => {
  const index = normalizeContentIndex({ ...rawIndex, tags: [...rawIndex.tags, { label: '건강식' }] }, { category: 'recipe', title: '우동' });
  assert.equal(index.attributes.length, 0); assert.equal(index.tags.length, 1);
  assert.ok(matchesContent({ id: 'fc1', contentIndex: index }, '우삼겹'));
  assert.equal(matchesContent({ rowId: 'fc1', id: 'fc1-2' }, '고기 국수', { query: '고기 국수', ids: ['fc1'] }), false);
  assert.ok(matchesContent({ rowId: 'fc1', id: 'fc1-2' }, '고기 국수', { query: '고기 국수', ids: ['fc1-2'] }));
  assert.equal(matchesContent({ id: 'fc2', contentIndex: index }, '고기 국수', { query: '고기 국수', ids: ['fc1'] }), false);
  const legacy = indexFromRow({ topic: 'recipe', claim: '우동', reason: JSON.stringify({ recipe: { summary: '요약', ingredients: [{ name: '우삼겹' }] } }) });
  assert.equal(legacy.origin, 'stored_result'); assert.match(legacy.searchText, /우삼겹/);
});

test('interest evidence needs two distinct originals and excludes news, contests and unsuccessful rows', () => {
  assert.deepEqual(inferInterests([row(1), row(2, 'recipe', 1), row(3, 'news'), row(4, 'contest'), { ...row(5), status: 'failed' }]), []);
  const groups = inferInterests([row(1), row(2)]);
  assert.equal(groups.length, 1); assert.equal(groups[0].signal, 'shared_interest');
  assert.deepEqual(groups[0].evidence.map(e => e.id), ['fc1', 'fc2']);
});

test('Gemini extraction adds an index in the same media call and storage/display reuse it', async () => {
  let calls = 0; let saved;
  const process = createRecipeProcessor({ model: async ({ system }) => {
    calls++; assert.match(system, /content_index/);
    return JSON.stringify({ is_recipe: true, title: '우동', summary: '국물 우동', ingredients: [{ name: '면', quantity: null, group: '기본', evidence: '본문' }],
      steps: [{ text: '면을 끓여요.', evidence: '본문', uses: ['면'] }], tips: [], checks: [], content_index: rawIndex });
  } });
  const result = await process({ text: '조리법' });
  assert.equal(result.status, 'done'); assert.equal(calls, 1);
  const state = createSupabaseState({ url: 'https://test.supabase.co', key: 'sb_secret_mock',
    embedIndex: async () => { throw new Error('provider unavailable'); },
    fetchImpl: async (_, init) => { saved = JSON.parse(init.body); return Response.json([{ id: 7 }]); } });
  await state.saveFactCheck('123', result);
  assert.equal(JSON.parse(saved.reason).contentIndex.tags[0].label, '국물 요리');
  assert.equal(factcheckToItem({ ...saved, id: 7, created_at: '2026-11-01T00:00:00Z' }).title, '우동');
  const news = factcheckToItem({ id: 8, status: 'done', created_at: '2026-11-01T00:00:00Z',
    reason: JSON.stringify({ reason: '근거를 확인했어요.', contentIndex: result.contentIndex }), claim: '주장', verdict: 'unverified' });
  assert.equal(news.reason, '근거를 확인했어요.'); assert.ok(!news.reason.includes('contentIndex'));
});

test('native Decisions schema, finite answer validation, embedding reuse and sanitized failures', async () => {
  const calls = [];
  const client = createOpenAIDecisions({ apiKey: 'secret-test', fetchImpl: async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('embeddings')) return Response.json({ data: [{ embedding: Array(256).fill(0.5) }] });
    return Response.json({ answers: [{ name: 'fc1', type: 'score', score: 1.9, confidence: 0.8 },
      { name: 'fc2', type: 'refusal' }, { name: 'fc999', type: 'score', score: 2, confidence: 1 }] });
  } });
  const index = indexFromRow(row(1)); index.embedding = await client.embed(index.searchText);
  assert.equal(embeddingMatches(index), true); assert.equal(embeddingMatches({ ...index, searchText: 'changed' }), false);
  const answers = await client.rank({ query: '국물', candidates: [{ id: 'fc1', index }, { id: 'fc2', index }] });
  assert.deepEqual([...answers.keys()], ['fc1']); assert.equal(calls.length, 2);
  assert.equal(calls[1].body.model, 'gpt-6-luna'); assert.equal(calls[1].body.questions.length, 2);
  assert.equal(calls[1].body.questions[0].levels[0].label, '근거 부족 또는 관련 없음');
  assert.ok(!JSON.stringify(calls[1].body).includes('vector'));
  const broken = createOpenAIDecisions({ apiKey: 'secret-test', fetchImpl: async () => new Response('secret-test echo', { status: 429 }) });
  await assert.rejects(broken.embed('x'), error => error.message === 'OpenAI HTTP 429');
});

const uid = '12345678-1234-1234-1234-123456789012';
async function invoke(handler, body, headers = {}) {
  const req = Readable.from([typeof body === 'string' ? body : JSON.stringify(body)]);
  req.method = 'POST'; req.headers = { origin: 'https://inthon.yeoziphab.com', authorization: 'Bearer ' + 'a'.repeat(30), ...headers };
  let status; let payload;
  await handler(req, { writeHead: code => { status = code; }, end: raw => { payload = JSON.parse(raw); } });
  return { status, payload };
}

test('search forwards caller JWT for RLS, excludes hidden content before inference/model calls and caches by owned data', async () => {
  let ranks = 0; let data = [row(1), row(2), row(3)]; const dbCalls = [];
  const handler = createContentSearchHandler({ preferences: { read: async id => { assert.equal(id, uid); return { hidden: ['fc3'] }; } },
    fetchImpl: async (url, init) => {
      dbCalls.push(init.headers); return Response.json(url.includes('/auth/') ? { id: uid } : data);
    }, decisions: { rank: async ({ candidates, interests }) => {
      ranks++; assert.deepEqual(candidates.map(c => c.id), ['fc1', 'fc2']); assert.equal(interests[0].evidence.length, 2);
      return new Map([['fc1', { score: 1.1 }], ['fc2', { score: 1.8 }]]);
    } } });
  const first = await invoke(handler, { action: 'search', query: '고기 면', user_id: 'someone-else' });
  assert.equal(first.status, 200); assert.deepEqual(first.payload.ids, ['fc2', 'fc1']);
  await invoke(handler, { action: 'search', query: '고기 면' }); assert.equal(ranks, 1);
  assert.ok(dbCalls.every(headers => headers.Authorization === 'Bearer ' + 'a'.repeat(30)));
  assert.equal((await invoke(handler, { action: 'search', query: '고기' }, { authorization: '' })).status, 401);
  assert.equal((await invoke(handler, { action: 'search', query: '고기' }, { origin: 'https://evil.example' })).status, 403);
  assert.equal((await invoke(handler, { action: 'search', query: 'x'.repeat(201) })).status, 400);
  assert.equal((await invoke(handler, 'null')).status, 400);
});

test('provider outages preserve text search and empty/evidence-poor libraries do not call a model', async () => {
  let ranks = 0;
  const handler = createContentSearchHandler({ preferences: { read: async () => ({ hidden: [] }) },
    fetchImpl: async url => Response.json(url.includes('/auth/') ? { id: uid } : [row(1)]),
    decisions: { rank: async () => { ranks++; throw new Error('outage'); } } });
  const result = await invoke(handler, { action: 'search', query: '우삼겹' });
  assert.deepEqual(result.payload.ids, ['fc1']); assert.equal(result.payload.degraded, true);
  const interests = await invoke(handler, { action: 'interests' });
  assert.deepEqual(interests.payload.interests, []); assert.deepEqual(interests.payload.ids, []); assert.equal(ranks, 1);
});

test('live interest cards show actual indexed evidence, no questionnaire or fabricated time claims', () => {
  const items = [{ id: 'fc1', type: 'recipe', title: '우동' }, { id: 'fc2', type: 'recipe', title: '국수' }];
  const state = { mode: 'live', tasteTab: 'recipe', indexInterests: inferInterests([row(1), row(2)]), interestIds: ['fc2'] };
  const values = applyIndexValues({}, state, { allItems: () => items });
  assert.equal(values.tasteEditable, false); assert.equal(values.tasteShowCard, true);
  assert.match(values.tasteCardLabel, /국물 요리/); assert.match(values.tasteCardDesc, /추정/);
  assert.equal(values.tasteEvidence.length, 2); assert.equal(values.tasteRecommendations[0].title, '국수');
});

test('multi-exhibition posts index and search the individual cards without leaking sibling venues', async () => {
  const exhibit = normalizeExhibit({ is_event: true, events: [
    { title: '현대미술 기획전', kind: '전시', intro: '국립현대미술관의 기획전', place: '국립현대미술관 서울관', media: '이미지1', evidence: { place: '이미지1' } },
    { title: '주얼리 전시', kind: '전시', intro: '주얼리를 소개하는 전시', place: '송은', media: '이미지2', evidence: { place: '이미지2' } },
  ] }, { reference: '2026-11-01', sourceText: '' });
  const parent = { id: 99, status: 'done', topic: 'exhibit', claim: '국립현대미술관과 송은 전시', created_at: '2026-11-01T00:00:00Z',
    reason: JSON.stringify({ exhibit, contentIndex: normalizeContentIndex({ description: '국립현대미술관과 송은' }) }) };
  const items = exhibitRowItems(parent); assert.equal(items.length, 2);
  assert.equal(matchesContent(items[0], '국립현대미술관'), true);
  assert.equal(matchesContent(items[1], '국립현대미술관'), false);
  assert.equal(matchesContent(items[1], '국립현대미술관', { query: '국립현대미술관', ids: ['fc99'] }), false);
  assert.deepEqual(indexedItems(parent).map(item => item.id), ['fc99', 'fc99-2']);
  assert.deepEqual(inferInterests([parent]), [], 'two events in the same original are one interest sample');
  const handler = createContentSearchHandler({ preferences: { read: async () => ({ hidden: [] }) },
    fetchImpl: async url => Response.json(url.includes('/auth/') ? { id: uid } : [parent]),
    decisions: { rank: async ({ candidates }) => {
      assert.deepEqual(candidates.map(c => c.id), ['fc99']);
      assert.ok(!JSON.stringify(candidates).includes('송은'));
      return new Map([['fc99', { score: 2 }]]);
    } } });
  const result = await invoke(handler, { action: 'search', query: '국립현대미술관' });
  assert.deepEqual(result.payload.ids, ['fc99']);
});

test('embedding a multi-event post uses one batch request and maps out-of-order answers correctly', async () => {
  let calls = 0;
  const client = createOpenAIDecisions({ apiKey: 'mock-key', fetchImpl: async (_, init) => {
    calls++; assert.deepEqual(JSON.parse(init.body).input, ['행사 A', '행사 B']);
    return Response.json({ data: [{ index: 1, embedding: Array(256).fill(0.2) }, { index: 0, embedding: Array(256).fill(0.1) }] });
  } });
  const results = await client.embed(['행사 A', '행사 B']);
  assert.equal(calls, 1); assert.equal(results[0].vector[0], 0.1); assert.equal(results[1].vector[0], 0.2);
});

test('taste tabs preserve the counts of the manual collections when no repeated interest exists', () => {
  const values = applyIndexValues({ tasteCount: 3, tasteTabs: [{ count: 2 }, { count: 1 }] },
    { mode: 'live', indexInterests: [], tasteTab: 'recipe' }, { allItems: () => [] });
  assert.equal(values.tasteCount, 3); assert.deepEqual(values.tasteTabs.map(t => t.count), [2, 1]);
  assert.equal(values.showInterestNotice, true); assert.match(values.interestNoticeTitle, /아직/);
});
