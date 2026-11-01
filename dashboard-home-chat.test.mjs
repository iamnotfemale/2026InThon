import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHomeChat } from './public/js/dashboard-home-chat.js';

const now = Date.parse('2026-11-01T12:00:00+09:00');
function fixture(options = {}) {
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
    chatRequest:async(...args)=>{calls.push(args);return{reply:'디미가 찾은 콘텐츠예요.',ids:['fc1']};},
    go(view,extra){this.state.view=view;Object.assign(this.state,extra);},openDetail:id=>calls.push(['open',id])};
  const chat=createHomeChat(app,{now:()=>now,pause:async()=>{},...options});
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
  assert.equal(chat.values().drawerOpen,false);assert.equal(chat.escape(),false);
  chat.values().recent.find(item=>item.id==='fc7').open();assert.equal(chat.values().d.hasOrigin,false);
});
test('free text calls chat once and filters unknown/failed IDs without forcing keyword categories',async()=>{
  const {app,chat,calls,ask}=fixture();
  app.chatRequest=async(body)=>{calls.push(body);return{reply:'찾아봤어요.',ids:['foreign','fc1','fc1','fc4']};};
  const v=await ask('매콤한 레시피 찾아줘');
  assert.equal(calls.length,1);assert.deepEqual(v.msgs[1].results.map(item=>item.id),['fc1']);
  v.msgs[1].results[0].open();assert.equal(chat.values().d.hasOrigin,true);
  assert.ok(chat.values().d.facts.some(f=>f.v==='우동'));
});
test('type, recent, manual taste and confirmed deadline shortcuts need no remote search',async()=>{
  const {calls,ask,chat}=fixture();
  await chat.values().quick.find(q=>q.label==='내 취향 모음').pick();let v=chat.values();assert.deepEqual(v.msgs.at(-1).results.map(item=>item.id),['fc2-2']);
  await chat.values().quick.find(q=>q.label==='마감 임박 공모전').pick();v=chat.values();assert.deepEqual(v.msgs.at(-1).results.map(item=>item.id),['fc5']);
  await chat.values().quick.find(q=>q.label==='이번 주 보낸 것').pick();v=chat.values();assert.ok(v.msgs.at(-1).results.length);assert.equal(calls.length,0);
  chat.reset();assert.equal(chat.values().empty,true);
});
test('failed search falls back to local results; account changes discard stale replies and drawer state',async()=>{
  const {app,chat,ask}=fixture();
  app.chatRequest=async()=>{throw new Error('offline');};
  let v=await ask('매콤한 레시피');assert.equal(v.msgs[1].fallback,true);assert.equal(v.msgs[1].results[0].id,'fc1');
  let finish;app.chatRequest=()=>new Promise(resolve=>{finish=resolve;});
  const pending=ask('매콤한 레시피');assert.equal(chat.values().sendDisabled,true);
  const count=chat.values().msgs.length;await ask('매콤한 레시피');assert.equal(chat.values().msgs.length,count);
  app.state.user={id:'member-b'};app.allItems=()=>[];v=chat.values();assert.equal(v.empty,true);assert.equal(v.drawerOpen,false);
  finish({reply:'늦은 답변',ids:['fc1']});await pending;assert.equal(chat.values().empty,true);assert.deepEqual(chat.values().recent,[]);
});


test('buttons hold typing for1500ms, block double clicks, and reset cancels the pending UI',async()=>{
  let done; const durations=[];
  const {chat,calls}=fixture({pause:ms=>{durations.push(ms);return new Promise(resolve=>{done=resolve;});}});
  const pending=chat.values().quick.find(q=>q.label==='내 취향 모음').pick();
  assert.equal(chat.values().msgs.at(-1).typing,true);assert.equal(chat.values().sendDisabled,true);
  await chat.values().quick[0].pick();assert.equal(chat.values().msgs.length,2);
  assert.deepEqual(durations,[1500]);assert.equal(calls.length,0);
  done();await pending;assert.equal(chat.values().msgs.at(-1).typing,false);
  const again=chat.values().quick[0].pick();chat.reset();done();await again;assert.equal(chat.values().empty,true);
});

test('general chat works with an empty library, remembers replies and passes a focused owned card',async()=>{
  const {app,chat,ask,calls}=fixture();
  app.chatRequest=async(body)=>{calls.push(body);return{reply:'안녕, 디미예요!',ids:[]};};
  await ask('안녕');assert.equal(chat.values().msgs.at(-1).text,'안녕, 디미예요!');
  chat.values().recent[0].open();await ask('그 콘텐츠 설명해줘');
  assert.equal(calls[1].history[1].text,'안녕, 디미예요!');assert.equal(calls[1].focusedId,'fc1');
  app.allItems=()=>[];app.state.libError=true;
  await ask('너 뭐 할 수 있어?');assert.equal(chat.values().msgs.at(-1).hasRes,false);
  assert.equal(chat.values().inputDisabled,false);assert.equal(calls.length,3);
});


test('home keeps the start screen while chat resumes its existing conversation',async()=>{
  const {app,chat,ask}=fixture(); app.state.homeChatActive=false;
  await ask('안녕');assert.equal(app.state.view,'home');assert.equal(app.state.homeChatActive,true);
  assert.equal(chat.values().chatting,true);
  app.state.homeChatActive=false;assert.equal(chat.values().empty,true);assert.equal(chat.values().chatting,false);
  app.state.homeChatActive=true;assert.equal(chat.values().msgs.length,2);assert.equal(chat.values().chatting,true);
});
