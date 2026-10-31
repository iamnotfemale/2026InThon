// Maps real Supabase rows onto the item shape the supplied dashboard design renders.
// Pure functions only (no DOM, no network) so they can be tested in Node.

export const BOT_DM_URL = 'https://ig.me/m/dimi_in';
export const LIVE_ID = /^fc\d+$/;
const PENDING_GRACE_MS = 10 * 60 * 1000;

// Our verdicts → the design's five-step scale (사실 · 대체로 사실 · 오해의 소지 · 거짓 · 판단 유보).
const VERDICT = { supported: 'true', refuted: 'false', context: 'mis', unverified: 'hold', not_checkable: 'hold' };
const VERDICT_LABEL = { true: '사실', mostly: '대체로 사실', mis: '오해의 소지', false: '거짓', hold: '판단 유보' };
const NOT_DONE_TITLE = {
  not_checkable: '확인할 사실 주장을 찾지 못한 콘텐츠',
  no_input: '내용을 열지 못한 콘텐츠',
  failed: '확인을 마치지 못한 콘텐츠',
};

const parts = date => Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric',
  month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
  .formatToParts(date).map(p => [p.type, p.value]));
const dayKey = p => `${p.year}-${p.month}-${p.day}`;

/** '2026.10.31 14:21' in KST. */
export function stamp(date) {
  const p = parts(date);
  return `${p.year}.${p.month}.${p.day} ${p.hour}:${p.minute}`;
}

/** '오늘 14:21' / '어제 09:05' / '10월 29일' relative to now, in KST. */
export function relative(date, now = new Date()) {
  const p = parts(date); const today = parts(now); const yesterday = parts(new Date(now.getTime() - 86400000));
  if (dayKey(p) === dayKey(today)) return `오늘 ${p.hour}:${p.minute}`;
  if (dayKey(p) === dayKey(yesterday)) return `어제 ${p.hour}:${p.minute}`;
  return `${Number(p.month)}월 ${Number(p.day)}일`;
}

const host = url => { try { return new URL(url).hostname.replace(/^www\./, ''); } catch { return ''; } };

/** One public.factchecks row → one dashboard item (type 'news'). */
export function factcheckToItem(row, now = new Date()) {
  const at = new Date(row.created_at);
  const done = row.status === 'done';
  const verdict = VERDICT[row.verdict] ?? 'hold';
  const sentAt = row.dm_sent_at ? new Date(row.dm_sent_at) : null;
  const dm = row.dm_status === 'sent' ? 'sent' : (now.getTime() - at.getTime() < PENDING_GRACE_MS ? 'waiting' : 'unknown');
  const sources = (Array.isArray(row.sources) ? row.sources : [])
    .filter(s => typeof s?.url === 'string' && /^https?:\/\//.test(s.url))
    .map(s => ({ title: s.title || host(s.url) || s.url, org: s.source || host(s.url), date: '', rel: '근거 자료',
      relCls: 'rel', why: '', url: s.url }));
  return {
    id: 'fc' + row.id, type: 'news', status: done ? 'done' : 'insufficient',
    title: row.claim || NOT_DONE_TITLE[row.status] || NOT_DONE_TITLE.failed,
    key: done ? '판단 · ' + VERDICT_LABEL[verdict] : (row.reason || '정리하지 못했어요'),
    dm, dmAt: sentAt ? relative(sentAt, now) : '',
    received: relative(at, now), organized: relative(at, now), checkedAt: stamp(at) + ' KST', ts: at.getTime(),
    author: null, origin: null, thumb: true,
    claim: row.claim || '', verdict, oneLine: row.reason || '', reason: row.reason || '',
    checks: [], same: [], diff: [], context: [], limits: [], needed: [], sources,
  };
}

/** Display name for the signed-in Google user. */
export function displayName(user) {
  const meta = user?.user_metadata ?? {};
  const name = [meta.full_name, meta.name, meta.given_name].find(v => typeof v === 'string' && v.trim());
  return (name || (user?.email ?? '').split('@')[0] || '사용자').trim().slice(0, 40);
}

/** account_links row (with ig_accounts embedded) → the design's connection fields. */
export function linkState(link) {
  if (!link) return { connected: false, account: '', connectedAt: '' };
  const username = link.ig_accounts?.username;
  return { connected: true, account: username ? '@' + username : 'Instagram 계정 (아이디 확인 전)',
    connectedAt: stamp(new Date(link.linked_at)) };
}
