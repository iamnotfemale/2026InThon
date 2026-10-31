import { test } from 'node:test';
import assert from 'node:assert/strict';
import { canonicalInstagramUrl, createSourceResolver } from './instagram-source.mjs';

const original = 'https://www.instagram.com/p/Example_123/';
test('Instagram sources require an exact HTTPS host and post route, dropping tracking', () => {
  assert.equal(canonicalInstagramUrl(original + '?img_index=3'), original);
  for (const url of ['http://instagram.com/p/x', 'https://instagram.com.evil/p/x', 'https://user@instagram.com/p/x',
    'https://instagram.com:8443/p/x', 'https://instagram.com/accounts/login', 'https://lookaside.fbsbx.com/ig_messaging_cdn/x']) {
    assert.equal(canonicalInstagramUrl(url), null);
  }
});
test('explicit and native reel URLs resolve without reading captions or making API calls', async () => {
  const resolver = createSourceResolver({ loadAccessToken: () => { throw new Error('must not read token'); } });
  assert.equal((await resolver({ text: `확인해줘 (${original}?utm=a)` })).url, original);
  assert.equal((await resolver({ attachments: [{ type: 'ig_reel', payload: { url: original, title: 'unrelated https://www.instagram.com/p/Else/' } }] })).url, original);
  assert.equal((await resolver({ text: '그냥 질문', attachments: [{ type: 'image', payload: { url: 'https://cdn.example/img.jpg' } }] })).status, 'not_needed');
});
test('opaque ID lookup uses bearer authorization, accepts only a canonical returned permalink', async () => {
  const resolver = createSourceResolver({ loadAccessToken: async () => 'fake-token', fetchImpl: async (url, options) => {
    assert.match(url, /\/123\?fields=permalink$/);
    assert.ok(!url.includes('fake-token'));
    assert.equal(options.headers.authorization, 'Bearer fake-token');
    return Response.json({ permalink: original + '?x=1' });
  } });
  assert.deepEqual(await resolver({ attachments: [{ type: 'ig_post', payload: { ig_post_media_id: '123' } }] }),
    { status: 'resolved', url: original, via: 'graph' });
});
test('100/33, unavailable lookup and caption-only URLs request source instead of guessing', async () => {
  for (const response of [new Response('{}', { status: 400 }), Response.json({ permalink: 'https://evil.example/p/x' })]) {
    const resolver = createSourceResolver({ loadAccessToken: async () => 'fake', fetchImpl: async () => response });
    assert.equal((await resolver({ attachments: [{ type: 'ig_post', payload: { ig_post_media_id: '482584233761418119', title: original } }] })).status, 'needs_source_url');
  }
  assert.equal((await createSourceResolver()({ attachments: [{ type: 'ig_post', payload: { title: original } }] })).status, 'needs_source_url');
});
test('multiple distinct source URLs do not silently choose the wrong post', async () => {
  assert.equal((await createSourceResolver()({ text: `${original} https://www.instagram.com/p/Other/` })).status, 'ambiguous');
});
