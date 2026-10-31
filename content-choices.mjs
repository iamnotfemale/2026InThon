import { createHash, randomBytes } from 'node:crypto';
import { get, put, del } from '@vercel/blob';
import { sealToken, openToken } from './cloud-auth.mjs';
import { createCloudState } from './cloud-state.mjs';

export const CONTENT_ACTIONS = { recipe: '레시피 정리', factcheck: '팩트체크', schedule: '일정 조회', restaurant: '맛집 정리', space: '취향공간 정리', beauty: '미용 정리' };
const TTL = 20 * 60000;
const EXPIRED = '선택이 만료됐거나 이미 처리한 콘텐츠예요. 게시물·릴스를 다시 공유해 주세요.';
export function readContentAction(message) {
  const payload = message.quick_reply?.payload;
  return typeof payload === 'string' ? /^content:v1:(recipe|factcheck|schedule|restaurant|space|beauty):([a-f0-9]{32})$/.exec(payload) : null;
}

export function createContentChoices({ secret, getBlob = get, putBlob = put, deleteBlob = del,
  claim = createCloudState().claimPath, now = Date.now }) {
  const path = (sender, id) => {
    if (!/^\d{1,32}$/.test(sender ?? '') || !/^[a-f0-9]{32}$/.test(id)) throw new Error('Invalid content choice');
    return `dm/choices/${createHash('sha256').update('inthon-choice:' + sender).digest('hex')}/${id}`;
  };
  return {
    async offer(message, sender) {
      const id = randomBytes(16).toString('hex');
      await putBlob(path(sender, id) + '.json', JSON.stringify(sealToken({ message, expires: now() + TTL }, secret)),
        { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: false });
      return { kind: 'choice', status: 'awaiting_choice', messages: [{
        text: '디미가 어떻게 정리해드릴까요? 아래에서 골라 주세요.',
        quick_replies: Object.entries(CONTENT_ACTIONS).map(([action, title]) => ({
          content_type: 'text', title, payload: `content:v1:${action}:${id}`,
        })),
      }] };
    },
    async select(message, sender, processContent, acknowledge) {
      const match = readContentAction(message);
      const invalid = () => ({ kind: 'choice', status: 'expired', messages: [EXPIRED] });
      if (!match) return invalid();
      const [, action, id] = match; const key = path(sender, id);
      const result = await getBlob(key + '.json', { access: 'private', useCache: false });
      if (!result?.stream) return invalid();
      const stored = openToken(await new Response(result.stream).json(), secret);
      if (!Number.isFinite(stored.expires) || stored.expires <= now()) {
        await deleteBlob(key + '.json'); return invalid();
      }
      if (!await claim(key + '/used.json')) return invalid();
      try {
        // 'schedule' handles 공모전·대외활동 and delegates exhibition posts to their own extractor.
        await acknowledge(action);
        try { return { ...await processContent(stored.message, action), kind: 'content', action }; }
        catch { return { kind: 'content', status: 'failed', action,
          messages: ['분석을 마치지 못했어요. 잠시 후 콘텐츠를 다시 공유해 주세요.'] }; }
      } finally {
        // A cleanup outage must not hide a completed result or cause another analysis.
        try { await deleteBlob(key + '.json'); } catch { console.warn('Content choice cleanup unavailable'); }
      }
    },
  };
}
