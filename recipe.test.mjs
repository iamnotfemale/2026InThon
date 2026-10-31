import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGeminiModel } from './factcheck.mjs';
import { createRecipeProcessor, validateRecipe, recipeMessages } from './recipe.mjs';
import { createSupabaseState } from './supabase-state.mjs';
import { factcheckToItem } from './public/js/dashboard-live.js';

const sample = () => ({is_recipe:true,title:'간단 우동',summary:'원본의 면과 양념을 순서대로 정리했어요.',serving:null,prep:null,cook:null,total:null,
  ingredients:[{name:'우동면',quantity:'1개',group:'기본 재료',evidence:'이미지 1: 우동면 1개',conflict:null},
    {name:'간장',quantity:'1스푼 또는 2스푼',group:'양념',evidence:'이미지 1: 1스푼 / 이미지 3: 2스푼',conflict:'재료표는 1스푼, 단계에는 2스푼'}],
  steps:[{text:'면을 익히고 간장을 넣어요.',duration:null,heat:null,temperature:null,uses:['우동면','간장','추측한 재료'],evidence:'이미지 2: 면을 익힌 뒤 양념',note:null}],
  tips:[],checks:['간장 분량은 원본 확인이 필요해요.']});
const jpeg = Buffer.from([255,216,255,224]); const mp4 = Buffer.concat([Buffer.alloc(4),Buffer.from('ftypisom')]);

test('recipe model receives all seven images, actual video and caption together, without a transcript-only stage', async () => {
  let calls=0;
  const process=createRecipeProcessor({model:async({content,system})=>{
    calls++; assert.equal(content.filter(c=>c.type==='image').length,7); assert.equal(content.filter(c=>c.type==='video').length,1);
    assert.equal(content.find(c=>c.type==='video').source.data,mp4.toString('base64'));
    assert.match(content.at(-1).text,/본문의 조리법/); assert.match(system,/추측/); return JSON.stringify(sample());
  }});
  const result=await process({attachments:Array.from({length:8},(_,i)=>({type:i===1?'video':'image',payload:{url:String(i),title:i===0?'본문의 조리법':''}}))},
    {fetchMedia:async url=>({contentType:url==='1'?'video/mp4':'image/jpeg',body:url==='1'?mp4:jpeg})});
  assert.equal(calls,1);assert.equal(result.status,'done');assert.equal(result.action,'recipe');
  assert.equal(result.recipe.serving,null);assert.equal(result.recipe.steps[0].duration,null);
  assert.deepEqual(result.recipe.steps[0].uses,['우동면','간장']);assert.match(result.recipe.ingredients[1].conflict,/재료표/);
  assert.equal(result.recipe.checks.length,1,'a named conflict already in checks is not repeated');
  assert.ok(result.messages.every(s=>Buffer.byteLength(s)<=900));
});

test('malformed or incomplete recipe, non-recipe and unreadable media never become saved successes', async () => {
  for (const value of [{is_recipe:false},{...sample(),steps:[]},{...sample(),ingredients:[{...sample().ingredients[0],evidence:''}]},null]) {
    const result=await createRecipeProcessor({model:async()=>JSON.stringify(value)})({text:'원본 조리 설명'});
    assert.notEqual(result.status,'done');assert.equal(result.recipe,undefined);
  }
  let calls=0;
  const result=await createRecipeProcessor({model:async()=>{calls++;return JSON.stringify(sample());}})(
    {attachments:[{type:'video',payload:{url:'private'}}]}, {fetchMedia:async()=>({body:Buffer.from('<html>login</html>'),contentType:'video/mp4'})});
  assert.equal(calls,0);assert.equal(result.status,'no_input');
  assert.throws(()=>validateRecipe({...sample(),steps:Array(31).fill(sample().steps[0])}));
});

test('Gemini serializes video and images inline with JSON output and never uses external input URLs', async () => {
  const model=createGeminiModel({apiKey:'test-key',fetchImpl:async(url,options)=>{
    const body=JSON.parse(options.body);const parts=body.contents[0].parts;
    assert.equal(parts[0].inline_data.mime_type,'video/mp4');assert.equal(parts[1].inline_data.mime_type,'image/jpeg');
    assert.equal(body.generationConfig.responseMimeType,'application/json');
    assert.equal(options.headers['x-goog-api-key'],'test-key');return new Response(JSON.stringify({candidates:[{content:{parts:[{text:'{}'}]}}]}));
  }});
  await model({system:'recipe',content:[{type:'video',source:{type:'base64',media_type:'video/mp4',data:'dmlkZW8='}},
    {type:'image',source:{type:'base64',media_type:'image/jpeg',data:'aW1hZ2U='}}]});
});

test('complete structured recipes survive existing Supabase storage and render through the recipe design, including source-less shares', async () => {
  let row;
  const recipe=validateRecipe(sample());
  const state=createSupabaseState({url:'https://test.supabase.co',key:'sb_secret_test',fetchImpl:async(url,options)=>{
    row=JSON.parse(options.body);return new Response('[{"id":18}]',{status:201});
  }});
  const result={status:'done',action:'recipe',recipe,media:{sourceUrl:'https://www.instagram.com/p/DWC9FAsAeOD/'}};
  assert.deepEqual(await state.saveFactCheck('123',result),{id:18});
  assert.equal(row.topic,'recipe');assert.equal(row.verdict,null);assert.equal(JSON.parse(row.reason).recipe.title,recipe.title);
  const item=factcheckToItem({...row,id:18,created_at:'2026-10-31T00:00:00Z'});
  assert.equal(item.type,'recipe');assert.equal(item.title,recipe.title);assert.equal(item.origin,result.media.sourceUrl);
  assert.equal(item.ingredients[1].flag,true);assert.equal(item.steps[0].meta,'시간 미기재');
  assert.equal(item.serving,'인분 미기재');
  row.reason=JSON.stringify({recipe,sourceUrl:null});assert.equal(factcheckToItem({...row,id:18,created_at:'2026-10-31T00:00:00Z'}).type,'recipe');
  row.reason='broken';assert.equal(factcheckToItem({...row,id:18,created_at:'2026-10-31T00:00:00Z'}),null);
  const messages=recipeMessages({...recipe,summary:'아주 긴 요리 설명 '.repeat(120)});
  assert.ok(messages.every(m=>Buffer.byteLength(m)<=900));
});

test('a recipe collection is organized one recipe per call and returned as separate parts', async () => {
  const titles = ['두부찌개', '총각김치', '부추장'];
  const calls = [];
  const dish = title => ({ ...sample(), title, ingredients: [{ ...sample().ingredients[0], name: title + ' 재료' }],
    steps: [{ ...sample().steps[0], uses: [title + ' 재료'] }], checks: [] });
  const process = createRecipeProcessor({
    listModel: async ({ system }) => { assert.match(system, /레시피가 몇 개/); return JSON.stringify({ recipes: titles.map(title => ({ title })) }); },
    model: async ({ content }) => {
      const focus = content.at(-1).text.match(/<focus>.*?'(.+?)'/)?.[1] ?? null; calls.push(focus);
      if (focus === '총각김치') throw new Error('Gemini 호출 실패 (HTTP 500)');
      return JSON.stringify(dish(focus ?? titles[0]));
    } });
  const warn = console.warn; const logged = []; console.warn = line => logged.push(line);
  let result;
  try { result = await process({ text: '레시피 모음 본문' }); } finally { console.warn = warn; }
  assert.deepEqual(calls.sort(), [null, '부추장', '총각김치'].sort());
  assert.equal(result.status, 'done');
  assert.deepEqual(result.parts.map(p => p.recipe.title), ['두부찌개', '부추장']);
  assert.ok(result.parts.every(p => p.action === 'recipe' && p.extracted.claim === p.recipe.title && p.contentIndex));
  assert.match(result.messages[0], /레시피 2개/); assert.match(result.messages[0], /정리하지 못한 레시피: 총각김치/);
  assert.equal(result.recipe.title, '두부찌개');
  assert.deepEqual(logged.map(line => JSON.parse(line)), [{ event: 'recipe_failed', stage: 'recipe_2', error: 'Gemini 호출 실패 (HTTP 500)' }]);
});

test('a single recipe stays one result, and an array or overlong evidence from the model no longer fails the whole recipe', async () => {
  const long = { ...sample(), ingredients: [{ ...sample().ingredients[0], evidence: '근거'.repeat(300) }] };
  for (const reply of [JSON.stringify([sample(), { ...sample(), title: '다른 요리' }]), JSON.stringify(long)]) {
    const result = await createRecipeProcessor({ model: async () => reply,
      listModel: async () => JSON.stringify({ recipes: [{ title: '간단 우동' }] }) })({ text: '원본 조리 설명' });
    assert.equal(result.status, 'done'); assert.equal(result.parts, undefined); assert.equal(result.recipe.title, '간단 우동');
    assert.ok(result.recipe.ingredients[0].evidence.length <= 400);
  }
});
