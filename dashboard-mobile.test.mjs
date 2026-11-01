import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import DashboardModel from './public/js/dashboard-model.js';
import { createMobileDashboard } from './public/js/dashboard-mobile.js';

function fixture() {
  const app = new DashboardModel({ theme: 'light' });
  app.setState = update => Object.assign(app.state, typeof update === 'function' ? update(app.state) : update);
  app.state.mode = 'live';
  app.pageValues = () => ({ schedule: [], hasSchedule: false });
  const calls = [];
  app.toast = () => {};
  for (const method of ['changeDelivery', 'removeItem', 'enterLive', 'loadLive', 'openBotDm', 'checkLink', 'copy', 'signOut']) {
    app[method] = (...args) => calls.push([method, ...args]);
  }
  return {app, values:createMobileDashboard(app), calls};
}

test('mobile uses the current account and existing routes, never the prototype identity', () => {
  const {app, values} = fixture();
  Object.assign(app.state, {name:'현재사용자',email:'current@example.test',account:'@current.handle',connectedAt:'현재 시각'});
  let v = values();
  assert.equal(v.profileName, '현재사용자'); assert.equal(v.profileHandle, '@current.handle');
  assert.equal(v.profileEmail, 'current@example.test · Google'); assert.equal(v.modeLabel, '내 데이터');
  assert.deepEqual(v.schedule, []); assert.equal(v.tasteShowCard, false);
  v.goLibrary(); assert.equal(app.state.view, 'library');
  v = values(); v.libItems[0].open(); assert.equal(app.state.view, 'detail');
  v = values(); assert.ok(v.hasDetail); v.closeDetail(); assert.equal(app.state.view, 'library');
  v.openSettings(); assert.equal(app.state.view, 'settings');
  assert.equal(values().settingsOpen, true); values().closeSettings(); assert.equal(app.state.view, 'library');
  app.state.view='calendar'; values().openSettings(); values().closeSettings(); assert.equal(app.state.view,'calendar');
});

test('mobile taste uses a category dropdown, filters the saved list and opens a row directly', () => {
  const { app, values } = fixture();
  const items = [{ id: 'fc1', type: 'recipe', status: 'done', title: '요리' }, { id: 'fc2', type: 'exhibit', status: 'done', title: '전시' },
    { id: 'fc3', type: 'space', status: 'done', title: '서점' }];
  app.allItems = () => items;
  Object.assign(app.state, { view: 'taste', taste: { fc1: true, fc2: true, fc3: true }, tasteTab: 'all' });
  assert.equal(values().tasteFilter, 'all');
  assert.deepEqual(values().tasteTabs.map(t => [t.value, t.count]), [['all', 3], ['recipe', 1], ['exhibit', 2], ['contest', 0], ['restaurant', 0]]);
  assert.deepEqual(values().tasteGroups.map(g => g.type), ['recipe', 'exhibit']);
  assert.ok(values().tasteGroups.every(g => !g.label.includes('궤도')));
  values().filterTaste({ currentTarget: { value: 'contest' } });
  assert.deepEqual(values().tasteGroups, []);
  values().filterTaste({ currentTarget: { value: 'exhibit' } });
  assert.equal(values().tasteFilter, 'exhibit');
  assert.deepEqual(values().tasteGroups.map(g => g.type), ['exhibit']);
  assert.deepEqual(values().tasteGroups[0].items.map(i => i.id), ['fc2', 'fc3']);
  values().tasteGroups[0].items[0].open(); assert.equal(app.state.view, 'detail'); assert.equal(app.state.detailId, 'fc2');
  app.state.taste = {};
  assert.deepEqual(values().tasteGroups, []); assert.equal(values().tasteNone, true);
  const template = readFileSync('public/data/mobile-template.json', 'utf8');
  assert.doesNotMatch(template, /궤도|mo-stage|tasteOrbits|tasteSelection/);
  assert.match(template, /mobile-taste-filter/); assert.match(template, /\{\{ti.open\}\}/);
});

test('mobile home keeps the shared calendar schedule and its date-navigation action', () => {
  const { app, values, calls } = fixture();
  const schedule = [{ id: 'saved-event', title: '내가 등록한 요리', mon: '11월', day: '02', what: '요리할 날 · 18:30 KST',
    badge: 'D-1', open: () => calls.push(['calendar', '2026-11-02']) }];
  app.pageValues = () => ({ schedule, hasSchedule: true, scheduleNote: '캘린더에 등록한 일정이에요.' });
  const v = values();
  assert.equal(v.schedule, schedule); assert.equal(v.hasSchedule, true); assert.match(v.scheduleNote, /캘린더/);
  v.schedule[0].open(); assert.deepEqual(calls, [['calendar', '2026-11-02']]);
});

test('mobile recipes use shared ingredients, cooking state and validated timer parsing', () => {
  const {app, values} = fixture();
  Object.assign(app.state,{view:'detail',detailId:'r1'});
  let v = values(); assert.equal(v.d.isRecipe,true); assert.ok(v.d.ingredients.length);
  v.d.ingredients[0].toggle(); v=values(); assert.equal(v.d.ingredients[0].checked,true);
  v.startCook(); v=values(); assert.equal(v.cookOpen,true); assert.equal(v.cookPrep,true);
  v.cookNext(); assert.equal(app.state.cook.stage,'step');
  assert.equal(app.secsOf('3~5분'),0); assert.equal(app.secsOf('1분 30초'),90);
});

test('mobile contest and restaurant details can be collected into taste without admitting news',()=>{
  const {app,values}=fixture();
  for(const id of ['c1','m1']){
    Object.assign(app.state,{view:'detail',detailId:id});
    assert.equal(values().d.showExtraTasteAction,true);
    const before=!!app.state.taste[id];
    values().d.toggleTaste(); assert.equal(app.state.taste[id],!before);
  }
  app.state.detailId='n1'; assert.equal(values().d.showExtraTasteAction,false);
});

test('mobile fact-check sources preserve long titles and show a safe empty-source state',()=>{
  const {app,values}=fixture();
  const news=app.allItems().find(item=>item.id==='n1');
  app.allItems=()=>[news];
  news.sources=[{title:'긴 근거 제목 '.repeat(30),org:'',date:'',url:'https://example.test/evidence'}];
  Object.assign(app.state,{view:'detail',detailId:'n1'});
  assert.equal(values().d.sources[0].title,news.sources[0].title);
  assert.equal(values().d.sources[0].href,'https://example.test/evidence');
  assert.equal(values().d.sources[0].ini,'출'); assert.equal(values().d.noSources,false);
  assert.equal(values().d.hasComparisons,false);
  news.sources=[]; assert.equal(values().d.noSources,true);
});

test('mobile delivery, deletion and login call the real existing actions', () => {
  const {app,values,calls}=fixture();
  Object.assign(app.state,{view:'detail',detailId:'n1'});
  const v=values(); v.dmModes[1].pick(); v.removeCurrent(); v.logout(); v.sendFromIg(); v.toggleDataMode();
  assert.deepEqual(calls,[['changeDelivery','full'],['removeItem','n1'],['signOut'],['openBotDm'],['loadLive']]);
  app.state.mode='demo'; values().toggleDataMode(); assert.equal(calls.at(-1)[0],'enterLive');
});

test('mobile filter chips, ordering and reset preserve one shared library state',()=>{
  const {app,values}=fixture();
  app.state.view='library';
  values().typeChips.find(c=>c.label==='미용').pick();assert.equal(values().libCount,2);
  values().toggleFavOnly();assert.equal(values().libCount,0);
  values().resetFilters();assert.equal(app.state.favOnly,false);assert.ok(values().libCount>2);
  values().toggleSort();assert.equal(app.state.sort,'old');
  values().statusChips.find(c=>c.label==='정리 완료').pick();
  assert.ok(values().libItems.every(item=>item.status==='done'));
});

test('mobile markup fills the viewport and binds account labels instead of sample text', () => {
  const template=readFileSync('public/data/mobile-template.json','utf8');
  assert.match(template,/height: 100dvh/); assert.doesNotMatch(template,/jimin@example|@jimin.daily|inthon2team|서비스명/);
  assert.match(readFileSync('public/js/dashboard-mobile.js','utf8'),/dimi_in/);
  assert.match(template,/profileHandle/); assert.match(template,/내 목록에서 삭제/);
  const html=readFileSync('public/dashboard.html','utf8');
  assert.match(html,/mobile\.css[^>]+max-width: 767px/);
  assert.match(readFileSync('public/css/mobile.css','utf8'),/\.m \.btn-primary:hover\{background:var\(--accent\)/);
});
