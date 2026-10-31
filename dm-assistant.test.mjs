import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createChatHistory, createDmAssistant, dmAssistantFromEnv, savedContentContext } from './dm-assistant.mjs';
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
    model: async args => { calls.push(args); return '안녕, 디미예요! 무엇을 정리해드릴까요?'; },
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

test('follow-up chat receives saved analysis beyond the temporary history and its exact private link, without re-analysis', async () => {
  const store = storage(); const calls = []; const senders = [];
  const row = { id: 51, status: 'done', claim: '등촌칼국수', topic: 'health', created_at: '2026-11-01T00:00:00Z',
    reason: JSON.stringify({ reason: '내용'.repeat(2200) + ' 마지막 단계: 남은 국물에 칼국수면을 넣는다.',
      sourceUrl: 'https://www.instagram.com/reel/example/', contentIndex: { embedding: ['never-send-embedding'] } }), sources: [] };
  const reply = createDmAssistant({ history: store.history, publicUrl: 'https://example.test',
    recentResults: async sender => { senders.push(sender); return sender === '123' ? [row] : []; },
    model: async args => { calls.push(args); return '정리 결과를 이어서 설명해드릴게요.'; },
    processContent: () => assert.fail('follow-ups never re-download or re-analyse the reel') });
  for (const text of ['그 릴스 마지막 단계가 뭐였어?', '그거 정리한 링크 다시 줘', '너 뭐 할 수 있어?']) await reply({ text }, { senderId: '123' });
  const context = calls[0].content[0].text;
  assert.match(context, /마지막 단계: 남은 국물에 칼국수면/); assert.match(context, /https:\/\/example.test\/items\/fc51/);
  assert.doesNotMatch(context, /never-send-embedding|igsid|senderId/);
  assert.equal(calls[0].history.length, 0, 'saved results work after the short chat memory expires');
  assert.equal(calls[1].content.at(-1).text, '그거 정리한 링크 다시 줘');
  assert.match(calls[2].system, /기능 질문에는 게시물 공유를 조건으로 걸지 말고 바로 답한다/);
  assert.match(calls[2].system, /원본의 사실과 구분해서 제안/);
  await reply({ text: '그 릴스 링크 줘' }, { senderId: '456' });
  assert.deepEqual(calls.at(-1).content, [{ type: 'text', text: '그 릴스 링크 줘' }]);
  assert.deepEqual(senders, ['123', '123', '123', '456']);
  await reply({ text: '대화 초기화' }, { senderId: '123' });
  assert.equal(senders.length, 4, 'reset does not fetch saved results');
});

test('saved context keeps every recipe step, checks and per-card links while omitting search embeddings', () => {
  const recipe = { version: 1, title: '간단 요리', summary: '원본 레시피', serving: null, prep: null, cook: null, total: null,
    ingredients: [{ name: '면', quantity: null, optional: false, group: '기본', evidence: '영상 화면', conflict: null }],
    steps: [{ text: '면을 넣는다.', duration: null, heat: null, temperature: null, uses: ['면'], evidence: '영상 화면', note: null }],
    tips: [], checks: ['분량은 원본에 없어요.'] };
  const rows = [{ id: 1, status: 'done', topic: 'recipe', created_at: '2026-11-01T00:00:00Z', claim: recipe.title, reason: JSON.stringify({ recipe,
    contentIndex: { embedding: ['private-vector'] }, sourceUrl: 'https://www.instagram.com/reel/example/' }) },
    { id: 2, status: 'no_input', reason: 'failed media' }];
  const context = savedContentContext(rows, 'https://example.test');
  assert.equal(context.length, 1); assert.deepEqual(context[0].analysis.recipe, recipe);
  assert.deepEqual(context[0].items, [{ title: recipe.title, result_url: 'https://example.test/items/fc1' }]);
  assert.doesNotMatch(JSON.stringify(context), /private-vector|failed media/);
  const places = savedContentContext([{ id: 3, status: 'done', topic: 'restaurant', claim: '맛집 모음', created_at: '2026-11-01T00:00:00Z',
    restaurants: [{ position: 1, name: '첫 번째 식당' }, { position: 2, name: '두 번째 식당' }] }], 'https://example.test');
  assert.deepEqual(places[0].items.map(i => i.result_url), ['https://example.test/items/fc3', 'https://example.test/items/fc3-2']);
  assert.deepEqual(places[0].analysis.restaurants.map(p => p.name), ['첫 번째 식당', '두 번째 식당']);
  assert.throws(() => savedContentContext(rows, 'http://example.test'), /Invalid public URL/);
});

test('saved-result lookup failure does not prevent ordinary chat or invent a result link', async () => {
  let warning = 0; let prompt;
  const reply = createDmAssistant({ history: storage().history, recentResults: async () => { throw new Error('private details'); },
    warn: () => warning++, model: async args => { prompt = args; return '안녕, 디미예요!'; } });
  assert.equal((await reply({ text: '안녕' }, { senderId: '123' })).status, 'done');
  assert.equal(warning, 1); assert.deepEqual(prompt.content, [{ type: 'text', text: '안녕' }]);
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

test('server-deferred history never delays chat or a content result and still saves the conversation',async()=>{
  for(const content of [false,true]){
    const tasks=[];const events=[];
    const reply=createDmAssistant({history:{read:async()=>{events.push('read');return[];},write:async()=>{events.push('write');}},
      choices:{select:async()=>({kind:'content',status:'done',messages:['미용 결과']})},model:async()=>{events.push('model');return '안녕, 디미예요!';}});
    const result=await reply(content?{quick_reply:{payload:'test'}}:{text:'안녕'}, {senderId:'123',defer:task=>{tasks.push(task);}});
    assert.equal(result.status,'done');assert.deepEqual(events,content?[]:['read','model']);
    assert.equal(tasks.length,1);await tasks[0]();assert.deepEqual(events,content?['read','write']:['read','model','write']);
  }
});
