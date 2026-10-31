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
test('storage failures keep the draft and do not report success, corrupt data never renders sample events',()=>{
  const {app,messages}=fixture();
  const calendar=createCalendarDashboard(app,{getItem:()=>'{broken',setItem:()=>{throw Error('quota');}},now);
  assert.match(calendar.values().storageNote,/못했어요/); assert.equal(calendar.values().filters[0].count,0);
  draft(calendar); calendar.values().save();
  assert.equal(calendar.values().modalOpen,true); assert.equal(calendar.values().filters[0].count,0);
  assert.ok(messages.some(msg=>msg.includes('저장하지 못했어요'))); assert.ok(!messages.some(msg=>msg.includes('등록했어요')));
  assert.match(createCalendarDashboard(app,null,now).values().storageNote,/못했어요/);
});
