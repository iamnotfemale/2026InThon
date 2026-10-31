import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import DashboardModel from './public/js/dashboard-model.js';
import {createMobileDashboard} from './public/js/dashboard-mobile.js';
import {validateBeauty} from './public/js/beauty-data.js';
import {factcheckToItem} from './public/js/dashboard-live.js';
import {indexFromRow} from './public/js/content-index.js';
import {applyTasteOrbitValues} from './public/js/dashboard-taste.js';
import {createBeautyProcessor, normalizeBeauty} from './beauty.mjs';
import {createSupabaseState} from './supabase-state.mjs';
import {createMediaFactChecker} from './media-pipeline.mjs';

const samples=JSON.parse(readFileSync('frontend/data/sample-data.json','utf8')).ITEMS.filter(i=>i.type==='beauty');
const stored=sample=>({id:31,created_at:'2026-11-01T01:00:00Z',status:'done',topic:'beauty',claim:sample.title,
  reason:JSON.stringify({beauty:{version:1,...sample,sponsored:sample.sub==='product'},sourceUrl:'https://www.instagram.com/p/Example/'})});

test('beauty salon and product details filter and render through both layouts without joining taste or calendar categories',()=>{
  const app=new DashboardModel({theme:'light'});
  app.setState=patch=>Object.assign(app.state,patch); app.toast=()=>{};
  const mobile=createMobileDashboard(app);
  const items=samples.map(sample=>factcheckToItem(stored(sample)));
  for(const sample of samples){
    app.state.view='detail';app.state.detailId=sample.id;
    for(const v of [app.renderVals(),mobile()]){
      assert.equal(v.d.isBeauty,true);assert.equal(v.d.tasteable,false);
      assert.equal(v.d.bFacts.length,4);assert.equal(v.d.points.length,3);assert.equal(v.d.bLinks.length,2);
      assert.equal(v.d.bSectionTitle,sample.sub==='salon'?'장소·예약':'구매처');
    }
  }
  app.state.view='library';app.state.typeF='beauty';
  assert.deepEqual(app.renderVals().libItems.map(i=>i.id).sort(),['b1','b2']);
  assert.equal(mobile().libItems.length,2);
  assert.equal(app.renderVals().sideTypes.find(t=>t.label==='미용').count,2);
  const taste=applyTasteOrbitValues({}, {taste:{fc31:true}}, {allItems:()=>items,setState:()=>{}});
  assert.equal(taste.tasteCount,0);
  assert.equal(items[1].phase,'협찬 표시 있음');assert.equal(items[0].phase,null);
});

test('stored beauty data keeps unrecorded fields unknown, preserves the category and rejects unsafe links or malformed data',()=>{
  const row=stored({...samples[0],address:null,hours:null});
  const item=factcheckToItem(row);
  assert.equal(item.address,'주소 미기재');assert.equal(item.hours,'운영 시간 미기재');
  assert.equal(indexFromRow(row).category,'beauty');
  assert.equal(item.origin,'https://www.instagram.com/p/Example/');
  for(const url of ['javascript:alert(1)','data:text/html,x','https://name:pass@example.test/']){
    const bad={version:1,...samples[0],links:[['링크',url,1]]};
    assert.throws(()=>validateBeauty(bad));
    assert.equal(factcheckToItem({...row,reason:JSON.stringify({beauty:bad})}),null);
  }
  assert.throws(()=>validateBeauty({version:1,...samples[0],bFacts:[['가격',{}]]}));
  assert.equal(factcheckToItem({...row,reason:'{"beauty":{}}'}),null);
});

const source = '가상 크림. #광고 50ml, 가격 미기재. 구매 https://shop.example.test/cream';
const rawBeauty = (sub = 'product') => ({is_beauty:true,sub,title:sub==='product'?'가상 크림':'가상 살롱 — 커트',intro:'게시물에서 소개한 미용 정보예요.',
  bFacts:[['가격',null],['용량','50ml']],points:['작성자는 부드러운 사용감이라고 설명해요.'],sponsored:true,
  links:[['구매','https://shop.example.test/cream',true],['예약','https://invented.example.test/',true],['위험','javascript:alert(1)',true]]});

test('beauty normalisation retains unknowns and author claims; only source URLs become links',()=>{
  for(const sub of ['salon','product']){
    const beauty=normalizeBeauty(rawBeauty(sub),source);
    assert.equal(beauty.version,1);assert.equal(beauty.sub,sub);
    assert.deepEqual(beauty.bFacts[0],['가격','미기재']);assert.equal(beauty.address,'주소 미기재');
    assert.equal(beauty.sponsored,true);assert.match(beauty.caution,/작성자의 설명/);
    assert.deepEqual(beauty.links,[['구매','https://shop.example.test/cream',true]]);
  }
  assert.equal(normalizeBeauty({is_beauty:false}),null);
  assert.throws(()=>normalizeBeauty({}),/Invalid beauty/);
  assert.throws(()=>normalizeBeauty({...rawBeauty(),sub:'news'}),/Invalid beauty/);
});

test('one Gemini analysis reads all staged images and video; saved beauty renders in the dashboard and originals are released afterward',async()=>{
  let analysed=false,cleaned=false,calls=0,body;
  const files=[{kind:'image',path:'image1'},{kind:'image',path:'image2'},{kind:'video',path:'video1'}];
  const jpeg=Buffer.from([0xff,0xd8,0xff,0xe0,1,2,3]);const mp4=Buffer.from('0000ftypisom0000');
  const processor=createMediaFactChecker({resolveSource:async()=>({status:'resolved',url:'https://www.instagram.com/p/BeautyExample/',via:'text'}),
    prepare:async()=>({files,caption:source,fetchMedia:async path=>({body:path==='video1'?mp4:jpeg,contentType:path==='video1'?'video/mp4':'image/jpeg'}),
      cleanup:async()=>{assert.ok(analysed);cleaned=true;}}),
    check:createBeautyProcessor({model:async args=>{
      calls++;assert.equal(args.content.filter(p=>p.type==='image').length,2);assert.equal(args.content.filter(p=>p.type==='video').length,1);
      assert.match(args.content.at(-1).text,/#광고/);assert.match(args.system,/content_index/);analysed=true;
      return JSON.stringify({...rawBeauty(),content_index:{description:'가상 크림의 사용감을 소개해요.',entities:['가상 크림']}});
    }})});
  const result=await processor({text:'https://www.instagram.com/p/BeautyExample/'});
  assert.equal(calls,1);assert.ok(cleaned);assert.equal(result.status,'done');assert.equal(result.action,'beauty');
  assert.equal(result.contentIndex.category,'beauty');assert.match(result.messages.join('\n'),/가상 크림|광고·협찬/);
  assert.doesNotMatch(result.messages.join('\n'),/invented|javascript/);
  const state=createSupabaseState({url:'https://x.supabase.co',key:'sb_secret_test',fetchImpl:async(_url,init)=>{
    body=JSON.parse(init.body);return Response.json([{id:53}]);}});
  assert.deepEqual(await state.saveFactCheck('123',result),{id:53});
  assert.equal(body.topic,'beauty');assert.equal(body.verdict,null);assert.equal(JSON.parse(body.reason).beauty.version,1);
  const item=factcheckToItem({id:53,created_at:new Date().toISOString(),...body});
  assert.equal(item.type,'beauty');assert.equal(item.title,'가상 크림');
  assert.equal(item.origin,'https://www.instagram.com/p/BeautyExample/');assert.equal(item.phase,'협찬 표시 있음');
});

test('beauty analysis handles wrong categories, missing media and model failures without saving a successful result',async()=>{
  const make=reply=>createBeautyProcessor({model:async()=>reply});
  assert.equal((await make('{"is_beauty":false}')({text:'뉴스'})).status,'not_checkable');
  assert.equal((await make('invalid')({text:source})).status,'failed');
  assert.equal((await make('{}')({})).status,'no_input');
  const result=await make('{}')({attachments:[{type:'image',payload:{url:'https://cdn.example/x.jpg'}}]},
    {fetchMedia:async()=>{throw new Error('private provider failure');}});
  assert.equal(result.status,'no_input');assert.doesNotMatch(result.messages.join(''),/private provider/);
  const state=createSupabaseState({url:'https://x.supabase.co',key:'sb_secret_test',fetchImpl:()=>assert.fail('Failed results must not be saved')});
  assert.equal(await state.saveFactCheck('123',result),null);
  await assert.rejects(state.saveFactCheck('123',{status:'done',action:'beauty',beauty:{}}),/Invalid beauty/);
});
