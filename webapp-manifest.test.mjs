import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';

test('installed app covers all internal routes and every entry point uses the same manifest', () => {
  const manifest = JSON.parse(readFileSync('public/manifest.webmanifest', 'utf8'));
  assert.equal(manifest.id, '/');
  assert.equal(manifest.scope, '/');
  assert.equal(manifest.start_url, '/dashboard');
  assert.equal(manifest.display, 'standalone');
  for (const name of ['index', 'dashboard', 'register', 'login', 'link', 'terms', 'privacy']) {
    const html = readFileSync(`public/${name}.html`, 'utf8');
    assert.match(html, /<link rel="manifest" href="\/manifest.webmanifest">/, name);
    assert.match(html, /<meta name="apple-mobile-web-app-capable" content="yes">/, name);
  }
  for (const icon of manifest.icons) assert.ok(existsSync('public' + icon.src));
});
