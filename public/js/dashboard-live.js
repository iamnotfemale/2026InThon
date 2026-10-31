// Maps real Supabase rows onto the item shape the supplied dashboard design renders.
// Pure functions only (no DOM, no network) so they can be tested in Node.
import { validateRecipe } from './recipe-data.js';
import { indexFromRow, storedContent, indexedItems } from './content-index.js';
import { validateContest, contestTimeline, calendarLink } from './contest-data.js';
import { validateExhibit, exhibitView, visitCalendarLink, shownValue, webSources } from './exhibit-data.js';
import { placesFromRows, mapLinks, priceLabel, placeKeyLine } from './restaurant-data.js';

export const BOT_DM_URL = 'https://ig.me/m/dimi_in';
export const LIVE_ID = /^fc\d+$/;
/** An exhibition post listing several events shows each one as its own item: fc42, fc42-2, fc42-3… */
export const rowIdOf = id => String(id ?? '').replace(/-\d+$/, '');
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
  const stored = storedContent(row);
  const reason = typeof stored.reason === 'string' ? stored.reason : row.reason;
  const at = new Date(row.created_at);
  const done = row.status === 'done';
  const verdict = VERDICT[row.verdict] ?? 'hold';
  const sentAt = row.dm_sent_at ? new Date(row.dm_sent_at) : null;
  const dm = row.dm_status === 'sent' ? 'sent' : (now.getTime() - at.getTime() < PENDING_GRACE_MS ? 'waiting' : 'unknown');
  const sources = (Array.isArray(row.sources) ? row.sources : [])
    .filter(s => typeof s?.url === 'string' && /^https?:\/\//.test(s.url))
    .map(s => ({ title: s.title || host(s.url) || s.url, org: s.source || host(s.url), date: '', rel: '근거 자료',
      relCls: 'rel', why: '', url: s.url }));
  const item = {
    id: 'fc' + row.id, type: 'news', status: done ? 'done' : 'insufficient',
    title: row.claim || NOT_DONE_TITLE[row.status] || NOT_DONE_TITLE.failed,
    key: done ? '판단 · ' + VERDICT_LABEL[verdict] : (row.reason || '정리하지 못했어요'),
    dm, dmAt: sentAt ? relative(sentAt, now) : '',
    received: relative(at, now), organized: relative(at, now), checkedAt: stamp(at) + ' KST', ts: at.getTime(),
    author: null, origin: null, thumb: true,
    claim: row.claim || '', verdict, oneLine: firstSentence(reason), reason: reason || '', contentIndex: indexFromRow(row),
    checks: [], same: [], diff: [], context: [], limits: [], needed: [], sources,
  };
  if (done && row.topic === 'recipe') {
    try {
      const stored = JSON.parse(row.reason);
      if (stored.recipe?.version !== 1) throw new Error('Unsupported recipe');
      const recipe = validateRecipe({ ...stored.recipe, is_recipe: true });
      let origin = null;
      try {
        const source = new URL(stored.sourceUrl);
        if (source.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(source.hostname)
          && /^\/(p|reel|reels)\/[A-Za-z0-9_-]+\/$/.test(source.pathname)) origin = source.origin + source.pathname;
      } catch {}
      return { ...item, type: 'recipe', title: recipe.title, key: [recipe.total && '총 ' + recipe.total,
        recipe.cook && '조리 ' + recipe.cook, '재료 ' + recipe.ingredients.length + '개'].filter(Boolean).join(' · '),
        summary: recipe.summary, serving: recipe.serving || '인분 미기재', prep: recipe.prep || '시간 미기재', cook: recipe.cook || '시간 미기재',
        ingredients: recipe.ingredients.map((ingredient, i) => ({ id:'i'+i, name:ingredient.name, qty:(ingredient.quantity || '분량 미기재') + (ingredient.optional ? ' (선택)' : ''),
          group:ingredient.group, miss:!ingredient.quantity, flag:!!ingredient.conflict })),
        steps: recipe.steps.map((step, i) => ({id:'s'+i,text:step.text,meta:[step.heat,step.temperature,step.duration || '시간 미기재'].filter(Boolean).join(' · '),
          uses:step.uses,note:step.note,tip:null})), tips:recipe.tips.map(tip=>tip.text), checks:recipe.checks, origin,
      };
    } catch { return null; } // A malformed recipe must not appear as a news verdict or crash the library.
  }
  if (done && row.topic === 'contest') {
    try {
      const stored = JSON.parse(row.reason);
      const contest = validateContest(stored.contest);
      const t = contestTimeline(contest, now);
      const orNote = (list, note) => (list.length ? list : [note]);
      return { ...item, type: 'contest', title: contest.title, key: t.keyLine, summary: contest.summary,
        phase: t.phase, phaseCls: t.phaseCls,
        host: contest.host || '주최 미기재',
        organizer: contest.organizer ? '주관 · ' + contest.organizer : contest.sponsors.length ? '후원 · ' + contest.sponsors.join(', ') : '',
        // The design shows "마감" when dday is empty, so an unknown deadline must not look closed.
        dday: t.dday ?? (t.deadlineLabel === '마감일이 원본에 없어요' ? '미확인' : null), deadline: t.deadlineLabel,
        elig: orNote(contest.eligibility.map(x => x.text), '지원 대상·조건이 원본에 없어요.'),
        schedule: t.schedule.length ? t.schedule : [{ label: '일정', date: '원본에 날짜가 없어요', st: 'wait' }],
        submit: orNote(contest.submissions.map(x => x.text), '제출물이 원본에 없어요.'),
        process: orNote(contest.process.map(x => x.text), '지원 방법이 원본에 없어요.'),
        benefit: orNote([...contest.benefits.map(x => x.text), contest.fee && '참가 비용: ' + contest.fee].filter(Boolean),
          '혜택·참가 비용이 원본에 없어요.'),
        noticeUrl: contest.noticeUrl, applyUrl: contest.applyUrl, checks: contest.checks,
        origin: instagramOrigin(stored.sourceUrl), contestEvents: t.events };
    } catch { return null; } // A malformed contest must not appear as a news verdict or crash the library.
  }
  if (done && row.topic === 'exhibit') return exhibitRowItems(row, now)[0] ?? null;
  if (done && row.topic === 'restaurant') return restaurantRowItems(row, now)[0] ?? null;
  return item;
}

/**
 * One stored exhibition row → one dashboard item per event, mapped onto the design's exhibit fields.
 * Missing values use the design's own "미기재" wording; nothing is filled from outside the post.
 */
export function exhibitRowItems(row, now = new Date()) {
  if (row.status !== 'done' || row.topic !== 'exhibit') return [];
  let stored; let exhibit;
  try { stored = JSON.parse(row.reason); exhibit = validateExhibit(stored.exhibit); } catch { return []; }
  const base = { ...factcheckToItem({ ...row, topic: null }, now), contentIndex: indexFromRow(row) };
  const origin = instagramOrigin(stored.sourceUrl);
  const indexes = indexedItems(row);
  return exhibit.events.map((event, i) => {
    const view = exhibitView(event, now);
    // Values found on the web (not in the post) are marked so they never read as the post's own.
    const show = (field, missing) => { const { value, web } = shownValue(event, field); return value ? (web ? value + ' (웹 확인)' : value) : missing; };
    const sources = webSources(event).map(source => `웹에서 찾은 ${source.fields.join('·')}: ${source.title ?? source.url}`
      + `${source.basis === 'venue' ? ' (장소 일반 안내)' : ''} ${source.url}`);
    return { ...base, id: 'fc' + row.id + (i ? '-' + (i + 1) : ''), rowId: 'fc' + row.id, contentIndex: indexes[i]?.index, type: 'exhibit', title: event.title,
      key: view.keyLine, phase: view.phase, phaseCls: view.phaseCls, intro: event.intro ?? '원본에 소개 문구가 없어요.',
      period: view.period, hours: show('hours', '운영 시간 미기재'), closed: show('closed', '휴무일 미기재'),
      place: event.place ?? event.area ?? '장소 미기재', address: show('address', (event.place && event.area) ?? '주소 미기재'),
      mapUrl: view.mapUrl, fee: show('fee', '입장료 미기재'), booking: show('booking', '예약 필요 여부 미기재'),
      conditions: show('conditions', '관람 조건 미기재'), reserveUrl: shownValue(event, 'reserve_url').value,
      officialUrl: shownValue(event, 'official_url').value,
      visitDates: view.visits.map(visit => visit.label), checks: [...event.conflicts, ...event.notices, ...event.checks, ...sources],
      origin, exhibitEvent: event, exhibitVisits: view.visits, exhibitEnd: view.ended ? null : event.end, exhibitDaysLeft: view.daysLeft };
  });
}

// Columns the dashboard reads from the typed 맛집 tables (embedded under each factchecks row; RLS limits them to the member).
export const RESTAURANT_SELECT = 'restaurants(position, name, category, intro, area, address, phone, hours, closed, price_range, reservation, '
  + 'waiting, parking, links, evidence, checks, restaurant_menus(position, name, price_text, price_won, note, signature))';

/**
 * One 맛집 result row (with its restaurants and menus) → one dashboard item per place, mapped onto the design's
 * restaurant fields. Empty values use the design's "미기재" wording; nothing comes from outside the post.
 */
export function restaurantRowItems(row, now = new Date()) {
  if (row.status !== 'done' || row.topic !== 'restaurant') return [];
  const places = placesFromRows(row.restaurants);
  if (!places.length) return [];
  let stored = {};
  try { stored = JSON.parse(row.reason) ?? {}; } catch {}
  const base = { ...factcheckToItem({ ...row, topic: null }, now), contentIndex: indexFromRow(row) };
  const origin = instagramOrigin(stored.sourceUrl);
  return places.map((place, i) => {
    const maps = mapLinks(place);
    return { ...base, id: 'fc' + row.id + (i ? '-' + (i + 1) : ''), rowId: 'fc' + row.id, type: 'restaurant', title: place.name,
      key: placeKeyLine(place), intro: place.intro ?? '원본에 소개 문구가 없어요.', category: place.category,
      priceRange: place.priceRange ?? '가격대 미기재', hours: place.hours ?? '영업 시간 미기재', closed: place.closed ?? '휴무일 미기재',
      address: place.address ?? (place.area ? place.area + ' · 상세 주소 미기재' : '주소 미기재'),
      mapNaver: maps.naver, mapKakao: maps.kakao, mapGoogle: maps.google,
      menus: place.menus.map(menu => ({ name: menu.name, price: priceLabel(menu) ?? '가격 미기재', note: menu.note, signature: menu.signature })),
      reservation: place.reservation ?? '예약 정보 미기재', waiting: place.waiting ?? '웨이팅 정보 미기재',
      parking: place.parking ?? '주차 정보 미기재', phone: place.phone ?? '전화번호 미기재',
      placeLinks: place.links.map(link => ({ label: link.label, url: link.url })), checks: place.checks, origin };
  });
}

/** Only a canonical public Instagram post/reel URL is shown as the "원본 보기" link. */
function instagramOrigin(value) {
  try {
    const source = new URL(value);
    if (source.protocol === 'https:' && ['www.instagram.com', 'instagram.com'].includes(source.hostname)
      && /^\/(p|reel|reels)\/[A-Za-z0-9_-]+\/$/.test(source.pathname)) return source.origin + source.pathname;
  } catch {}
  return null;
}

/** Display name for the signed-in Google user. */
export function displayName(user) {
  const meta = user?.user_metadata ?? {};
  const name = [meta.display_name, meta.full_name, meta.name, meta.given_name].find(v => typeof v === 'string' && v.trim());
  return (name || (user?.email ?? '').split('@')[0] || '사용자').trim().slice(0, 40);
}

// Demo-only interactions that have no backend yet; in real-data mode they say so instead of pretending to succeed.
export const NOT_YET = ['openShare', 'requestProcess', 'sendReport', 'fbUp', 'fbDown', 'askWithdraw', 'addCond'];

/**
 * Turns the design's demo render values into real-data ones. `v` comes from the generated model's renderVals(),
 * `s` is the component state and `app` the component (only its action methods are called, lazily).
 */
export function applyLiveMode(v, s, app) {
  Object.assign(v, {
    isDemo: false, isLive: true, modeBadge: '내 데이터', scenarioLabel: '내 실제 데이터', email: s.email,
    modeNote: '로그인한 계정의 실제 데이터를 보고 있어요. 위 데모 시나리오를 고르면 데모로 바뀌어요.',
    connectDesc: '@dimi_in에 ‘연결’을 보내면 답장으로 온 링크에서 연결돼요. 연결하면 이 계정으로 전에 보낸 콘텐츠도 함께 보여요.',
    dmModeDesc: '기본은 핵심 안내와 개인 결과 링크예요. 링크는 로그인한 본인만 열 수 있어요.',
    dmModes: [['summary', '핵심 안내와 고유 링크', 'DM으로 안내를 받고, 자세한 정리는 내 결과 페이지에서 봐요.', true],
      ['full', 'DM에서 전체 받기', '정리한 내용을 DM으로 받아요. 긴 내용은 나눠서 보내요.', false]].map(([key,label,desc,isDefault]) => ({
        label, desc, isDefault, checked: s.dmMode === key ? 'true' : 'false', cls: 'radio-card' + (s.dmMode === key ? ' on' : ''), pick: () => app.changeDelivery(key),
      })),
    deleteDesc: '이 콘텐츠를 내 목록에서 제거해요. 삭제 후 알림에서 되돌릴 수 있어요.',
    libraryDeleteDesc: '콘텐츠의 더보기 메뉴에서 내 목록에서 제거해요. 삭제 후 알림에서 되돌릴 수 있어요.',
    confirmDelete: () => app.removeItem(s.delTarget),
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
    copyLinkWord: () => app.copy('연결', '‘연결’을 복사했어요. @dimi_in 대화창에 붙여 넣어 보내 주세요.'),
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
  Object.assign(v, contestLiveValues(v, s, app));
  for (const name of NOT_YET) {
    v[name] = () => {
      app.setState({ modal: null, detailMenu: false, reportOpen: false });
      app.toast('실제 데이터에서는 아직 준비 중인 기능이에요.');
    };
  }
  return v;
}

const SCHEDULE_DAYS = 60;
const EVENT_WHAT = { start: '접수 시작', deadline: '접수 마감', announce: '결과 발표', activity: '활동 시작', event: '행사', other: '일정' };

/**
 * Home "다가오는 일정" from real 공모전·대외활동 and exhibition results (the design hard-codes demo items c1/e1),
 * and "캘린더에 추가" on a contest detail as a Google Calendar link for its deadline.
 */
export function contestLiveValues(v, s, app) {
  const all = (app.allItems?.() ?? []).filter(item => item.type === 'contest');
  const schedule = all.flatMap(item => (item.contestEvents ?? [])
    .filter(event => event.days <= SCHEDULE_DAYS)
    .map(event => ({ item, event })))
    .sort((a, b) => a.event.date.localeCompare(b.event.date) || (a.event.time ?? '').localeCompare(b.event.time ?? ''))
    .slice(0, 6)
    .map(({ item, event }) => ({
      date: event.date, mon: Number(event.date.slice(5, 7)) + '월', day: event.date.slice(8, 10), title: item.title,
      what: (event.type === 'other' || event.type === 'event' ? event.label : EVENT_WHAT[event.type]) + (event.time ? ' · ' + event.time + ' KST' : ''),
      badge: event.days === 0 ? 'D-DAY' : 'D-' + event.days,
      badgeCls: 'badge nodot ' + (event.type === 'deadline' && event.days <= 7 ? 's-warn' : 's-neutral'),
      open: () => app.openDetail(item.id),
    }));
  // Exhibitions add their closing day ("전시 종료일"), as in the design's demo schedule.
  const exhibits = (app.allItems?.() ?? []).filter(item => item.type === 'exhibit' && item.exhibitEnd && item.exhibitDaysLeft <= SCHEDULE_DAYS)
    .map(item => ({ item, event: { date: item.exhibitEnd, days: item.exhibitDaysLeft } }));
  const merged = [...schedule.map(entry => ({ entry, date: entry.date })), ...exhibits.map(({ item, event }) => ({ date: event.date, entry: {
    mon: Number(event.date.slice(5, 7)) + '월', day: event.date.slice(8, 10), title: item.title, what: '전시 종료일 · ' + item.phase,
    badge: event.days === 0 ? 'D-DAY' : 'D-' + event.days, badgeCls: 'badge nodot s-neutral', open: () => app.openDetail(item.id) } }))]
    .sort((a, b) => a.date.localeCompare(b.date)).slice(0, 6).map(({ entry }) => entry);
  const values = { schedule: merged, hasSchedule: merged.length > 0 };
  const shown = v.isDetail ? (app.allItems?.() ?? []).find(item => item.id === s.detailId && item.type === 'exhibit') : null;
  if (shown && v.d) {
    // "일정에 추가" opens a Google Calendar event for the chosen visit day instead of the demo toast.
    values.d = { ...v.d, visitDates: shown.exhibitVisits.map(visit => ({ label: visit.label, pick: () => {
      app.setState({ visitOpen: false }); app.openExternal(visitCalendarLink(shown.exhibitEvent, visit.date));
    } })) };
  }
  const current = v.isDetail ? all.find(item => item.id === s.detailId) : null;
  if (current) {
    const deadline = (current.contestEvents ?? []).find(event => event.type === 'deadline');
    values.addDeadline = () => {
      const url = deadline && calendarLink(current.title, { ...deadline, label: '접수 마감' });
      if (url) app.openExternal(url);
      else app.toast('다가오는 마감일이 없어 캘린더에 추가할 수 없어요.');
    };
  }
  return values;
}

/** account_links row (with ig_accounts embedded) → the design's connection fields. */
export function linkState(link) {
  if (!link) return { connected: false, account: '', connectedAt: '' };
  const username = link.ig_accounts?.username;
  return { connected: true, account: username ? '@' + username : 'Instagram 계정 (아이디 확인 전)',
    connectedAt: stamp(new Date(link.linked_at)) };
}
