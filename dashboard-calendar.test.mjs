import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCalendarDashboard, calendarContent, validCalendarDate } from './public/js/dashboard-calendar.js';

const now = () => new Date(2026, 10, 1, 10);
const recipe = { id:'fc1',type:'recipe',status:'done',title:'오늘의 요리',key:'재료 2개',ingredients:[{name:'면',qty:'1인분'}] };
const exhibit = { id:'fc9-2',type:'exhibit',status:'done',title:'두 번째 전시',exhibitEvent:{start:'2026-11-04',end:'2026-11-12'} };
function fixture(saved = new Map()) {
  const messages=[];
  const app={state:{mode:'live',user:{id:'member-a'}},allItems:()=>[recipe,exhibit],
    setState:patch=>Object.assign(app.state,patch),toast:msg=>messages.push(msg),openDetail:id=>messages.push(id)};
  const storage={getItem:key=>saved.get(key),setItem:(key,value)=>saved.set(key,value)};
  return {app,saved,messages,storage,calendar:createCalendarDashboard(app,storage,now)};
}
function draft(calendar,date='2026-11-07') {
  calendar.values().openAddSel(); calendar.values().contentOpts[0].pick();
  calendar.model.setDraft({date,mini:date.slice(0,7)+'-01',time:'18:30'});
}
test('calendar uses owned content IDs and saves, reloads, edits and removes local schedules per member',()=>{
  const {app,saved,storage,calendar}=fixture();
  assert.equal(calendar.values().filters[0].count,0);
  draft(calendar); assert.equal(calendar.values().dmUnavailable,true);
  assert.ok(calendar.values().remOpts.every(option=>option.disabled));
  calendar.values().save();
  assert.equal(calendar.values().filters[0].count,1);
  assert.match(calendar.values().selEvents[0].title,/오늘의 요리/);
  const stored=JSON.parse([...saved.values()][0]);
  assert.equal(stored[0].item,'fc1'); assert.equal(stored[0].dm,false); assert.deepEqual(stored[0].rem,[]);
  const reloaded=createCalendarDashboard(app,storage,now);
  reloaded.values(); reloaded.model.openModal({id:1}); reloaded.model.setDraft({time:'19:20'}); reloaded.values().save();
  assert.equal(reloaded.values().selEvents[0].timeLabel,'19:20');
  app.state.user.id='member-b'; assert.equal(reloaded.values().filters[0].count,0);
  app.state.user.id='member-a'; reloaded.values(); reloaded.model.setState({sel:'2026-11-07'});
  reloaded.values().selEvents[0].remove(); assert.equal(reloaded.values().filters[0].count,0);
  assert.equal(JSON.parse(saved.get('dimi-calendar:v1:member-a')).length,0);
  assert.equal(createCalendarDashboard(app,storage,()=>new Date(2027,0,8,10)).values().title,'2027년 1월');
});
test('calendar rejects invalid dates/times and out-of-period visits without claiming a save',()=>{
  const {calendar,messages}=fixture();
  assert.equal(validCalendarDate('2026-02-30'),false); assert.equal(validCalendarDate('2028-02-29'),true);
  draft(calendar,'2026-02-30'); calendar.values().save(); assert.equal(calendar.values().filters[0].count,0);
  calendar.model.setDraft({date:'2026-11-07',time:'25:10'}); calendar.values().save(); assert.equal(calendar.values().filters[0].count,0);
  calendar.values().contentOpts[1].pick(); calendar.model.setDraft({date:'2026-11-15'});
  assert.equal(calendar.values().saveDisabled,true); calendar.values().save(); assert.equal(calendar.values().filters[0].count,0);
  assert.ok(messages.every(msg=>!msg.includes('등록했어요')));
});
test('unavailable content is omitted, fixed contest facts stay locked and no dates are invented',()=>{
  const {app,calendar}=fixture();
  assert.equal(calendarContent(recipe).from,undefined);
  app.allItems=()=>[{...recipe,type:'contest',contestEvents:[{type:'deadline',date:'2026-11-09',time:'18:00'}]}];
  calendar.values().openAddSel(); calendar.values().contentOpts[0].pick();
  assert.equal(calendar.values().dateLocked,true); calendar.model.setDraft({date:'2026-11-10'});
  calendar.values().save(); assert.equal(calendar.values().filters[0].count,0);
  calendar.model.setDraft({date:'2026-11-09'}); calendar.values().save(); assert.equal(calendar.values().filters[0].count,1);
  app.allItems=()=>[]; assert.equal(calendar.values().filters[0].count,0);
  assert.equal(calendar.values().upcoming.length,0);
});

test('restaurant and space visits save, reload, filter and open the exact content without invented restrictions',()=>{
  const {app,calendar,storage,messages}=fixture();
  app.allItems=()=>[
    {...recipe,type:'restaurant',id:'fc12-2',title:'두 번째 맛집',address:'서울 성동구',priceRange:'1만 원대'},
    {...recipe,type:'space',id:'fc15',title:'서점',address:'서울 마포구'},
    {...recipe,type:'news',id:'fc16'},
  ];
  let v=calendar.values();
  assert.deepEqual(v.filters.map(f=>f.label),['전체','레시피','전시·팝업','공모전·대외활동','맛집','취향공간']);
  v.openAddSel(); calendar.values().contentOpts[0].pick();
  assert.equal(calendar.model.state.modal.kind,'visit');
  calendar.model.setDraft({date:'2026-11-07',time:'12:00'}); calendar.values().save();
  calendar.values().openAddSel(); calendar.values().contentOpts[1].pick();
  calendar.model.setDraft({date:'2026-11-07',allDay:true}); calendar.values().save();
  const reloaded=createCalendarDashboard(app,storage,now);
  v=reloaded.values();
  assert.equal(v.contentOpts.length,0);
  assert.equal(reloaded.model.consts().CONTENT.fc16,undefined);
  assert.equal(reloaded.model.consts().CONTENT.fc15.from,undefined);
  assert.equal(v.filters[0].count,2); assert.equal(v.filters[4].count,1); assert.equal(v.filters[5].count,1);
  reloaded.model.setState({sel:'2026-11-07'});
  reloaded.values().filters[4].toggle();
  assert.deepEqual(reloaded.values().selEvents.map(e=>e.title),['두 번째 맛집']);
  reloaded.values().selEvents[0].view();
  assert.equal(reloaded.values().cvType,'맛집');
  assert.ok(reloaded.values().cvFacts.some(f=>f.k==='가격대' && f.v==='1만 원대'));
  reloaded.values().openFullContent();
  assert.equal(messages.at(-1),'fc12-2');
  reloaded.values().filters[5].toggle();
  assert.deepEqual(reloaded.values().selEvents.map(e=>e.title),['서점']);
  assert.equal(reloaded.values().selEvents[0].timeLabel,'종일');
  reloaded.values().filters[0].toggle();
  assert.equal(reloaded.values().selEvents.length,2);
});
test('storage failures keep the draft and do not report success, corrupt data never renders sample events',()=>{
  const {app,messages}=fixture();
  const calendar=createCalendarDashboard(app,{getItem:()=>'{broken',setItem:()=>{throw Error('quota');}},now);
  assert.match(calendar.values().storageNote,/못했어요/); assert.equal(calendar.values().filters[0].count,0);
  draft(calendar); calendar.values().save();
  assert.equal(calendar.values().modalOpen,true); assert.equal(calendar.values().filters[0].count,0);
  assert.ok(messages.some(msg=>msg.includes('저장하지 못했어요'))); assert.ok(!messages.some(msg=>msg.includes('등록했어요')));
  assert.match(createCalendarDashboard(app,null,now).values().storageNote,/못했어요/);
});

test('the mobile calendar shares stored schedules and actions with desktop and renders date dots and sheets',()=>{
  const {calendar,messages}=fixture();
  draft(calendar); calendar.values().save();
  const mobile=calendar.values(true);
  const day=mobile.cells.find(c=>c.aria.startsWith('11월 7일'));
  assert.match(day.cls,/^mday/); assert.deepEqual(day.dots,[{cls:'dot t-recipe'}]);
  assert.equal(mobile.selCount,'일정 1개');
  assert.equal(mobile.selEvents[0].orb,'orb o-recipe');
  mobile.selEvents[0].view();
  assert.match(calendar.values(true).cvEvents[0].cls,/^cvev/);
  calendar.values(true).openFullContent(); assert.equal(messages.at(-1),'fc1');
  calendar.values(true).viewWeek();
  assert.equal(calendar.values(true).weekCols.filter(c=>c.pressed==='true').length,1);
  assert.match(calendar.values().cells[0].cls,/^mc/);
  calendar.values(true).selEvents[0].remove(); assert.equal(calendar.values().filters[0].count,0);
});
