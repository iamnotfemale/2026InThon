import { matchesContent } from './content-index.js';
import { calendarContent, koreaDay, validCalendarDate, VALID_TIME } from './calendar-rules.js';

const TYPES = [['recipe', '레시피', /레시피|요리|음식/], ['news', '뉴스·정보', /팩트\s*체크|뉴스|기사/],
  ['exhibit', '전시·팝업', /전시|팝업/], ['contest', '공모전·대외활동', /공모전|대외활동/],
  ['restaurant', '맛집', /맛집|식당/], ['space', '취향공간', /취향\s*공간|서점|공간/], ['beauty', '미용', /미용|뷰티|화장품|헤어/]];
const LABELS = Object.fromEntries(TYPES.map(([type, label]) => [type, label]));
const DAY = 86400000;
const resultText = count => count ? `관련 콘텐츠 ${count}개를 찾았어요.${count > 6 ? ' 먼저 6개를 보여드릴게요.' : ''}` : '딱 맞는 콘텐츠를 찾지 못했어요. 다른 말로 찾아볼까요?';

function candidates(items, query, state, now) {
  const types = TYPES.filter(([, , pattern]) => pattern.test(query)).map(([type]) => type);
  let pool = items.filter(item => (!types.length || types.includes(item.type)) && (!/내\s*취향|취향에\s*모/.test(query) || state.taste?.[item.id]));
  const today = koreaDay(new Date(now));
  if (/오늘|어제/.test(query)) {
    const day = /어제/.test(query) ? koreaDay(new Date(now - DAY)) : today;
    pool = pool.filter(item => Number.isFinite(Number(item.ts)) && koreaDay(new Date(Number(item.ts))) === day);
  } else if (/이번\s*주|최근|요즘/.test(query)) {
    const start = Date.parse(today + 'T00:00:00+09:00');
    const weekday = new Date(start + 9 * 3600000).getUTCDay();
    const since = /이번\s*주/.test(query) ? start - ((weekday + 6) % 7) * DAY : now - 7 * DAY;
    pool = pool.filter(item => Number(item.ts) >= since);
  }
  if (/마감/.test(query)) {
    const deadline = item => {
      const event = item.contestEvents?.find(event => event.type === 'deadline' && validCalendarDate(event.date));
      return event ? Date.parse(`${event.date}T${VALID_TIME.test(event.time) ? event.time : '23:59'}:00+09:00`) : Infinity;
    };
    pool = pool.filter(item => item.type === 'contest' && Number.isFinite(deadline(item)) && deadline(item) >= now)
      .sort((a, b) => deadline(a) - deadline(b));
  }
  let keyword = query;
  for (const [, , pattern] of TYPES) keyword = keyword.replace(new RegExp(pattern.source, 'g'), ' ');
  keyword = keyword.replace(/찾아\s*줘|보여\s*줘|알려\s*줘|추천\s*해\s*줘|지난번|저번|보냈던|보낸|저장한|정리한|콘텐츠|이번\s*주|최근|요즘|오늘|어제|내\s*취향|취향|모은|모음|마감\s*임박|마감|가볼\s*만한|있어\??/g, ' ')
    .replace(/[?!.,“”‘’]/g, ' ').split(/\s+/).map(word => word.replace(/(?:에서|으로|했던|한|을|를|은|는|에|만|줘|요)$/, '')).filter(word => word && !['것', '것들'].includes(word)).join(' ');
  return { pool, keyword, local: pool.filter(item => matchesContent(item, keyword)) };
}

// Typing stays local; submitted free text uses Gemini, while shortcut buttons reuse search.
export function createHomeChat(app, { now = () => Date.now(), pause = ms => new Promise(resolve => setTimeout(resolve, ms)) } = {}) {
  let context, query = '', messages = [], selectedId = null, busy = false, generation = 0, controller, scroll;
  const key = () => [app.state.mode, app.state.user?.id, app.state.account].join(':');
  const sync = () => {
    if (context === key()) return;
    context = key(); generation++; controller?.abort(); query = ''; messages = []; selectedId = null; busy = false;
  };
  const refresh = () => app.setState({ homeChatRevision: (app.state.homeChatRevision || 0) + 1 }, () => {
    if (scroll) scroll.scrollTop = scroll.scrollHeight;
  });
  const items = () => app.allItems().filter(item => item.status === 'done' && LABELS[item.type]).slice().sort((a, b) => b.ts - a.ts);
  const open = id => { selectedId = id; query = ''; refresh(); };
  const decorate = item => {
    const stamp = item.ts == null ? NaN : Number(item.ts);
    const when = app.state.mode === 'demo' ? item.received || '' : Number.isFinite(stamp)
      ? new Intl.DateTimeFormat('ko-KR', { timeZone: 'Asia/Seoul', month: 'numeric', day: 'numeric' }).format(new Date(stamp)) : '';
    return { ...item, orb: 'o-' + item.type, dot: 'dot t-' + item.type, typeLabel: LABELS[item.type], when,
      receivedLabel: when ? when + ' 받음' : '받은 시각 미확인', taste: !!app.state.taste?.[item.id], open: () => open(item.id) };
  };
  async function ask(raw, shortcut = false) {
    sync();
    const text = String(raw || '').trim().slice(0, 1000);
    if (!text || busy || (shortcut && (app.state.libLoading || app.state.libError))) return;
    const scope = candidates(items(), text, app.state, now());
    const history = messages.filter(m => !m.typing && !m.fallback).slice(-12).map(m => ({ role: m.me ? 'user' : 'model',
      text: (m.text || resultText(m.ids?.length || 0)).slice(0, 3000), ids: (m.ids || []).slice(0, 6) }));
    const focusedId = selectedId;
    const typingTime = pause(1500);
    const run = ++generation; const owner = context;
    const bot = { id: run + '-bot', bot: true, typing: true, query: text, ids: [] };
    messages = [...messages, { id: run + '-me', me: true, text }, bot].slice(-12);
    query = ''; selectedId = null; busy = true; app.go('home', { homeChatActive: true }); refresh();
    let ids = scope.local.map(item => item.id); let fallback = false; let answer = '';
    try {
      if (!shortcut && app.state.mode === 'live') {
        controller = new AbortController();
        const result = await app.chatRequest({ query: text, history, focusedId }, controller.signal);
        if (typeof result.reply !== 'string' || !result.reply.trim() || !Array.isArray(result.ids)) throw new Error('Invalid chat response');
        const allowed = new Set(items().map(item => item.id));
        ids = [...new Set(result.ids)].filter(id => allowed.has(id)).slice(0, 6);
        answer = result.reply;
      } else if (scope.keyword && scope.pool.length && app.state.mode === 'live') {
        controller = new AbortController();
        const result = await app.indexRequest({ action: 'search', query: text }, controller.signal);
        if (!Array.isArray(result.ids)) throw new Error('Invalid search results');
        const allowed = new Set(scope.pool.map(item => item.id));
        ids = [...new Set(result.ids)].filter(id => allowed.has(id));
      }
    } catch (error) {
      if (error.name === 'AbortError') return;
      fallback = true;
    } finally {
      await typingTime;
      if (run === generation && owner === key()) {
        messages = messages.map(message => message.id === bot.id ? { ...message, ids, text: answer, typing: false, fallback, demo: !shortcut && app.state.mode !== 'live' } : message);
        busy = false; refresh();
      }
    }
  }
  const reset = () => { generation++; controller?.abort(); query = ''; messages = []; selectedId = null; busy = false; refresh(); };
  return {
    reset,
    destroy() { generation++; controller?.abort(); },
    escape() { if (!selectedId && !query) return false; selectedId = null; query = ''; refresh(); return true; },
    values() {
      sync();
      const all = items(); const byId = new Map(all.map(item => [item.id, item]));
      const selected = byId.get(selectedId);
      const suggestion = query.trim() ? candidates(all, query.trim(), app.state, now()).local.slice(0, 4).map(decorate) : [];
      const recent = all.slice(0, 6).map(decorate);
      const msgs = messages.map(message => {
        if (message.me) return { ...message, bot: false };
        const found = message.ids.map(id => byId.get(id)).filter(Boolean);
        const text = message.text || resultText(found.length);
        return { ...message, me: false, ready: !message.typing, hasRes: !!found.length,
          text: message.fallback ? '지금은 답변을 마치지 못했어요. 잠시 후 다시 이야기해 주세요.' + (found.length ? ' 저장된 내용에서 찾은 카드는 아래에 있어요.' : '')
            : (message.demo ? '미리보기에서는 검색만 가능해요. 로그인하면 디미와 대화할 수 있어요. ' : '') + text,
          results: found.slice(0, 6).map(decorate), follow: [
            { label: '최근 보낸 콘텐츠', pick: () => ask('최근 보낸 콘텐츠 보여줘', true) },
            { label: '내 취향에서 찾기', pick: () => ask('내 취향에 모은 것 보여줘', true) },
            { label: '목록으로 보기', pick: () => app.go('library') }] };
      });
      const source = selected?.origin;
      const hasOrigin = typeof source === 'string' && /^https:\/\/(www\.)?instagram\.com\/(p|reels?)\//.test(source);
      const facts = selected ? calendarContent(selected).facts.filter(([, value]) => value && !/미기재/.test(value)).map(([k, v]) => ({ k, v })) : [];
      if (selected?.type === 'recipe') {
        if (selected.key) facts.push({ k: '정리', v: selected.key });
        if (selected.ingredients?.length) facts.push({ k: '재료', v: selected.ingredients.map(item => item.name).join(' · ') });
      } else if (!facts.length && selected?.key) facts.push({ k: '정리', v: selected.key });
      const notice = app.state.libLoading ? '콘텐츠를 불러오고 있어요.' : app.state.libError ? '콘텐츠를 불러오지 못했어요.'
        : app.state.connected ? '아직 정리한 콘텐츠가 없어요.' : 'Instagram을 연결하면 보낸 콘텐츠를 여기서 찾을 수 있어요.';
      return {
        greeting: app.state.mode === 'live' && app.state.name ? `${app.state.name}님, 무엇을 다시 꺼내드릴까요?` : '무엇을 다시 꺼내드릴까요?',
        query, total: all.length, empty: app.state.homeChatActive === false || !messages.length, chatting: app.state.homeChatActive !== false && !!messages.length, msgs,
        inputDisabled: busy,
        sendDisabled: busy || !query.trim(),
        onChange: event => { query = event.target.value.slice(0, 1000); app.setState({ homeChatRevision: (app.state.homeChatRevision || 0) + 1 }); },
        inputKey: event => { if (event.key === 'Enter' && event.isComposing) event.preventDefault(); },
        submit: event => { event.preventDefault(); return ask(query); }, askNow: () => ask(query), reset,
        quick: [['이번 주 보낸 것', 'all', '이번 주 보낸 것 보여줘'], ['매콤한 레시피', 'recipe', '매콤한 레시피 찾아줘'],
          ['마감 임박 공모전', 'contest', '마감 임박 공모전'], ['가볼 만한 전시', 'exhibit', '전시 보여줘'],
          ['팩트체크한 뉴스', 'news', '팩트체크한 뉴스 보여줘'], ['내 취향 모음', 'all', '내 취향 모음']]
          .map(([label, type, q]) => ({ label, dot: 'dot t-' + type, pick: () => ask(q, true) })),
        showSug: (app.state.homeChatActive === false || !messages.length) && !!query.trim(), sug: suggestion,
        sugLabel: suggestion.length ? '바로 찾기' : '다른 말로 찾아볼까요?', sugCount: suggestion.length ? `${suggestion.length}개` : '',
        recent, recentNone: !recent.length, recentNotice: notice,
        showNoticeAction: !app.state.libLoading && !recent.length,
        noticeActionLabel: app.state.libError ? '다시 불러오기' : app.state.connected ? 'Instagram에서 보내기' : 'Instagram 연결하기',
        noticeAction: () => app.state.libError ? app.loadLive() : app.state.connected ? app.openBotDm() : app.showLinkGuide(),
        scrollRef: element => { scroll = element; }, drawerOpen: !!selected, closeDrawer: () => { selectedId = null; refresh(); },
        d: selected ? { ...decorate(selected), summary: selected.summary || selected.intro || '', facts,
          primary: '전체 정리 보기', openFull: () => { selectedId = null; app.openDetail(selected.id); }, hasOrigin, origin: hasOrigin ? source : undefined } : {},
      };
    },
  };
}
