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

test('a complete shared reel MP4 is read without needing a permalink, then its input buffer is cleared', async () => {
  const url = 'https://scontent.example.cdninstagram.com/video.mp4';
  const body = Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(16)]);
  const check = createMediaFactChecker({ resolveSource: () => assert.fail('no permalink lookup'), prepare: () => assert.fail('no source download'),
    fetchSharedVideo: async () => ({ url, body }), check: async (message, options) => {
      assert.equal(options.requireAllMedia, true);
      const media = await options.fetchMedia(message.attachments[0].payload.url);
      assert.equal(media.contentType, 'video/mp4'); assert.equal(media.body.subarray(4, 8).toString(), 'ftyp');
      return { status: 'done', messages: ['영상 분석'] };
    } });
  assert.equal((await check({ attachments: [{ type: 'ig_reel', payload: { url } }] })).media.sourceVia, 'webhook_video');
  assert.ok(body.every(byte => byte === 0));
});

test('a reel cover never masquerades as the complete video or bypasses source lookup', async () => {
  let lookedUp = false;
  const check = createMediaFactChecker({ resolveSource: async () => { lookedUp = true; return { status: 'needs_source_url' }; },
    fetchSharedVideo: async () => ({ url: 'https://lookaside.fbsbx.com/cover', body: Buffer.from([255, 216, 255]) }),
    check: () => assert.fail('no partial AI') });
  assert.equal((await check({ attachments: [{ type: 'ig_reel', payload: { url: 'https://lookaside.fbsbx.com/cover' } }] })).needsSourceUrl, true);
  assert.equal(lookedUp, true);
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

const videoUrl = 'https://video.example.cdninstagram.com/full.mp4';
const mp4 = () => Buffer.concat([Buffer.alloc(4), Buffer.from('ftyp'), Buffer.alloc(16, 3)]);
const direct = () => ({ sourceUrl: url, caption: '영상 본문', video: { url: videoUrl, contentType: 'video/mp4' } });

test('a resolved complete MP4 skips private staging, remains available through AI and is cleared afterward', async () => {
  for (const fail of [false, true]) {
    const body = mp4(); let lease;
    const prepare = createMediaPreparer({ origin: 'https://example.com', secret: 'test', uuid: () => jobId,
      fetchImpl: async (_url, options) => {
        assert.equal(JSON.parse(options.body).directVideo, true);
        assert.equal(options.headers['x-inthon-media-signature'], createHmac('sha256', 'test').update('inthon-media-v1:' + options.body).digest('hex'));
        return Response.json(direct());
      }, fetchVideo: async value => { assert.equal(value, videoUrl); return { url: videoUrl, body }; },
      getBlob: () => assert.fail('no private GET'), listBlobs: () => assert.fail('no private listing'), deleteBlobs: () => assert.fail('no private delete') });
    const run = createMediaFactChecker({ resolveSource: async () => ({ status: 'resolved', url }),
      prepare: async value => { lease = await prepare(value); return lease; },
      check: async (message, options) => {
        assert.equal(message.attachments.length, 1); assert.equal(message.attachments[0].type, 'video');
        assert.equal(message.attachments[0].payload.title, '영상 본문');
        await assert.rejects(options.fetchMedia('dm/credentials/secret.json', 100));
        const input = await options.fetchMedia(message.attachments[0].payload.url, 100);
        assert.equal(input.body, body); assert.equal(input.body.subarray(4, 8).toString(), 'ftyp');
        await Promise.resolve(); assert.ok(body.some(byte => byte !== 0), 'retain full bytes until AI settles');
        if (fail) throw new Error('AI failed');
        return { status: 'done' };
      } });
    if (fail) await assert.rejects(run({}), /AI failed/);
    else assert.equal((await run({})).media.videos, 1);
    assert.ok(body.every(byte => byte === 0));
    await assert.rejects(lease.fetchMedia(lease.files[0].path, 100), /Invalid direct video input/);
  }
});

test('failed, oversized, redirected or cover-only direct video falls back once using the same job and timeout', async () => {
  for (const mode of ['network', 'oversize', 'redirect', 'cover']) {
    const calls = []; const body = mode === 'oversize' ? Buffer.alloc(20 * 1024 * 1024 + 1) : mode === 'cover' ? Buffer.from([255, 216, 255]) : mp4();
    const staged = { ...file, kind: 'video', contentType: 'video/mp4', path: prefix + 'original_video_01.mp4', bytes: 24 };
    const prepare = createMediaPreparer({ origin: 'https://example.com', secret: 'test', uuid: () => jobId,
      fetchImpl: async (_url, options) => {
        calls.push(options);
        return Response.json(calls.length === 1 ? direct() : { sourceUrl: url, caption: '본문', files: [staged] });
      }, fetchVideo: async () => {
        if (mode === 'network') throw new Error('not available');
        return { url: mode === 'redirect' ? 'https://unexpected.example/x' : videoUrl, body };
      }, getBlob: async () => ({ stream: new Response(mp4()).body }) });
    const lease = await prepare(url);
    assert.deepEqual(calls.map(c => JSON.parse(c.body).directVideo), [true, false]);
    assert.ok(calls.every(c => JSON.parse(c.body).jobId === jobId));assert.equal(calls[0].signal, calls[1].signal);
    assert.equal((await lease.fetchMedia(staged.path, 100)).body.subarray(4, 8).toString(), 'ftyp');
    assert.ok(body.every(byte => byte === 0) || mode === 'network');
  }
});

test('unsafe direct URLs, wrong source and mixed manifests never bypass full-media validation', async () => {
  for (const result of [ { ...direct(), sourceUrl: 'https://www.instagram.com/p/Other/' },
    { ...direct(), files: [file] }, { ...direct(), video: { url: 'https://localhost/private', contentType: 'video/mp4' } },
    { ...direct(), video: { url: 'https://name:pass@video.example.cdninstagram.com/x', contentType: 'video/mp4' } } ]) {
    const prepare = createMediaPreparer({ origin: 'https://example.com', secret: 'test', uuid: () => jobId,
      fetchImpl: async () => Response.json(result), fetchVideo: () => assert.fail('never fetch an untrusted manifest'),
      listBlobs: async ({prefix: allocated}) => { assert.equal(allocated,prefix); return {blobs:[]}; } });
    await assert.rejects(prepare(url), /Invalid/);
  }
});
