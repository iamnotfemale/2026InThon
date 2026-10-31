import { createHmac, randomUUID } from 'node:crypto';
import { get, list, del } from '@vercel/blob';
import { createSourceResolver, canonicalInstagramUrl } from './instagram-source.mjs';

const failed = (reason, text) => ({ status: 'no_input', media: { status: reason }, messages: [text] });

export function createMediaFactChecker({ check, resolveSource, prepare, onCleanupError = () => console.warn('Media cleanup deferred') }) {
  return async message => {
    const source = await resolveSource(message);
    if (source.status === 'not_needed') return check(message);
    if (source.status === 'ambiguous') return failed('ambiguous', '게시물 링크를 한 번에 하나씩 보내주세요.');
    if (source.status === 'needs_source_url') return { ...failed(source.status,
      '공유된 게시물의 전체 원본 주소를 받지 못했어요. Instagram에서 ‘링크 복사’한 주소를 이 DM에 보내주세요. 링크를 받으면 이미지·영상을 다시 확인할게요.'), needsSourceUrl: true };
    let lease;
    try { lease = await prepare(source.url); }
    catch { return failed('download_failed', '원본 미디어를 모두 내려받지 못했어요. 공개 게시물인지 확인해 주세요. 한 번에 최대 10개 미디어, 영상은 개당 20MB까지 처리해요.'); }
    try {
      const result = await check({ ...message, attachments: lease.files.map((file, i) => ({ type: file.kind,
        payload: { url: file.path, title: i === 0 ? lease.caption : '' } })) }, { fetchMedia: lease.fetchMedia, requireAllMedia: true });
      return { ...result, media: { status: 'downloaded', sourceUrl: source.url, sourceVia: source.via,
        totalItems: lease.files.length, images: lease.files.filter(f => f.kind === 'image').length,
        videos: lease.files.filter(f => f.kind === 'video').length } };
    } finally {
      // Await the entire AI pipeline before releasing originals and resized inputs, even on failure.
      try { await lease.cleanup(); } catch { onCleanupError(); }
    }
  };
}

export function createMediaPreparer({ origin, secret, fetchImpl = fetch, getBlob = get, listBlobs = list, deleteBlobs = del,
  now = Date.now, uuid = randomUUID }) {
  const target = new URL('/api/media', origin);
  if (target.protocol !== 'https:' || target.origin !== origin) throw new Error('Invalid media worker origin');
  return async url => {
    if (!canonicalInstagramUrl(url)) throw new Error('Invalid source URL');
    const jobId = uuid(); const prefix = `dm/media-jobs/${jobId}/`;
    const cleanup = async () => {
      let cursor;
      do {
        const page = await listBlobs({ prefix, cursor, limit: 1000 });
        if (page.blobs.length) await deleteBlobs(page.blobs.map(b => b.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    };
    try {
      const body = JSON.stringify({ jobId, at: Math.floor(now() / 1000), url });
      const signature = createHmac('sha256', secret).update('inthon-media-v1:' + body).digest('hex');
      const response = await fetchImpl(target, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(125000),
        headers: { 'content-type': 'application/json', 'x-inthon-media-signature': signature }, body });
      if (!response.ok) throw new Error('Media worker unavailable');
      const result = await response.json();
      if (canonicalInstagramUrl(result.sourceUrl) !== url || !Array.isArray(result.files)
        || result.files.length < 1 || result.files.length > 10 || typeof result.caption !== 'string') throw new Error('Invalid media manifest');
      const paths = new Map();
      for (const [i, file] of result.files.entries()) {
        if (file.index !== i + 1 || !['image', 'video'].includes(file.kind)
          || !['image/jpeg', 'video/mp4'].includes(file.contentType)
          || !Number.isInteger(file.bytes) || file.bytes < 1 || file.bytes > (file.kind === 'image' ? 1536 * 1024 : 20 * 1024 * 1024)
          || typeof file.path !== 'string' || !file.path.startsWith(prefix)
          || !/^(ai_\d{2}\.jpg|original_video_\d{2}\.mp4)$/.test(file.path.slice(prefix.length))
          || paths.has(file.path)) throw new Error('Invalid media entry');
        paths.set(file.path, file);
      }
      return { ...result, cleanup, async fetchMedia(path, maxBytes) {
        const file = paths.get(path);
        if (!file || file.bytes > maxBytes) throw new Error('Invalid staged media');
        try {
          const result = await getBlob(path, { access: 'private', useCache: false });
          if (!result?.stream) throw new Error();
          const chunks = []; let size = 0;
          for await (const chunk of result.stream) {
            size += chunk.length;
            if (size > file.bytes) throw new Error();
            chunks.push(Buffer.from(chunk));
          }
          if (size !== file.bytes) throw new Error();
          return { contentType: file.contentType, body: Buffer.concat(chunks) };
        } catch { throw new Error('Staged media unavailable'); }
      } };
    } catch (error) {
      try { await cleanup(); } catch { console.warn('Media cleanup deferred'); }
      throw error;
    }
  };
}

export function mediaFactCheckerFromEnv(check, { loadAccessToken, env = process.env } = {}) {
  if (!check) return undefined;
  return createMediaFactChecker({ check, resolveSource: createSourceResolver({ loadAccessToken }),
    prepare: createMediaPreparer({ origin: env.PUBLIC_URL, secret: env.META_APP_SECRET }) });
}
