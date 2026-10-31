import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemberApi, createTasteSync, MemberApiError, memberErrorText, browserId } from './public/js/member-sync.js';

const settle = async () => { for (let i = 0; i < 6; i++) await new Promise(resolve => setTimeout(resolve, 0)); };
function dashboard(user = 'member-a') {
  const messages = [];
  const app = { state: { mode: 'live', user: { id: user }, taste: {}, tasteLoaded: false }, toast: msg => messages.push(msg) };
  app.setState = patch => { const before = app.state; app.state = { ...app.state, ...patch }; app.onChange?.(before, app.state); };
  return { app, messages };
}
const memoryStorage = (entries = []) => { const map = new Map(entries);
  return { map, getItem: k => map.get(k) ?? null, setItem: (k, v) => map.set(k, v), removeItem: k => map.delete(k) }; };

test('the API client sends the session token, idempotency key and encoded IDs, and surfaces status codes', async () => {
  const seen = [];
  const api = createMemberApi({ token: async () => 'jwt-1', fetchImpl: async (url, init) => { seen.push([url, init]);
    return new Response(url.includes('fail') ? JSON.stringify({ error: '이미 바뀌었어요.' }) : '{"ok":true}', { status: url.includes('fail') ? 409 : 200 }); } });
  await api.createEvent({ content_id: 'fc1' }, 'ev:abc12345');
  assert.equal(seen[0][0], '/api/calendar'); assert.equal(seen[0][1].headers['Idempotency-Key'], 'ev:abc12345');
  assert.equal(seen[0][1].headers.Authorization, 'Bearer jwt-1'); assert.equal(seen[0][1].body, '{"content_id":"fc1"}');
  await api.removeTaste('fc42-2'); assert.equal(seen[1][0], '/api/taste/fc42-2'); assert.equal(seen[1][1].method, 'DELETE');
  await api.listEvents('2026-11-01', '2026-11-30'); assert.equal(seen[2][0], '/api/calendar?from=2026-11-01&to=2026-11-30');
  const error = await api.updateEvent('fail', {}).catch(e => e);
  assert.equal(error.status, 409); assert.equal(memberErrorText(error, 'x'), '이미 바뀌었어요.');
  const offline = await createMemberApi({ token: async () => '', fetchImpl: async () => { throw new TypeError('offline'); } }).listTaste().catch(e => e);
  assert.equal(offline.status, 0); assert.equal(memberErrorText(offline, '다시 시도해 주세요.'), '다시 시도해 주세요.');
  assert.match(memberErrorText(new MemberApiError(401)), /다시 로그인/);
});

test('taste: server picks load, browser-only picks move once, and old "false" values never remove newer server picks', async () => {
  const { app, messages } = dashboard();
  const storage = memoryStorage([['inthon-taste:member-a', JSON.stringify({ 'fc1': true, 'fc2': false, 'fc3': true, 'fc4': true, 'fc9': true })]]);
  const calls = [];
  const api = { listTaste: async () => ({ items: [{ content_id: 'fc2', collected_at: 'x' }, { content_id: 'fc9', collected_at: 'x' }] }),
    addTaste: async id => { calls.push(id); if (id === 'fc3') throw new MemberApiError(503); if (id === 'fc4') throw new MemberApiError(422); } };
  const sync = createTasteSync({ api, app, storage });
  const ids = await sync.load();
  assert.deepEqual(calls, ['fc1', 'fc3', 'fc4'], 'fc9 is already on the server; fc2=false is ignored');
  assert.deepEqual(app.state.taste, { fc2: true, fc9: true, fc1: true });
  assert.deepEqual(ids.sort(), ['fc1', 'fc2', 'fc9']);
  assert.deepEqual(JSON.parse(storage.map.get('inthon-taste:member-a')), { fc3: true }, 'only the retryable failure stays in the browser');
  assert.match(messages.at(-1), /취향 1개를 계정에 저장/);
});

test('taste: each change is sent per card in order, and a failure restores only that card', async () => {
  const { app, messages } = dashboard();
  const calls = []; let failNext = false;
  const api = { listTaste: async () => ({ items: [{ content_id: 'fc1' }] }),
    addTaste: async id => { calls.push(['add', id]); },
    removeTaste: async id => { calls.push(['remove', id]); if (failNext) { failNext = false; throw new MemberApiError(503); } } };
  const sync = createTasteSync({ api, app, storage: memoryStorage() });
  app.onChange = (before, after) => { if (before.taste !== after.taste) sync.changed(before.taste, after.taste); };
  app.setState({ taste: { 'fc5-2': true } });
  await settle(); assert.deepEqual(calls, [], 'changes before the server list loads are not sent');
  await sync.load();
  app.setState({ taste: { ...app.state.taste, 'fc5-2': true } });
  app.setState({ taste: { ...app.state.taste, fc1: false } });
  app.setState({ taste: { ...app.state.taste, fc1: true } });
  await settle();
  assert.deepEqual(calls, [['add', 'fc5-2'], ['remove', 'fc1'], ['add', 'fc1']]);
  failNext = true;
  app.setState({ taste: { ...app.state.taste, 'fc5-2': false } });
  await settle();
  failNext = true;
  app.setState({ taste: { ...app.state.taste, fc1: false } });
  await settle();
  assert.equal(app.state.taste.fc1, true, 'the failed removal is undone'); assert.equal(app.state.taste['fc5-2'], true, 'each failed card is restored on its own');
  assert.match(messages.at(-1), /빼지 못했어요/);
  app.state.mode = 'demo'; app.setState({ taste: { demo: true } }); await settle();
  assert.ok(!calls.some(([, id]) => id === 'demo'), 'demo picks never reach the server');
});

test('a browser ID is made once and reused', () => {
  const storage = memoryStorage();
  const id = browserId(storage, () => 'abcdef12-3456');
  assert.equal(browserId(storage, () => 'other-value-1'), id);
});
