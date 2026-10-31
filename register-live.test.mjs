import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { withGoogleSignup, loginThenDashboard, preferLiveDashboard, DASHBOARD_MODE_KEY } from './public/js/register-live.js';

// The supplied signup logic, run exactly as in onboarding-frontend.test.mjs, with controllable timers.
function designModel() {
  const timers = new Map(); let id = 0;
  class Base {
    constructor(props) { this.props = props; }
    setState(update) { this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) }; }
  }
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync('frontend/register/Signup.dc.html', 'utf8'))[1];
  const RegisterModel = runInNewContext(script + '\nComponent', { DCLogic: Base,
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key),
    setInterval:()=>1, clearInterval(){}, addEventListener(){}, removeEventListener(){},
    localStorage:{setItem:(k,v)=>globalThis.localStorage?.setItem(k,v)} });
  const flush = () => { let steps = 0; while (timers.size) {
    assert.ok(steps++ < 80, 'Animation timers must settle'); const [key, fn] = timers.entries().next().value; timers.delete(key); fn();
  } };
  return { RegisterModel, flush };
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function fakeAuth({ user = null, inApp = false } = {}) {
  const calls = [];
  return { calls, fetchImpl:async()=>Response.json({status:'linked',username:'gong.zip.hab'}), auth: {
    currentUser: async () => user, inAppBrowser: () => inApp,
    signInWithGoogle: async next => { calls.push(['signIn', next]); return { error: null }; },
    supabase: { auth: { getSession:async()=>({data:{session:{access_token:'test-session-token'}}}),
      updateUser: async payload => { calls.push(['updateUser', payload]); return { error: null }; } } },
  } };
}

test('signed-out visitors start the supplied chat and the Google button starts a real sign-in back to /register', async () => {
  const { RegisterModel, flush } = designModel();
  const { auth, calls } = fakeAuth();
  const c = new (withGoogleSignup(RegisterModel, async () => auth))({});
  c.componentDidMount(); await tick(); flush();
  assert.ok(c.renderVals().showGoogle);
  await c.renderVals().googleLogin(); await tick();
  assert.deepEqual(calls, [['signIn', '/register']]);
  assert.equal(c.state.step, 'googleBusy');
  assert.ok(!c.state.msgs.some(m => /jimin@example\.com/.test(m.text)), 'no simulated login message');
});

test('returning with verified Instagram proof resumes at name with the real email and Google name, then saves the profile', async () => {
  const { RegisterModel, flush } = designModel();
  const user = { email: 'me@example.org', user_metadata: { full_name: '배지원' } };
  const { auth, calls, fetchImpl } = fakeAuth({ user });
  const storage = new Map(); globalThis.localStorage = { setItem: (k, v) => storage.set(k, v) };
  try {
    const c = new (withGoogleSignup(RegisterModel, async () => auth, fetchImpl))({});
    c.componentDidMount(); await tick(); flush();
    assert.ok(c.renderVals().showName);
    assert.equal(c.state.nameDraft, '배지원');
    assert.ok(c.state.msgs.some(m => m.from === 'me' && m.text === 'Google 계정으로 로그인했어요 · me@example.org'));
    c.renderVals().onName({ target: { value: '지원' } }); c.submitName(); flush();
    c.renderVals().onAge({ target: { value: '23' } }); c.submitAge(); await tick(); flush();
    assert.ok(c.renderVals().showDone);
    assert.deepEqual(calls, [['updateUser', { data: { display_name: '지원', age: 23 } }]]);
    assert.equal(storage.get(DASHBOARD_MODE_KEY), '"live"', 'the dashboard opens on real data');
    // "다시 시작" keeps the signed-in session and asks for the name again.
    c.renderVals().restart(); await tick(); flush();
    assert.ok(c.renderVals().showName); assert.equal(c.state.name, '');
  } finally { delete globalThis.localStorage; }
});

test('skipping age saves only the name, and in-app browsers are told to open an external browser', async () => {
  const { RegisterModel, flush } = designModel();
  const { auth, calls, fetchImpl } = fakeAuth({ user: { email: 'a@b.c', user_metadata: {} } });
  const c = new (withGoogleSignup(RegisterModel, async () => auth, fetchImpl))({});
  c.componentDidMount(); await tick(); flush();
  c.renderVals().onName({ target: { value: '지원' } }); c.submitName(); flush(); c.skipAge(); await tick(); flush();
  assert.deepEqual(calls, [['updateUser', { data: { display_name: '지원' } }]]);

  const inApp = fakeAuth({ inApp: true });
  const d = new (withGoogleSignup(designModel().RegisterModel, async () => inApp.auth))({});
  d.state.step = 'google'; d.auth = inApp.auth;
  await d.googleLogin();
  assert.deepEqual(inApp.calls, [], 'no sign-in attempt inside the Instagram webview');
});

test('landing "로그인" signs in first, or goes straight to the dashboard when already signed in', async () => {
  const visited = []; const location = { assign: path => visited.push(path) };
  const signedOut = fakeAuth();
  await loginThenDashboard(async () => signedOut.auth, location);
  assert.deepEqual(signedOut.calls, [['signIn', '/dashboard']]); assert.deepEqual(visited, []);
  const signedIn = fakeAuth({ user: { email: 'a@b.c' } });
  await loginThenDashboard(async () => signedIn.auth, location);
  assert.deepEqual(signedIn.calls, []); assert.deepEqual(visited, ['/dashboard']);
  await loginThenDashboard(async () => { throw new Error('CDN down'); }, location);
  assert.deepEqual(visited, ['/dashboard', '/dashboard'], 'falls back to the dashboard if auth cannot load');
  assert.doesNotThrow(() => preferLiveDashboard(undefined));
});
