import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatHistory, createDmAssistant, dmAssistantFromEnv } from './dm-assistant.mjs';
import { createGeminiModel, splitBytes } from './factcheck.mjs';
import { isContentMessage } from './instagram-source.mjs';
import { createContentChoices } from './content-choices.mjs';

function storage() {
  const data = new Map(); let clock = 1000;
  const options = { secret: 'test-secret', now: () => clock,
    getBlob: async key => data.has(key) ? { stream: new Response(data.get(key)).body } : null,
    putBlob: async (key, value, options) => { assert.equal(options.access, 'private'); data.set(key, value); },
    deleteBlob: async key => { data.delete(key); },
    claim: async key => { if (data.has(key)) return false; data.set(key, 'used'); return true; } };
  const history = createChatHistory(options);
  return { history, choices: createContentChoices(options), data, advance: ms => { clock += ms; } };
}
test('ordinary text chats while media/Instagram links go to the content processor', async () => {
  const store = storage(); const calls = [];
  const reply = createDmAssistant({ history: store.history, choices: store.choices,
    model: async args => { calls.push(args); return '안녕! 무엇을 도와줄까?'; },
    processContent: async () => ({ status: 'done', messages: ['콘텐츠 분석 결과'] }) });
  assert.equal((await reply({ text: '안녕' }, { senderId: '123' })).kind, 'chat');
  await reply({ text: '방금 한 말 영어로' }, { senderId: '123' });
  assert.equal(calls[1].history.length, 2); assert.equal(calls[1].json, false);
  const offered = await reply({ attachments: [{ type: 'ig_post', payload: {} }] }, { senderId: '123' });
  assert.equal(offered.kind, 'choice');
  assert.equal(calls.length, 2);
  const payload = offered.messages[0].quick_replies[1].payload;
  assert.equal((await reply({ text: '팩트체크', quick_reply: { payload } }, { senderId: '123' })).kind, 'content');
  await reply({ text: '그 결과를 짧게 요약해줘' }, { senderId: '123' });
  assert.equal(calls.at(-1).history.at(-1).parts[0].text, '콘텐츠 분석 결과');
  for (const message of [{ text: 'https://www.instagram.com/reel/Example/' }, { text: 'https://www.instagram.com/share/x' },
    { attachments: [{ type: 'image' }] }]) assert.ok(isContentMessage(message));
  assert.ok(!isContentMessage({ text: 'https://instagram.com.evil.example/a' }));
});
test('history is encrypted and isolated, capped at twelve messages, expired after 30 minutes and cleared on request', async () => {
  const store = storage();
  const reply = createDmAssistant({ history: store.history, model: async () => '답장', processContent: () => assert.fail() });
  for (let i = 0; i < 8; i++) await reply({ text: 'private test message ' + i }, { senderId: '123' });
  assert.equal((await store.history.read('123')).length, 12);
  assert.deepEqual(await store.history.read('456'), []);
  assert.doesNotMatch([...store.data.keys()].join(''), /123|456/);
  assert.doesNotMatch([...store.data.values()].join(''), /private test message|답장/);
  store.advance(30 * 60000 + 1);
  assert.deepEqual(await store.history.read('123'), []); assert.equal(store.data.size, 0);
  await reply({ text: '새 질문' }, { senderId: '456' });
  assert.match((await reply({ text: '대화 초기화' }, { senderId: '456' })).messages[0], /초기화/);
  assert.deepEqual(await store.history.read('456'), []);
});
test('history outages allow stateless replies; reset failures are not reported as successful deletion', async () => {
  let warnings = 0;
  const reply = createDmAssistant({ history: { read: async () => { throw new Error(); }, write: async () => { throw new Error(); }, clear: async () => { throw new Error(); } },
    model: async () => '답장', warn: () => { warnings++; } });
  assert.equal((await reply({ text: '안녕' }, { senderId: '123' })).messages[0], '답장');
  assert.equal(warnings, 2);
  assert.equal((await reply({ text: '/초기화' }, { senderId: '123' })).status, 'failed');
});
test('Gemini chat sends previous roles and plain-text output while retaining provider cancellation', async () => {
  let sent;
  const model = createGeminiModel({ apiKey: 'fake', thinkingLevel: 'minimal', fetchImpl: async (_url, options) => {
    sent = JSON.parse(options.body); return Response.json({ candidates: [{ content: { parts: [{ text: '기억해요.' }] } }] });
  } });
  const history = [{ role: 'user', parts: [{ text: '내 이름은 민이야' }] }, { role: 'model', parts: [{ text: '반가워요.' }] }];
  assert.equal(await model({ system: '대화', content: [{ type: 'text', text: '내 이름이 뭐야?' }], json: false, history }), '기억해요.');
  assert.equal(sent.contents.length, 3); assert.equal(sent.generationConfig.responseMimeType, undefined);
  assert.equal(sent.generationConfig.thinkingConfig.thinkingLevel, 'minimal');
  assert.equal(dmAssistantFromEnv({ env: {} }), undefined);
});
test('long chat replies split safely at Unicode boundaries and preserve the entire message', () => {
  const text = '😀'.repeat(600) + '한국어 문장';
  const parts = splitBytes(text);
  assert.equal(parts.join(''), text);
  assert.ok(parts.every(part => Buffer.byteLength(part) <= 900 && !part.includes('\ufffd')));
});
