// Maps real Supabase rows onto the item shape the supplied dashboard design renders.
// Pure functions only (no DOM, no network) so they can be tested in Node.

export const BOT_DM_URL = 'https://ig.me/m/inthon2team';
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

/** First sentence of the model's reason, for the verdict card; the full reason stays in "판단 이유". */
export function firstSentence(text) {
  if (!text) return '';
  const match = /^[\s\S]*?[.!?。](?=\s|$)/.exec(text.trim());
  return (match ? match[0] : text).trim();
}

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
    claim: row.claim || '', verdict, oneLine: firstSentence(row.reason), reason: row.reason || '',
    checks: [], same: [], diff: [], context: [], limits: [], needed: [], sources,
  };
}

/** Display name for the signed-in Google user. */
export function displayName(user) {
  const meta = user?.user_metadata ?? {};
  const name = [meta.display_name, meta.full_name, meta.name, meta.given_name].find(v => typeof v === 'string' && v.trim());
  return (name || (user?.email ?? '').split('@')[0] || '사용자').trim().slice(0, 40);
}

// Demo-only interactions that have no backend yet; in real-data mode they say so instead of pretending to succeed.
export const NOT_YET = ['openShare', 'requestProcess', 'sendReport', 'fbUp', 'fbDown', 'askWithdraw', 'confirmDelete', 'addCond'];

/**
 * Turns the design's demo render values into real-data ones. `v` comes from the generated model's renderVals(),
 * `s` is the component state and `app` the component (only its action methods are called, lazily).
 */
export function applyLiveMode(v, s, app) {
  Object.assign(v, {
    isDemo: false, isLive: true, modeBadge: '내 데이터', scenarioLabel: '내 실제 데이터', email: s.email,
    modeNote: '로그인한 계정의 실제 데이터를 보고 있어요. 위 데모 시나리오를 고르면 데모로 바뀌어요.',
    connectDesc: '@inthon2team에 ‘연결’을 보내면 답장으로 온 링크에서 연결돼요. 연결하면 이 계정으로 전에 보낸 콘텐츠도 함께 보여요.',
    dmModeDesc: '지금은 정리 결과 전체를 DM으로 보내요. 받는 방식 선택은 준비 중이에요.',
    simulateDm: () => {}, simDisabled: true, simHint: '데모 시나리오에서만 쓸 수 있어요',
    sendFromIg: () => app.openBotDm(), openIgDm: () => app.openBotDm(),
    emptyCta: s.connected ? () => app.openBotDm() : () => app.showLinkGuide(),
    goConnect: () => app.showLinkGuide(),
  });
  // Settings → 내 Instagram 연결: our DM-link workflow replaces the demo's code flow.
  const guide = !s.connected || !!s.liveGuide;
  Object.assign(v, {
    linkGuideOn: guide, showConnected: s.connected && !guide, changing: s.connected && guide,
    flowStart: false, flowIssuing: false, flowCode: false, flowVerifying: false, flowVerified: false,
    flowExpired: false, flowConflict: false,
    startCode: () => app.showLinkGuide(), askChange: () => app.setState({ liveGuide: true }),
    cancelFlow: () => app.setState({ liveGuide: false }),
    copyLinkWord: () => app.copy('연결', '‘연결’을 복사했어요. @inthon2team 대화창에 붙여 넣어 보내 주세요.'),
    checkLink: () => app.checkLink(),
    connModalDesc: s.connModal === 'disconnect'
      ? '해제하면 ' + s.account + '에서 보낸 콘텐츠가 이 대시보드에 보이지 않아요. 기록은 지워지지 않고, 다시 연결하면 돌아와요.'
      : v.connModalDesc,
    confirmConnModal: () => (s.connModal === 'disconnect' ? app.unlinkInstagram() : app.setState({ modal: null, liveGuide: true })),
    logout: () => app.signOut(),
    saveName: () => app.saveDisplayName(),
    reloadLib: () => { app.setState({ libLoading: true, libError: false }); app.loadLive(); },
    copyPrivateLink: () => {
      app.setState({ detailMenu: false });
      app.copy(`${globalThis.location?.origin ?? ''}/items/${encodeURIComponent(s.detailId ?? '')}`,
        '개인 결과 주소를 복사했어요. 로그인한 본인만 열 수 있어요.');
    },
  });
  // Our fact-checks cite sources but have no claim-by-claim comparison table.
  if (v.isDetail && v.d?.isNews) v.d = { ...v.d, cmpSummary: v.d.sourceCount ? '' : '확보한 근거 자료가 없어요' };
  for (const name of NOT_YET) {
    v[name] = () => {
      app.setState({ modal: null, detailMenu: false, reportOpen: false });
      app.toast('실제 데이터에서는 아직 준비 중인 기능이에요.');
    };
  }
  return v;
}

/** account_links row (with ig_accounts embedded) → the design's connection fields. */
export function linkState(link) {
  if (!link) return { connected: false, account: '', connectedAt: '' };
  const username = link.ig_accounts?.username;
  return { connected: true, account: username ? '@' + username : 'Instagram 계정 (아이디 확인 전)',
    connectedAt: stamp(new Date(link.linked_at)) };
}
