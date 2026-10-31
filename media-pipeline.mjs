import { createHmac, randomUUID } from 'node:crypto';
import { get, list, del } from '@vercel/blob';
import { createSourceResolver, canonicalInstagramUrl } from './instagram-source.mjs';
import { safeFetch } from './factcheck.mjs';

const failed = (reason, text) => ({ status: 'no_input', media: { status: reason }, messages: [text] });

const metaCdn = value => {
  try {
    const u = new URL(value);
    return u.protocol === 'https:' && !u.username && !u.password && (!u.port || u.port === '443')
      && ['.cdninstagram.com', '.fbcdn.net', '.fbsbx.com'].some(suffix => u.hostname.endsWith(suffix));
  } catch { return false; }
};

export function createMediaFactChecker({ check, resolveSource, prepare,
  fetchSharedVideo = url => safeFetch(url, { maxBytes: 20 * 1024 * 1024, timeout: 20000 }),
  onCleanupError = () => console.warn('Media cleanup deferred'),
  logTiming = data => console.info('MEDIA_TIMING', JSON.stringify(data)) }) {
  return async message => {
    const started = performance.now(); const timing = {};
    const time = async (stage, task) => {
      const start = performance.now();
      try { return await task(); } finally { timing[stage] = Math.round(performance.now() - start); }
    };
    try {
      const attachment = message.attachments?.length === 1 ? message.attachments[0] : null;
      const sharedUrl = attachment?.payload?.url;
      if (['ig_reel', 'reel'].includes(attachment?.type) && metaCdn(sharedUrl)) {
        let video;
        try {
          const media = await time('shared_video_ms', () => fetchSharedVideo(sharedUrl));
          if (media.body.length <= 20 * 1024 * 1024 && media.body.subarray(4, 8).toString() === 'ftyp'
            && metaCdn(media.url)) video = media;
        } catch {} // A CDN cover or failed download still needs the source resolver.
        if (video) {
          try {
            const result = await time('analysis_ms', () => check(message, { requireAllMedia: true, signal: AbortSignal.timeout(150000),
              fetchMedia: async url => {
                if (url !== sharedUrl) throw new Error('Unexpected video URL');
                return { ...video, contentType: 'video/mp4' };
              } }));
            return { ...result, media: { status: 'downloaded', sourceVia: 'webhook_video', totalItems: 1, images: 0, videos: 1 } };
          } finally { video.body.fill(0); }
        }
      }
      const source = await time('resolve_ms', () => resolveSource(message));
      if (source.status === 'not_needed') return await time('analysis_ms', () => check(message));
      if (source.status === 'ambiguous') return failed('ambiguous', '게시물 링크를 한 번에 하나씩 보내주세요.');
      if (source.status === 'needs_source_url') return { ...failed(source.status,
        '공유된 게시물의 전체 원본 주소를 받지 못했어요. Instagram에서 ‘링크 복사’한 주소를 이 DM에 보내주세요. 링크를 받으면 이미지·영상을 다시 확인할게요.'), needsSourceUrl: true };
      let lease;
      try { lease = await time('prepare_ms', () => prepare(source.url)); }
      catch { return failed('download_failed', '원본 미디어를 모두 내려받지 못했어요. 공개 게시물인지 확인해 주세요. 한 번에 최대 10개 미디어, 영상은 개당 20MB까지 처리해요.'); }
      try {
        const result = await time('analysis_ms', () => check({ ...message, attachments: lease.files.map((file, i) => ({ type: file.kind,
          payload: { url: file.path, title: i === 0 ? lease.caption : '' } })) },
        { fetchMedia: lease.fetchMedia, requireAllMedia: true, signal: AbortSignal.timeout(150000) }));
        return { ...result, media: { status: 'downloaded', sourceUrl: source.url, sourceVia: source.via,
          totalItems: lease.files.length, images: lease.files.filter(f => f.kind === 'image').length,
          videos: lease.files.filter(f => f.kind === 'video').length } };
      } finally {
        // Await the entire AI pipeline before releasing originals and resized inputs, even on failure.
        try { await time('cleanup_ms', () => lease.cleanup()); } catch { onCleanupError(); }
      }
    } finally {
      timing.total_ms = Math.round(performance.now() - started);
      try { logTiming(timing); } catch { /* Diagnostics must not interrupt cleanup or delivery. */ }
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
