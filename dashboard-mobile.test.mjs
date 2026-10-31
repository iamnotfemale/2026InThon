import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import DashboardModel from './public/js/dashboard-model.js';
import { createMobileDashboard } from './public/js/dashboard-mobile.js';

function fixture() {
  const app = new DashboardModel({ theme: 'light' });
  app.setState = update => Object.assign(app.state, typeof update === 'function' ? update(app.state) : update);
  app.state.mode = 'live';
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

test('mobile markup fills the viewport and binds account labels instead of sample text', () => {
  const template=readFileSync('public/data/mobile-template.json','utf8');
  assert.match(template,/height: 100dvh/); assert.doesNotMatch(template,/jimin@example|@jimin.daily|inthon2team|서비스명/);
  assert.match(readFileSync('public/js/dashboard-mobile.js','utf8'),/dimi_in/);
  assert.match(template,/profileHandle/); assert.match(template,/내 목록에서 삭제/);
  const html=readFileSync('public/dashboard.html','utf8');
  assert.match(html,/mobile\.css[^>]+max-width: 767px/);
  assert.match(readFileSync('public/css/mobile.css','utf8'),/\.m \.btn-primary:hover\{background:var\(--accent\)/);
});
