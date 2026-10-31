import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createMediaFactChecker, createMediaPreparer } from './media-pipeline.mjs';

const url = 'https://www.instagram.com/p/Example/';
const jobId = '11111111-1111-4111-8111-111111111111';
const prefix = `dm/media-jobs/${jobId}/`;
const file = { index: 1, kind: 'image', path: prefix + 'ai_01.jpg', bytes: 4, contentType: 'image/jpeg' };

test('missing original asks for copied URL without invoking AI or downloading a partial cover', async () => {
  const check = createMediaFactChecker({ resolveSource: async () => ({ status: 'needs_source_url' }),
    prepare: () => assert.fail('no download'), check: () => assert.fail('no AI') });
  const result = await check({ attachments: [] });
  assert.equal(result.needsSourceUrl, true);
  assert.match(result.messages[0], /링크 복사/);
});
test('all ordered media remain available through extraction and judgment; cleanup is awaited after success or failure', async () => {
  for (const fail of [false, true]) {
    const events = [];
    const check = createMediaFactChecker({ resolveSource: async () => ({ status: 'resolved', url, via: 'graph' }),
      prepare: async () => ({ caption: '본문', files: [file], fetchMedia: async () => {}, cleanup: async () => { events.push('delete'); } }),
      check: async (message, options) => {
        assert.equal(message.attachments[0].payload.url, file.path);
        assert.equal(message.attachments[0].payload.title, '본문');
        assert.equal(typeof options.fetchMedia, 'function');
        events.push('extract'); await Promise.resolve(); events.push('judge');
        assert.ok(!events.includes('delete'));
        if (fail) throw new Error('AI failed');
        return { status: 'done', messages: ['분석'] };
      } });
    if (fail) await assert.rejects(check({}), /AI failed/);
    else assert.equal((await check({})).media.images, 1);
    assert.deepEqual(events, ['extract', 'judge', 'delete']);
  }
});
test('cleanup failure preserves the completed AI result and is signaled for retry', async () => {
  let warned = false;
  const check = createMediaFactChecker({ resolveSource: async () => ({ status: 'resolved', url }),
    prepare: async () => ({ files: [file], cleanup: async () => { throw new Error(); } }),
    check: async () => ({ status: 'done' }), onCleanupError: () => { warned = true; } });
  assert.equal((await check({})).status, 'done'); assert.equal(warned, true);
});
test('private worker requests are signed and fetches cannot escape the current job; cleanup covers originals too', async () => {
  const deleted = []; const read = [];
  const prepare = createMediaPreparer({ origin: 'https://example.com', secret: 'test-secret', uuid: () => jobId,
    fetchImpl: async (target, options) => {
      assert.equal(target.href, 'https://example.com/api/media');
      assert.equal(options.headers['x-inthon-media-signature'], createHmac('sha256', 'test-secret').update('inthon-media-v1:' + options.body).digest('hex'));
      return Response.json({ sourceUrl: url, caption: '', files: [file] });
    }, getBlob: async path => { read.push(path); return { stream: new Response(Buffer.from([255, 216, 255, 0])).body }; },
    listBlobs: async ({ prefix: p }) => { assert.equal(p, prefix); return { blobs: [{ pathname: file.path }, { pathname: prefix + 'original_image_01.jpg' }] }; },
    deleteBlobs: async paths => deleted.push(...paths) });
  const lease = await prepare(url);
  assert.equal(deleted.length, 0);
  await assert.rejects(lease.fetchMedia('dm/credentials/secret.json', 100), /Invalid/);
  assert.equal((await lease.fetchMedia(file.path, 100)).body.length, 4);
  assert.deepEqual(read, [file.path]);
  await lease.cleanup(); assert.equal(deleted.length, 2);
});
test('a malformed worker manifest is rejected and only its allocated prefix is cleaned', async () => {
  let cleaned = false;
  const prepare = createMediaPreparer({ origin: 'https://example.com', secret: 'test', uuid: () => jobId,
    fetchImpl: async () => Response.json({ sourceUrl: url, caption: '', files: [{ ...file, path: 'dm/credentials/x' }] }),
    listBlobs: async ({ prefix: p }) => { assert.equal(p, prefix); cleaned = true; return { blobs: [] }; } });
  await assert.rejects(prepare(url), /Invalid media/); assert.equal(cleaned, true);
});
