import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { h } from './public/js/vendor/preact.module.js';

const source = readFileSync('public/js/dashboard-app.js', 'utf8');
const classSource = source.slice(source.indexOf('class DashboardApp'), source.indexOf('const [response, mobileResponse]'));
function fixture(auth) {
  class Model { render() { return 'regular dashboard'; } }
  const App = runInNewContext(classSource + '\nDashboardApp', { DashboardModel: Model, h,
    loadSupabase: async () => auth, location: { pathname: '/items/fc15-2' }, store: { get: () => 'demo' }, MODE_KEY: 'mode' });
  const app = Object.create(App.prototype);
  app.state = { privateAuthRequired: true, privateAuthChecking: false };
  app.setState = patch => Object.assign(app.state, patch);
  return app;
}
const nodes = node => !node || typeof node !== 'object' ? [] : [node, ...[node.props?.children].flat(Infinity).flatMap(nodes)];

test('a private result has a full-page login and never mounts a modal or underlying dashboard content', () => {
  const app = fixture({});
  const tree = app.render(); const all = nodes(tree);
  assert.match(tree.props.class, /result-access-page/);
  assert.equal(all.filter(n => n.type === 'main').length, 1);
  assert.equal(all.filter(n => n.type === 'button').length, 1);
  assert.equal(all.filter(n => n.props?.role === 'dialog' || /\b(overlay|modal)\b/.test(n.props?.class || '')).length, 0);
  assert.ok(all.some(n => n.type === 'h1' && n.props.id === 'result-access-title'));
  assert.equal(all.find(n => n.type === 'button').props.disabled, undefined);
  app.state.privateAuthChecking = true;
  assert.equal(nodes(app.render()).find(n => n.type === 'button').props.disabled, true);
  app.state.privateAuthRequired = false;
  assert.equal(app.render(), 'regular dashboard');
});

test('login preserves the exact result destination, blocks double submission and exposes retryable errors', async () => {
  let release, calls = 0;
  const gate = new Promise(resolve => { release = resolve; });
  const app = fixture({ signInWithGoogle: async path => { calls++; assert.equal(path, '/items/fc15-2'); await gate; return { error: new Error('private error') }; } });
  const first = app.loginForResult();
  await app.loginForResult();
  assert.equal(app.state.privateLoginBusy, true);
  release(); await first;
  assert.equal(calls, 1); assert.equal(app.state.privateLoginBusy, false);
  const alert = nodes(app.render()).find(n => n.props?.role === 'alert');
  assert.ok(alert); assert.doesNotMatch(alert.props.children, /private error/);
});

test('session checks release the loading state; only a signed-in user bypasses the login page', async () => {
  for (const mode of ['guest', 'signed-in', 'auth-error', 'data-error']) {
    const app = fixture({ currentUser: async () => { if (mode === 'auth-error') throw new Error(); return mode === 'guest' ? null : { id: 'member' }; } });
    app.state.privateAuthChecking = true;
    app.enterLive = async () => { if (mode === 'data-error') throw new Error(); app.state.mode = 'live'; };
    await app.restoreSession();
    assert.equal(app.state.privateAuthChecking, false);
    assert.equal(app.state.privateAuthRequired, mode !== 'signed-in');
    if (mode.endsWith('error')) assert.ok(app.state.privateLoginHint);
  }
});

test('a signed-in dashboard ignores a previously selected demo mode after removing the mode menu', async () => {
  const app = fixture({ currentUser: async () => ({ id: 'member' }) });
  app.state.privateAuthRequired = false;
  let loads = 0;
  app.enterLive = async () => { loads++; app.state.mode = 'live'; };
  await app.restoreSession();
  assert.equal(loads, 1);
  assert.equal(app.state.mode, 'live');
});
