import CalendarModel from './calendar-model.js';

const TYPES = ['recipe', 'exhibit', 'contest', 'restaurant', 'space'];
const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
export function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(value + 'T12:00:00');
  return Number.isFinite(+date) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8));
}
const koreaNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));

export function calendarContent(item) {
  const event = item.exhibitEvent;
  const facts = item.type === 'recipe' ? [['인분', item.serving], ['준비', item.prep], ['조리', item.cook]]
    : item.type === 'exhibit' ? [['기간', item.period], ['운영', item.hours], ['휴무', item.closed], ['장소', item.place], ['입장료', item.fee]]
      : item.type === 'contest' ? [['주최', item.host], ['마감', item.deadline]]
        : [['분류', item.category], ['주소', item.address], ['운영', item.hours], ['휴무', item.closed], ['예약', item.reservation],
          ...(item.type === 'restaurant' ? [['가격대', item.priceRange]] : [])];
  const fixed = Object.fromEntries((item.contestEvents || []).filter(e => ['deadline', 'announce'].includes(e.type) && validCalendarDate(e.date))
    .map(e => [e.type === 'announce' ? 'result' : 'deadline', [e.date, VALID_TIME.test(e.time) ? e.time : null]]));
  return { type: item.type, title: item.title, sub: item.key || '', summary: item.summary || item.intro || '',
    facts: facts.filter(([, value]) => value), fixed,
    ...(event && validCalendarDate(event.start) && validCalendarDate(event.end) ? { from: event.start, to: event.end, closed: [] } : {}),
    listTitle: item.type === 'recipe' ? '재료' : item.type === 'contest' ? '지원 대상' : '',
    list: item.type === 'recipe' ? (item.ingredients || []).map(g => [g.name, g.qty, g.miss]) : (item.elig || []).map(value => [value, '']),
  };
}

// Interim schedules stay per member in this browser until the backend CRUD is ready.
export function createCalendarDashboard(app, storage, now = koreaNow) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const calendar = new CalendarModel({ theme: 'light' });
  const demoState = structuredClone(calendar.state);
  const baseConsts = calendar.consts();
  const today = calendar.key(now());
  let contextKey; let constants = baseConsts; let storageFailed = false;
  calendar.consts = () => constants;
  const live = () => app.state.mode === 'live';
  const key = () => 'dimi-calendar:v1:' + app.state.user?.id;
  function validEvents(value) {
    if (!Array.isArray(value) || value.length > 500) throw new Error('Invalid saved calendar');
    const ids = new Set();
    return value.map(e => {
      if (!e || !Number.isSafeInteger(e.id) || e.id < 1 || ids.has(e.id) || typeof e.item !== 'string'
        || !/^[\w-]{1,100}$/.test(e.item) || !['cook', 'visit', 'deadline', 'prep', 'result'].includes(e.kind)
        || !validCalendarDate(e.date) || (e.time !== null && !VALID_TIME.test(e.time))) throw new Error('Invalid saved event');
      ids.add(e.id);
      return { id: e.id, item: e.item, kind: e.kind, date: e.date, time: e.time, dm: false, rem: [] };
    });
  }
  function sync() {
    const nextKey = live() ? (app.state.user?.id || 'signed-out') : 'demo';
    if (nextKey !== contextKey) {
      contextKey = nextKey; storageFailed = live() && !storage;
      calendar.state = { ...structuredClone(demoState), cursor: today.slice(0, 7) + '-01', sel: today };
      if (live()) {
        calendar.state.events = [];
        if (app.state.user?.id) {
          try { calendar.state.events = validEvents(JSON.parse(storage?.getItem(key()) || '[]')); }
          catch { storageFailed = true; }
        }
        calendar.state.seq = Math.max(0, ...calendar.state.events.map(e => e.id)) + 1;
      }
    }
    constants = { ...baseConsts, NOW: now(), CONTENT: live() ? Object.fromEntries(app.allItems()
      .filter(item => item.status === 'done' && TYPES.includes(item.type)).map(item => [item.id, calendarContent(item)])) : baseConsts.CONTENT };
  }
  calendar.setState = update => {
    const patch = typeof update === 'function' ? update(calendar.state) : update;
    if (live() && patch.events) {
      if (!app.state.user?.id) { app.toast('로그인한 뒤 일정을 저장해 주세요.'); return false; }
      try { storage.setItem(key(), JSON.stringify(validEvents(patch.events))); storageFailed = false; }
      catch { storageFailed = true; app.toast('일정을 저장하지 못했어요. 브라우저 저장 공간을 확인해 주세요.'); return false; }
    }
    calendar.state = { ...calendar.state, ...patch };
    app.setState({ calendarRevision: (app.state.calendarRevision || 0) + 1 });
    return true;
  };
  calendar.toast = (...args) => app.toast(...args);
  const openModal = calendar.openModal.bind(calendar);
  calendar.openModal = base => { openModal(base); if (live()) calendar.state.modal = { ...calendar.state.modal, dm: false, rem: [] }; };
  const save = calendar.save.bind(calendar);
  calendar.save = () => {
    const m = calendar.state.modal; const c = m && constants.CONTENT[m.item];
    const fixed = c?.fixed?.[m.kind];
    if (!c || !constants.KINDS[c.type].some(([kind]) => kind === m.kind) || !validCalendarDate(m.date)
      || !calendar.dayOk(m.item, m.date) || (!m.allDay && !VALID_TIME.test(m.time))
      || (fixed && (m.date !== fixed[0] || (m.allDay ? null : m.time) !== fixed[1]))) return app.toast('콘텐츠와 날짜·시간을 확인해 주세요.');
    if (!m.id && calendar.state.events.length >= 500) return app.toast('일정이 500개예요. 지난 일정을 정리해 주세요.');
    if (live()) { m.dm = false; m.rem = []; }
    save();
  };
  return {
    model: calendar,
    close: () => calendar.setState({ modal: null, viewItem: null, viewEv: null }),
    values() {
      sync();
      const v = calendar.renderVals();
      v.noContentOptions = !v.contentOpts.length;
      v.themeClass = app.state.dark ? 'dark' : '';
      v.storageNote = live() ? (storageFailed ? '이 브라우저의 일정을 불러오거나 저장하지 못했어요.' : '일정은 현재 브라우저에 계정별로 저장돼요. 시간은 한국 시간(KST) 기준이에요. 기기 간 동기화와 DM 리마인드는 준비 중이에요.')
        : '예시 일정이에요. 데모의 DM 리마인드는 실제로 전송되지 않아요.';
      v.dmUnavailable = live(); v.upcomingTitle = live() ? '다가오는 일정' : '다가오는 DM 리마인드';
      v.reminderNote = live() ? 'DM 리마인드는 준비 중이에요. 현재는 일정만 저장돼요.' : '@dimi_in의 리마인드 화면 예시예요. 실제 DM을 보내지 않아요.';
      v.openFullContent = () => { const id = calendar.state.viewItem; calendar.setState({ viewItem: null, viewEv: null }); app.openDetail(id); };
      if (live()) {
        v.saveDisabled ||= !calendar.state.modal?.item || !calendar.dayOk(calendar.state.modal.item, calendar.state.modal.date);
        v.remOpts = v.remOpts.map(option => ({ ...option, disabled: true, pressed: 'false', cls: 'chip' }));
        v.showPreview = false; v.footHint = '현재 브라우저에 일정을 저장해요. DM 리마인드는 준비 중이에요.';
        const events = calendar.state.events.filter(e => constants.CONTENT[e.item] && e.date >= calendar.key(constants.NOW))
          .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
        v.upCount = events.length;
        v.upcoming = events.slice(0, 5).map(e => ({ title: constants.CONTENT[e.item].title, at: e.date.slice(5).replace('-', '/') + ' ' + (e.time || '종일'),
          kind: constants.KSHORT[e.kind], dot: 'dot t-' + constants.CONTENT[e.item].type, aria: e.date + ' 일정으로 이동',
          pick: () => calendar.setState({ sel: e.date, cursor: e.date.slice(0, 7) + '-01' }) }));
      }
      return v;
    },
  };
}
