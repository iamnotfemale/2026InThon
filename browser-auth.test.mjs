import { test } from 'node:test';
import assert from 'node:assert/strict';
import { safeLoginNext, browserLoginUrl, chromeIntent, startGoogleLogin } from './public/js/browser-auth.js';
const origin = 'https://inthon.yeoziphab.com';

test('Instagram auth uses a browser handoff without starting Google OAuth in the webview', async () => {
  const visits = []; let requests = 0;
  const location = { origin, assign: url => visits.push(url) };
  await startGoogleLogin('/items/fc12-2', { ua: 'iPhone Instagram', location, oauth: () => { requests++; } });
  assert.equal(requests, 0); assert.equal(visits[0], browserLoginUrl('/items/fc12-2', origin));
  await startGoogleLogin('/items/fc12-2', { ua: 'Chrome', location, oauth: async value => {
    requests++; assert.deepEqual(value, { provider: 'google', options: { redirectTo: origin + '/items/fc12-2' } });
  } });
  assert.equal(requests, 1);
});

test('return destinations cannot redirect outside Dimi or carry OAuth tokens in a query', () => {
  for (const value of ['//evil.test', 'https://evil.test/dashboard', 'javascript:alert(1)', '/settings/../evil', '/login', '/items/fc1/evil']) {
    assert.equal(safeLoginNext(value, origin), '/dashboard');
  }
  assert.equal(safeLoginNext('/items/fc3?access_token=private#secret', origin), '/items/fc3');
  assert.equal(safeLoginNext('/calendar', origin), '/calendar');
  const url = browserLoginUrl('/register', origin); const intent = chromeIntent(url, origin);
  assert.match(intent, /^intent:\/\/inthon\.yeoziphab\.com\/login\?next=/);
  assert.match(intent, /package=com\.android\.chrome/); assert.ok(intent.includes(encodeURIComponent(url)));
  assert.throws(() => chromeIntent('https://evil.test', origin));
  assert.throws(() => chromeIntent(origin + '/link#token=secret', origin));
});
