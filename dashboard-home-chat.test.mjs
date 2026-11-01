import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeChat } from './public/js/dashboard-home-chat.js';

const now = Date.parse('2026-11-01T12:00:00+09:00');
function fixture() {
  const items = [
    { id:'fc1',type:'recipe',status:'done',title:'매콤한 우동',summary:'간단한 면 요리',ingredients:[{name:'우동'}],ts:now,origin:'https://www.instagram.com/reel/abc/' },
    { id:'fc2-2',type:'space',status:'done',title:'조용한 서점',address:'서울시',ts:now-86400000 },
    { id:'fc3',type:'news',status:'done',title:'뉴스',ts:now },
    { id:'fc4',type:'recipe',status:'failed',title:'실패',ts:now },
    { id:'fc5',type:'contest',status:'done',title:'공모전',ts:now,contestEvents:[{type:'deadline',date:'2026-11-03',time:'18:00'}] },
    { id:'fc6',type:'contest',status:'done',title:'기한 미확인',ts:now },
    { id:'fc7',type:'beauty',status:'done',title:'진정 토너',ts:now,origin:'javascript:alert(1)' },
  ];
  const calls=[];
  const app={state:{mode:'live',user:{id:'member-a'},account:'@mine',name:'현재 사용자',connected:true,taste:{'fc2-2':true}},allItems:()=>items,
    setState(patch,callback){Object.assign(this.state,patch);callback?.();}, indexRequest:async(...args)=>{calls.push(args);return{ids:['fc1']};},
    go:view=>calls.push(['go',view]),openDetail:id=>calls.push(['open',id])};
  const chat=createHomeChat(app,{now:()=>now});
  const ask=async text=>{chat.values().onChange({target:{value:text}});await chat.values().submit({preventDefault(){}});return chat.values();};
  return{app,chat,items,calls,ask};
}
test('home typing is local; owned child cards open the exact full result, without fake source links',()=>{
  const {chat,calls}=fixture();
  assert.match(chat.values().greeting,/현재 사용자/);
  chat.values().onChange({target:{value:'서점'}});
  assert.deepEqual(chat.values().sug.map(item=>item.id),['fc2-2']);assert.equal(calls.length,0);
  chat.values().sug[0].open();let v=chat.values();assert.equal(v.drawerOpen,true);assert.equal(v.d.hasOrigin,false);
  v.d.openFull();assert.deepEqual(calls,[['open','fc2-2']]);
  assert.equal(chat.escape(),true);assert.equal(chat.values().drawerOpen,false);
  chat.values().recent.find(item=>item.id==='fc7').open();assert.equal(chat.values().d.hasOrigin,false);
});
test('explicit search calls existing API once, intersects owned typed IDs and de-duplicates',async()=>{
  const {app,chat,calls,ask}=fixture();
  app.indexRequest=async(body)=>{calls.push(body);return{ids:['foreign','fc2-2','fc1','fc1','fc4']};};
  const v=await ask('매콤한 레시피 찾아줘');
  assert.equal(calls.length,1);assert.deepEqual(v.msgs[1].results.map(item=>item.id),['fc1']);
  v.msgs[1].results[0].open();assert.equal(chat.values().d.hasOrigin,true);
  assert.ok(chat.values().d.facts.some(f=>f.v==='우동'));
});
test('type, recent, manual taste and confirmed deadline shortcuts need no remote search',async()=>{
  const {calls,ask,chat}=fixture();
  let v=await ask('내 취향 모음');assert.deepEqual(v.msgs.at(-1).results.map(item=>item.id),['fc2-2']);
  v=await ask('마감 임박 공모전');assert.deepEqual(v.msgs.at(-1).results.map(item=>item.id),['fc5']);
  v=await ask('이번 주 보낸 것 보여줘');assert.ok(v.msgs.at(-1).results.length);assert.equal(calls.length,0);
  v=await ask('취향공간 보여줘');assert.deepEqual(v.msgs.at(-1).results.map(item=>item.id),['fc2-2']);
  chat.reset();assert.equal(chat.values().empty,true);
});
test('failed search falls back to local results; account changes discard stale replies and drawer state',async()=>{
  const {app,chat,ask}=fixture();
  app.indexRequest=async()=>{throw new Error('offline');};
  let v=await ask('매콤한 레시피');assert.equal(v.msgs[1].fallback,true);assert.equal(v.msgs[1].results[0].id,'fc1');
  let finish;app.indexRequest=()=>new Promise(resolve=>{finish=resolve;});
  const pending=ask('매콤한 레시피');assert.equal(chat.values().sendDisabled,true);
  const count=chat.values().msgs.length;await ask('매콤한 레시피');assert.equal(chat.values().msgs.length,count);
  app.state.user={id:'member-b'};app.allItems=()=>[];v=chat.values();assert.equal(v.empty,true);assert.equal(v.drawerOpen,false);
  finish({ids:['fc1']});await pending;assert.equal(chat.values().empty,true);assert.deepEqual(chat.values().recent,[]);
});
