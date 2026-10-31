import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const config = JSON.parse(readFileSync('vercel.json', 'utf8'));
const policiesFor = path => config.headers.filter(rule => new RegExp('^' + rule.source + '$').test(path));
const headersFor = path => Object.fromEntries(policiesFor(path).flatMap(rule => rule.headers).map(header => [header.key, header.value]));
const directives = csp => Object.fromEntries(csp.split(';').map(part => part.trim().split(/\s+/)).filter(([name]) => name)
  .map(([name, ...values]) => [name, values]));

test('map resource access and origin referrers apply only to dashboard documents', () => {
  for (const path of ['/dashboard', '/home', '/library', '/taste', '/calendar', '/settings', '/items/fc42-2', '/dashboard/', '/items/fc42/']) {
    assert.equal(policiesFor(path).length, 1, path); // Two enforcing CSP headers would intersect and block the SDK.
    const headers = headersFor(path); const csp = directives(headers['Content-Security-Policy']);
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin', path);
    assert.ok(csp['script-src'].includes('https://dapi.kakao.com'));
    assert.ok(csp['script-src'].includes('https://t1.daumcdn.net'));
    assert.ok(csp['img-src'].includes('https://*.daumcdn.net'));
    assert.ok(csp['connect-src'].includes('https://dapi.kakao.com'));
    for (const kind of ['script-src', 'img-src', 'connect-src']) assert.ok(csp[kind].includes('https://*.kakaocdn.net'));
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.deepEqual(csp['default-src'], ["'self'"]);
    assert.deepEqual(csp['frame-ancestors'], ["'none'"]);
    assert.deepEqual(csp['base-uri'], ["'none'"]);
    assert.deepEqual(csp['form-action'], ["'none'"]);
    assert.ok(!csp['script-src'].some(value => ["'unsafe-inline'", "'unsafe-eval'", '*', 'https:', 'http:'].includes(value)));
  }
  for (const path of ['/', '/register', '/login', '/link', '/privacy', '/terms', '/js/dashboard-app.js']) {
    assert.equal(policiesFor(path).length, 1, path);
    const headers = headersFor(path);
    assert.equal(headers['Referrer-Policy'], 'no-referrer', path);
    assert.doesNotMatch(headers['Content-Security-Policy'], /kakao|daumcdn/);
  }
  for (const path of ['/auth/start', '/auth/instagram/callback', '/webhooks/instagram', '/api/instagram', '/health']) {
    assert.equal(policiesFor(path).length, 0, path);
  }
  assert.match(readFileSync('public/dashboard.html', 'utf8'), /name="referrer" content="strict-origin-when-cross-origin"/);
  for (const file of ['public/login.html', 'public/link.html', 'public/register.html']) {
    assert.match(readFileSync(file, 'utf8'), /name="referrer" content="no-referrer"/, file);
  }
});
