import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { deleteMemberAccount } from './account-deletion.mjs';
import { createLinkHandler } from './api/instagram-link.mjs';
import { createResultPreferences } from './result-preferences.mjs';

const UID = '11111111-2222-3333-4444-555555555555';

test('account deletion removes linked Instagram data, settings and finally the login account', async () => {
  const calls = []; const cleared = [];
  const fetchImpl = async (url, init) => {
    calls.push([init.method, url.replace('https://x.supabase.co', ''), init.headers.apikey, init.headers.Authorization]);
    if (init.method === 'GET') return Response.json([{ igsid: '123456' }]);
    return new Response(null, { status: url.includes('/auth/') ? 200 : 204 });
  };
  const result = await deleteMemberAccount({ uid: UID, supabaseUrl: 'https://x.supabase.co/', secretKey: 'sb_secret_k',
    preferences: { clear: async uid => cleared.push(uid) }, fetchImpl });
  assert.deepEqual(result, { deletedInstagramAccounts: 1 });
  assert.deepEqual(calls.map(c => c.slice(0, 2)), [
    ['GET', `/rest/v1/account_links?select=igsid&user_id=eq.${UID}`],
    ['DELETE', '/rest/v1/ig_accounts?igsid=eq.123456'],
    ['DELETE', `/auth/v1/admin/users/${UID}`],
  ]);
  assert.ok(calls.every(c => c[2] === 'sb_secret_k' && c[3] === undefined), 'secret key only in apikey');
  assert.deepEqual(cleared, [UID]);
});

test('account deletion validates input, tolerates already-deleted rows and stops on real failures', async () => {
  await assert.rejects(deleteMemberAccount({ uid: '../x', supabaseUrl: 'u', secretKey: 'k' }), /Invalid user id/);
  await assert.rejects(deleteMemberAccount({ uid: UID, supabaseUrl: '', secretKey: '' }), /not configured/);
  const gone = await deleteMemberAccount({ uid: UID, supabaseUrl: 'https://x', secretKey: 'eyJlegacy',
    fetchImpl: async (url, init) => (init.method === 'GET' ? Response.json([]) : new Response(null, { status: 404 })) });
  assert.deepEqual(gone, { deletedInstagramAccounts: 0 });
  await assert.rejects(deleteMemberAccount({ uid: UID, supabaseUrl: 'https://x', secretKey: 'k',
    fetchImpl: async () => new Response(null, { status: 500 }) }), /Account deletion failed \(GET \/rest\/v1\/account_links 500\)/);
});

test('preferences.clear deletes every stored setting of that user only', async () => {
  const deleted = [];
  const prefs = createResultPreferences({ secret: 'x'.repeat(32),
    listBlob: async ({ prefix }) => ({ blobs: [{ pathname: prefix + 'delivery.json' }, { pathname: prefix + 'hidden/fc1.json' }], hasMore: false }),
    deleteBlob: async paths => deleted.push(...paths) });
  await prefs.clear(UID);
  assert.equal(deleted.length, 2);
  assert.ok(deleted.every(p => p.startsWith('dm/preferences/') && !p.includes(UID)), 'paths use the hashed user id');
});

async function call(handler, body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'POST'; req.headers = { origin: 'https://inthon.yeoziphab.com', authorization: 'Bearer ' + 'x'.repeat(24) };
  const res = { writeHead(status) { this.status = status; }, end(value) { this.body = JSON.parse(value); } };
  await handler(req, res); return res;
}

test('the delete-account API only deletes the verified caller, and says so when deletion is not configured', async () => {
  const deleted = [];
  const handler = createLinkHandler({ deleteAccount: async uid => deleted.push(uid), fetchImpl: async () => Response.json({ id: UID }) });
  const ok = await call(handler, { action: 'delete-account', userId: '99999999-2222-3333-4444-555555555555' });
  assert.equal(ok.status, 200); assert.deepEqual(ok.body, { status: 'deleted' }); assert.deepEqual(deleted, [UID]);
  const off = await call(createLinkHandler({ fetchImpl: async () => Response.json({ id: UID }) }), { action: 'delete-account' });
  assert.equal(off.status, 503); assert.match(off.body.error, /contact@yeoziphab\.com/);
});

function signup(deleteAccount) {
  const timers = new Map(); let id = 0; const profiles = [];
  class Base {
    constructor(props) { this.props = props; }
    setState(u) { this.state = { ...this.state, ...(typeof u === 'function' ? u(this.state) : u) }; }
  }
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync('frontend/register/Signup.dc.html', 'utf8'))[1];
  const services = { user: async () => ({ id: 'user' }), login: async () => {}, issue: async () => ({ code: 'AB12CD' }),
    status: async () => ({ status: 'linked', username: 'tester' }), profile: async (name, age) => profiles.push({ name, age }),
    copy: async () => {}, deleteAccount };
  const c = runInNewContext(script + '\nnew Component({services})', { DCLogic: Base, services,
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: k => timers.delete(k),
    setInterval: () => 0, clearInterval: () => {}, localStorage: { setItem() {} } });
  const flush = () => { let n = 0; while (timers.size) { assert.ok(n++ < 80); const [k, fn] = timers.entries().next().value; timers.delete(k); fn(); } };
  return { c, flush, profiles };
}
const settle = () => new Promise(setImmediate);

test('signup blocks under-14s, deletes what was collected, and never saves their profile', async () => {
  let deletions = 0;
  const { c, flush, profiles } = signup(async () => { deletions++; });
  c.setState({ step: 'age', name: '테스트' });
  c.renderVals().onAge({ target: { value: '13' } }); c.renderVals().submitAge();
  await settle(); flush();
  assert.equal(deletions, 1); assert.deepEqual(profiles, []);
  assert.ok(c.renderVals().showBlocked); assert.ok(!c.renderVals().showDone);
  assert.ok(c.state.msgs.some(m => /만 14세 미만은 디미에 가입할 수 없어요/.test(m.text)));
  assert.ok(c.state.msgs.some(m => /모두 삭제했어요/.test(m.text)));

  const failing = signup(async () => { throw new Error('down'); });
  failing.c.setState({ step: 'age', name: '테스트' });
  failing.c.renderVals().onAge({ target: { value: '9' } }); failing.c.renderVals().submitAge();
  await settle(); failing.flush();
  assert.ok(failing.c.state.msgs.some(m => /contact@yeoziphab\.com/.test(m.text)), 'tells the user how to get it deleted');

  const adult = signup(async () => { deletions++; });
  adult.c.setState({ step: 'age', name: '테스트' });
  adult.c.renderVals().onAge({ target: { value: '14' } }); adult.c.renderVals().submitAge();
  await settle(); adult.flush();
  assert.equal(deletions, 1, '14 is allowed'); assert.deepEqual(adult.profiles, [{ name: '테스트', age: '14' }]);
});

test('policy pages exist, are linked from landing and signup, and follow the site CSP (no inline scripts)', () => {
  for (const [page, title] of [['public/terms.html', '이용약관'], ['public/privacy.html', '개인정보처리방침']]) {
    const html = readFileSync(page, 'utf8');
    assert.ok(html.includes(`<h1 class="h-lg">${title}</h1>`), title);
    for (const text of ['시행일 2026년 11월 1일', 'R을가져가', 'contact@yeoziphab.com', '/css/landing.css', '/css/brand.css', '/css/policy.css']) {
      assert.ok(html.includes(text), `${page}: ${text}`);
    }
    assert.doesNotMatch(html, /<script/i); assert.doesNotMatch(html, /서비스명|inthon2team|jimin/);
  }
  const privacy = readFileSync('public/privacy.html', 'utf8');
  for (const required of ['처리 목적', '처리하는 개인정보 항목', '보유 기간', '파기', '제3자 제공', '위탁', '국외 이전', '만 14세 미만',
    '정보주체의 권리', '안전성 확보 조치', '개인정보 보호책임자', '여승민', '권익침해 구제']) assert.ok(privacy.includes(required), required);
  for (const template of ['public/data/landing-template.json', 'public/data/register-template.json']) {
    const json = readFileSync(template, 'utf8');
    assert.ok(json.includes('"href": "/terms"') && json.includes('"href": "/privacy"'), template);
  }
});
