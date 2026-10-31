import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

async function model(loggedIn = true) {
  const timers = new Map(); const intervals = new Map(); let id = 0; let state = {status:'none'}; const profiles = [];
  class Base {
    constructor(props) { this.props = props; }
    setState(update) { this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) }; }
  }
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync('frontend/register/Signup.dc.html', 'utf8'))[1];
  const services = { user:async()=>loggedIn?{id:'user'}:null, login:async()=>{}, issue:async username=>({code:'AB12CD',username:username.replace(/^@/, '')}),
    status:async()=>state, profile:async(name,age)=>profiles.push({name,age}), copy:async()=>{} };
  const component = runInNewContext(script + '\nnew Component({services})', { DCLogic: Base, services,
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
    setInterval:fn=>{intervals.set(++id,fn);return id;},clearInterval:key=>intervals.delete(key),localStorage:{setItem(){}} });
  const flush = () => { let steps = 0; while (timers.size) {
    assert.ok(steps++ < 50, 'Animation timers must settle'); const [key, fn] = timers.entries().next().value; timers.delete(key); fn();
  } };
  await component.start(); flush();
  return { component, flush, services, profiles, intervals, status:value=>{state=value;} };
}

test('real onboarding gates name/age behind server-confirmed Instagram verification and keeps keyboard submission', async () => {
  const f = await model(); const {component:c,flush}=f;
  assert.ok(c.renderVals().showInstagram); assert.equal(c.renderVals().stepBars.length,4);
  c.renderVals().onHandle({target:{value:'@gong.zip.hab'}}); await c.issueCode();
  assert.equal(c.renderVals().linkCode,'AB12CD');
  f.status({status:'pending'}); await c.checkLink(); assert.ok(!c.renderVals().showName);
  f.status({status:'linked',username:'gong.zip.hab'}); await c.checkLink(); flush();
  assert.equal(f.intervals.size,0); assert.ok(c.renderVals().showName);
  assert.ok(c.renderVals().nameDisabled);
  c.renderVals().onName({ target: { value: '테스트' } });
  c.renderVals().onNameKey({ key: 'Enter', isComposing: true, preventDefault: () => assert.fail() });
  assert.equal(c.state.step, 'name');
  c.renderVals().onNameKey({ key: 'Enter', preventDefault() {} }); flush();
  assert.ok(c.renderVals().showAge);
  c.renderVals().onAge({ target: { value: '0' } }); c.renderVals().submitAge(); assert.ok(c.renderVals().ageError);
  c.renderVals().onAge({ target: { value: '23' } }); c.renderVals().onAgeKey({ key: 'Enter', preventDefault() {} }); await new Promise(setImmediate); flush();
  assert.ok(c.renderVals().showDone); assert.equal(c.state.name, '테스트'); assert.equal(c.state.age, '23');
  assert.deepEqual(f.profiles,[{name:'테스트',age:'23'}]);
});
test('age is optional and expired verification codes return to the handle step', async () => {
  const f = await model(); const {component:c,flush}=f;
  c.state.handleDraft='gong.zip.hab'; await c.issueCode(); f.status({status:'expired'}); await c.checkLink();
  assert.equal(c.state.linkCode,''); assert.match(c.state.error,/만료/); assert.equal(f.intervals.size,0);
  await c.issueCode(); f.status({status:'linked',username:'gong.zip.hab'}); await c.checkLink(); flush();
  c.renderVals().onName({ target: { value: '테스트' } }); c.submitName(); flush(); c.skipAge(); await new Promise(setImmediate); flush();
  assert.ok(c.renderVals().showDone); assert.equal(c.state.age, '');
  assert.deepEqual(f.profiles,[{name:'테스트',age:''}]);
});
test('Google login never fabricates a user and errors stay on the login step', async () => {
  const {component:c,services,flush} = await model(false);
  assert.ok(c.renderVals().showGoogle);
  services.login=async()=>{throw new Error('로그인 실패');}; await c.googleLogin();
  assert.ok(c.renderVals().googleIdle); assert.equal(c.state.error,'로그인 실패');
  assert.ok(!c.state.msgs.some(m=>m.text.includes('jimin@example.com')));
  await c.start(); flush(); assert.equal(c.state.name,'');
});
