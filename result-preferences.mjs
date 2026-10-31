import { createHash } from 'node:crypto';
import { get, put, list, del } from '@vercel/blob';
import { sealToken, openToken } from './cloud-auth.mjs';

export function createResultPreferences({ secret, getBlob = get, putBlob = put, listBlob = list, deleteBlob = del }) {
  const prefix = uid => {
    if (!/^[a-f0-9-]{36}$/i.test(uid ?? '')) throw new Error('Invalid user');
    return 'dm/preferences/' + createHash('sha256').update(uid).digest('hex') + '/';
  };
  const save = (path, data) => putBlob(path, JSON.stringify(sealToken(data, secret)),
    { access: 'private', addRandomSuffix: false, allowOverwrite: true, contentType: 'application/json' });
  const delivery = async uid => {
    const value = await getBlob(prefix(uid) + 'delivery.json', { access: 'private', useCache: false });
    if (!value?.stream) return 'full';
    return openToken(await new Response(value.stream).json(), secret).delivery === 'summary' ? 'summary' : 'full';
  };
  const hidden = async uid => {
    const path = prefix(uid) + 'hidden/'; const ids = []; let cursor;
    do {
      const page = await listBlob({ prefix: path, cursor, limit: 1000 });
      for (const blob of page.blobs) {
        const id = blob.pathname.slice(path.length).replace(/\.json$/, '');
        if (/^fc\d+$/.test(id)) ids.push(id);
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return ids;
  };
  return {
    delivery,
    async read(uid) { const [mode, ids] = await Promise.all([delivery(uid), hidden(uid)]); return { delivery: mode, hidden: ids }; },
    async update(uid, body) {
      if (body.delivery !== undefined && !['summary', 'full'].includes(body.delivery)) throw Object.assign(new Error('받는 방식을 다시 선택해 주세요.'), { status: 400 });
      if (body.item !== undefined && (!/^fc[1-9]\d*$/.test(body.item) || typeof body.hidden !== 'boolean')) throw Object.assign(new Error('콘텐츠를 확인할 수 없어요.'), { status: 400 });
      if (body.delivery !== undefined) {
        await save(prefix(uid) + 'delivery.json', { delivery: body.delivery });
      }
      if (body.item !== undefined) {
        const path = prefix(uid) + 'hidden/' + body.item + '.json';
        if (body.hidden) await save(path, { hidden: true }); else await deleteBlob(path);
      }
      return this.read(uid);
    },
    /** Removes every stored preference of the user (account deletion). */
    async clear(uid) {
      const path = prefix(uid); let cursor;
      do {
        const page = await listBlob({ prefix: path, cursor, limit: 1000 });
        if (page.blobs.length) await deleteBlob(page.blobs.map(blob => blob.pathname));
        cursor = page.hasMore ? page.cursor : undefined;
      } while (cursor);
    },
  };
}

export function resultLinkMessage(publicUrl, id, result) {
  if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid content id');
  const url = new URL(publicUrl);
  if (url.protocol !== 'https:') throw new Error('Invalid public URL');
  const claim = typeof result.extracted?.claim === 'string' ? result.extracted.claim.replace(/[\r\n]/g, ' ').slice(0, 120) : '';
  return '정리가 끝났어요.' + (claim ? '\n' + claim : '') + '\n\n자세히 보기: ' + url.origin + '/items/fc' + id
    + '\n로그인한 본인만 볼 수 있어요.';
}
