import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMediaProbe } from './media-probe.mjs';
import { openToken } from './cloud-auth.mjs';
import { IG_ID } from './server.mjs';

const secret = 'test-app-secret';
const code = 'AB12CD34';
const start = Date.now();
const delivery = (message, sender = '12345', extra = {}) => ({ accountId: IG_ID, event: {
  recipient: { id: IG_ID }, sender: { id: sender }, timestamp: start, message, ...extra,
} });
const command = delivery({ mid: 'command-id', text: `/media-test ${code}` });
function fixture() {
  const objects = new Map(); let current = start;
  const options = { code, secret, until: new Date(start + 20 * 60000).toISOString(), now: () => current,
    putBlob: async (path, body, opts) => {
      assert.equal(opts.access, 'private'); assert.equal(opts.allowOverwrite, false);
      if (objects.has(path)) throw new Error('exists');
      objects.set(path, body);
    },
    getBlob: async (path, opts) => {
      assert.equal(opts.useCache, false);
      return objects.has(path) ? { stream: new Response(objects.get(path)).body } : null;
    },
  };
  return { objects, options, probe: createMediaProbe(options), advance: () => { current += 21 * 60000; } };
}

test('media diagnostic is disabled unless explicitly bounded and configured', () => {
  assert.equal(createMediaProbe(), undefined);
  assert.equal(createMediaProbe({ code, secret, until: 'invalid' }), undefined);
  assert.equal(createMediaProbe({ code, secret, until: new Date(start + 60 * 60000).toISOString() }), undefined);
  assert.equal(createMediaProbe({ code, secret, until: new Date(start - 1).toISOString() }), undefined);
});

test('only explicitly armed sender attachments are encrypted; no ordinary DM body or raw sender is retained', async () => {
  const f = fixture();
  const attachment = { type: 'ig_post', payload: { url: 'https://lookaside.fbsbx.com/test', title: 'test-caption', ig_post_media_id: '987' } };
  const media = delivery({ mid: 'media-id', text: 'private-DM-body', attachments: [attachment] });
  await f.probe([media]); assert.equal(f.objects.size, 0);
  await f.probe([command]); assert.equal(f.objects.size, 1);
  await createMediaProbe(f.options)([delivery(media.event.message, '67890')]); assert.equal(f.objects.size, 1);
  await createMediaProbe(f.options)([media]); assert.equal(f.objects.size, 2);
  await f.probe([media]); assert.equal(f.objects.size, 2);
  const values = [...f.objects.values()];
  for (const encrypted of values) assert.doesNotMatch(encrypted, /private-DM-body|test-caption|lookaside|12345|media-id/);
  const captured = values.map(v => openToken(JSON.parse(v), secret)).find(v => v.attachments);
  assert.deepEqual(captured.attachments, [attachment]);
  assert.equal(captured.textLength, 15);
  assert.equal(captured.messageId, 'media-id');
  assert(!JSON.stringify(captured).includes('private-DM-body'));
  assert(!JSON.stringify(captured).includes('12345'));
});

test('echoes, foreign account, stale commands and expiry cannot enable capture', async () => {
  const f = fixture();
  await f.probe([
    { ...command, accountId: '999' },
    delivery({ ...command.event.message, is_echo: true }),
    delivery(command.event.message, '12345', { timestamp: start - 300001 }),
  ]);
  assert.equal(f.objects.size, 0);
  await f.probe([command]); f.advance();
  await f.probe([delivery({ mid: 'media', attachments: [{ type: 'video', payload: { url: 'https://example.com/v.mp4' } }] })]);
  assert.equal(f.objects.size, 1);
});

test('first sender keeps the session and storage failures do not masquerade as successful capture', async () => {
  const f = fixture();
  await f.probe([command, delivery(command.event.message, '67890')]);
  await f.probe([delivery({ mid: 'other-media', attachments: [{ type: 'image' }] }, '67890')]);
  assert.equal(f.objects.size, 1);
  const broken = createMediaProbe({ ...f.options, putBlob: async () => { throw new Error('offline'); }, getBlob: async () => null });
  await assert.rejects(broken([command]), /offline/);
});
