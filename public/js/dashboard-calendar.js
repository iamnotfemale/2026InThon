import CalendarModel from './calendar-model.js';

import { VALID_TIME, validCalendarDate, calendarContent, SCHEDULE_TYPES as TYPES } from './calendar-rules.js';
import { browserId, importLocalEvents, memberErrorText } from './member-sync.js';

export { validCalendarDate, calendarContent };
const koreaNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shift = (day, days) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

/** A server event → the design model's event (reminders stay off until real DM reminders exist). */
export function serverEvent(e) {
  if (!e || !UUID.test(e.id ?? '') || !/^fc[1-9]\d*(-\d+)?$/.test(e.content_id ?? '') || !['cook', 'visit', 'deadline', 'prep', 'result'].includes(e.kind)
    || !validCalendarDate(e.date) || (e.time !== null && !VALID_TIME.test(e.time)) || !Number.isSafeInteger(e.revision)) throw new Error('Invalid event');
  return { id: e.id, item: e.content_id, kind: e.kind, date: e.date, time: e.time, revision: e.revision, dm: false, rem: [] };
}
const serverEvents = list => list.flatMap(e => { try { return [serverEvent(e)]; } catch { return []; } });

/**
 * The supplied calendar design with the member's schedules on the server (/api/calendar). The design model saves
 * synchronously; in real-data mode every add/edit/delete is sent first and applied only after the server confirms,
 * so a failure keeps the previous schedules and the open draft. Older records from this browser are moved once.
 */
export function createCalendarDashboard(app, { api, storage, now = koreaNow } = {}) {
  if (storage === undefined) { try { storage = globalThis.localStorage; } catch { storage = null; } }
  const calendar = new CalendarModel({ theme: 'light' });
  const demoState = structuredClone(calendar.state);
  const baseConsts = calendar.consts();
  const today = calendar.key(now());
  const initial = [shift(today, -365), shift(today, 730)];
  let contextKey; let constants = baseConsts;
  let loadState = 'idle'; let ranges = []; let generation = 0; let busy = false; let quietDeleteToast = false;
  calendar.consts = () => constants;
  const live = () => app.state.mode === 'live';
  const uid = () => app.state.user?.id;
  const current = run => run === generation && live();
  const refresh = () => app.setState({ calendarRevision: (app.state.calendarRevision || 0) + 1 });
  const merge = events => {
    const byId = new Map(calendar.state.events.map(e => [e.id, e]));
    for (const e of events) byId.set(e.id, e);
    return [...byId.values()];
  };
  const apply = patch => { calendar.state = { ...calendar.state, ...patch }; refresh(); };

  /** Loads [from, to] (inclusive) unless already loaded; a late answer for an old member is dropped. */
  async function loadRange(from, to) {
    if (!api || ranges.some(([a, b]) => a <= from && to <= b)) return;
    const run = generation; const range = [from, to]; ranges.push(range);
    try {
      const result = await api.listEvents(from, to);
      if (!current(run)) return;
      const events = serverEvents(result.events);
      loadState = 'ready';
      apply({ events: merge(events) });
      app.ensureReferences?.(events.map(e => e.item));
      if (range[0] === initial[0] && range[1] === initial[1]) await importBrowserEvents(run);
    } catch (error) {
      if (!current(run)) return;
      ranges = ranges.filter(r => r !== range);
      if (loadState !== 'ready') loadState = 'error';
      refresh();
      if (error?.status === 401) app.toast(memberErrorText(error));
    }
  }
  async function importBrowserEvents(run) {
    const user = uid();
    const created = serverEvents(await importLocalEvents({ api, storage, uid: user, browser: browserId(storage) }));
    if (!current(run) || uid() !== user || !created.length) return;
    apply({ events: merge(created) });
    app.ensureReferences?.(created.map(e => e.item));
    app.toast(`이 브라우저에 있던 일정 ${created.length}개를 계정에 저장했어요. 이제 다른 기기에서도 보여요.`);
  }

  function sync() {
    const nextKey = live() ? (uid() || 'signed-out') : 'demo';
    if (nextKey !== contextKey) {
      contextKey = nextKey; generation++; ranges = []; busy = false;
      loadState = live() && uid() && api ? 'loading' : 'idle';
      calendar.state = { ...structuredClone(demoState), cursor: today.slice(0, 7) + '-01', sel: today };
      if (live()) { calendar.state.events = []; calendar.state.seq = 1; }
      if (loadState === 'loading') loadRange(...initial);
    }
    // Month view shows up to six weeks around the cursor; browsing beyond the first year+two fetches that window too.
    if (live() && uid() && loadState === 'ready') { const cursor = calendar.state.cursor; loadRange(shift(cursor, -7), shift(cursor, 42)); }
    constants = { ...baseConsts, NOW: now(), CONTENT: live() ? Object.fromEntries(app.allItems()
      .filter(item => item.status === 'done' && TYPES.includes(item.type)).map(item => [item.id, calendarContent(item)])) : baseConsts.CONTENT };
  }

  async function send(what, run, request, done) {
    busy = true; refresh();
    try {
      const result = await request();
      if (current(run)) done(result);
    } catch (error) {
      if (current(run)) app.toast(memberErrorText(error, what === 'delete' ? '일정을 삭제하지 못했어요. 다시 시도해 주세요.' : '일정을 저장하지 못했어요. 작성한 내용은 그대로 있어요.'));
    } finally {
      if (current(run)) { busy = false; refresh(); }
    }
  }

  calendar.setState = update => {
    const patch = typeof update === 'function' ? update(calendar.state) : update;
    if (live() && patch.events) {
      const before = calendar.state.events; const after = patch.events; const m = calendar.state.modal;
      if (!uid() || !api) { app.toast('로그인한 뒤 일정을 저장해 주세요.'); return false; }
      if (busy) { app.toast('저장하고 있어요. 잠시만 기다려 주세요.'); return false; }
      const run = generation;
      if (after.length < before.length) {
        const gone = before.find(e => !after.some(x => x.id === e.id));
        quietDeleteToast = true;   // the design toasts right away; we toast once the server confirms
        send('delete', run, () => api.deleteEvent(gone.id), () => {
          apply({ events: calendar.state.events.filter(e => e.id !== gone.id), viewItem: null, viewEv: null });
          app.toast('일정을 삭제했어요.');
        });
        return false;
      }
      if (!m || after.length > before.length + 1) return false;   // e.g. the design's DM switch: reminders are not available yet
      const ev = m.id ? after.find(e => e.id === m.id) : after.at(-1);
      if (!ev) return false;
      const fields = { content_id: ev.item, kind: ev.kind, date: ev.date, time: ev.time ?? null, timezone: 'Asia/Seoul' };
      const old = m.id ? before.find(e => e.id === m.id) : null;
      // One key per draft: a retry after a lost answer returns the same schedule instead of a second one.
      m.idem ||= 'ev:' + (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      send('save', run, () => (old ? api.updateEvent(old.id, { ...fields, revision: old.revision }) : api.createEvent(fields, m.idem)), result => {
        const saved = serverEvent(result);
        apply({ events: merge([saved]), modal: null, sel: saved.date, cursor: saved.date.slice(0, 7) + '-01' });
        app.ensureReferences?.([saved.item]);
        app.toast(calendar.dlabel(saved.date) + ' 일정을 ' + (old ? '수정' : '등록') + '했어요');
      });
      return false;
    }
    calendar.state = { ...calendar.state, ...patch };
    refresh();
    return true;
  };
  calendar.toast = (...args) => {
    if (quietDeleteToast && args[0] === '일정을 삭제했어요.') { quietDeleteToast = false; return; }
    return app.toast(...args);
  };
  const openModal = calendar.openModal.bind(calendar);
  calendar.openModal = base => { openModal(base); if (live()) calendar.state.modal = { ...calendar.state.modal, dm: false, rem: [] }; };
  const save = calendar.save.bind(calendar);
  calendar.save = () => {
    const m = calendar.state.modal; const c = m && constants.CONTENT[m.item];
    const fixed = c?.fixed?.[m.kind];
    if (busy) return;
    if (!c || !constants.KINDS[c.type].some(([kind]) => kind === m.kind) || !validCalendarDate(m.date)
      || !calendar.dayOk(m.item, m.date) || (!m.allDay && !VALID_TIME.test(m.time))
      || (fixed && (m.date !== fixed[0] || (m.allDay ? null : m.time) !== fixed[1]))) return app.toast('콘텐츠와 날짜·시간을 확인해 주세요.');
    if (live()) { m.dm = false; m.rem = []; }
    save();
  };
  const futureEvents = () => {
    const today = calendar.key(constants.NOW);
    const time = calendar.p2(constants.NOW.getHours()) + ':' + calendar.p2(constants.NOW.getMinutes());
    return calendar.state.events.filter(e => constants.CONTENT[e.item]
      && (e.date > today || (e.date === today && (!e.time || e.time >= time))))
      .sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
  };
  return {
    model: calendar,
    referencedIds: () => (live() ? calendar.state.events.map(e => e.item) : []),
    close: () => calendar.setState({ modal: null, viewItem: null, viewEv: null }),
    homeValues() {
      sync();
      const today = calendar.key(constants.NOW);
      const schedule = futureEvents().slice(0, 6).map(e => {
        const days = Math.round((Date.parse(e.date + 'T00:00:00Z') - Date.parse(today + 'T00:00:00Z')) / 86400000);
        return { id: e.id, mon: Number(e.date.slice(5, 7)) + '월', day: e.date.slice(8, 10), title: constants.CONTENT[e.item].title,
          what: constants.KLABEL[e.kind] + (e.time ? ' · ' + e.time + ' KST' : ' · 종일'),
          badge: days === 0 ? 'D-DAY' : 'D-' + days,
          badgeCls: 'badge nodot ' + (e.kind === 'deadline' && days <= 7 ? 's-warn' : 's-neutral'),
          open: () => { calendar.setState({ sel: e.date, cursor: e.date.slice(0, 7) + '-01', viewItem: null, viewEv: null }); app.go('calendar'); } };
      });
      return { schedule, hasSchedule: schedule.length > 0 || (live() && ['loading', 'error'].includes(loadState)),
        scheduleNote: loadState === 'loading' ? '캘린더에 등록한 일정을 불러오고 있어요…'
          : loadState === 'error' ? '일정을 불러오지 못했어요. 새로고침 후 다시 확인해 주세요.'
            : '캘린더에 등록한 일정이에요. 시간은 한국 시간(KST) 기준이에요.' };
    },
    values(mobile = false) {
      sync();
      const v = calendar.renderVals();
      v.noContentOptions = !v.contentOpts.length;
      v.themeClass = app.state.dark ? 'dark' : '';
      v.showStorageStatus = live() && ['loading', 'error'].includes(loadState);
      v.storageNote = !live() ? '예시 일정이에요. 데모의 DM 리마인드는 실제로 전송되지 않아요.'
        : loadState === 'loading' ? '내 일정을 불러오고 있어요…'
          : loadState === 'error' ? '일정을 불러오지 못했어요. 새로고침하거나 잠시 후 다시 열어 주세요.'
            : '일정은 내 계정에 저장돼 다른 기기에서도 보여요. 시간은 한국 시간(KST) 기준이에요. DM 리마인드는 준비 중이에요.';
      v.dmUnavailable = live(); v.upcomingTitle = live() ? '다가오는 일정' : '다가오는 DM 리마인드';
      v.reminderNote = live() ? 'DM 리마인드는 준비 중이에요. 현재는 일정만 저장돼요.' : '@dimi_in의 리마인드 화면 예시예요. 실제 DM을 보내지 않아요.';
      v.openFullContent = () => { const id = calendar.state.viewItem; calendar.setState({ viewItem: null, viewEv: null }); app.openDetail(id); };
      if (live()) {
        v.saveDisabled ||= busy || loadState !== 'ready' || !calendar.state.modal?.item || !calendar.dayOk(calendar.state.modal.item, calendar.state.modal.date);
        if (busy) v.saveLabel = '저장 중…';
        v.remOpts = v.remOpts.map(option => ({ ...option, disabled: true, pressed: 'false', cls: 'chip' }));
        v.showPreview = false; v.footHint = '내 계정에 일정을 저장해요. DM 리마인드는 준비 중이에요.';
        const events = futureEvents();
        v.upCount = events.length;
        v.upcoming = events.slice(0, 5).map(e => ({ title: constants.CONTENT[e.item].title, at: e.date.slice(5).replace('-', '/') + ' ' + (e.time || '종일'),
          kind: constants.KSHORT[e.kind], dot: 'dot t-' + constants.CONTENT[e.item].type, aria: e.date + ' 일정으로 이동',
          pick: () => calendar.setState({ sel: e.date, cursor: e.date.slice(0, 7) + '-01' }) }));
      }
      if (mobile) {
        if (v.isWeek) v.title = v.title.replace(/(\d+)월 (\d+)일/g, '$1.$2');
        v.cells = v.cells.map(c => ({ ...c, cls: c.cls.replace(/^mc/, 'mday') + (c.numCls.includes('sun') ? ' sun' : ''),
          dots: c.evs.map(e => ({ cls: e.dot })) }));
        v.weekCols = v.weekCols.map((w, i) => ({ ...w, cls: w.cls.replace(/^wc/, 'wday') + (i === 0 ? ' sun' : ''),
          pressed: String(w.cls.includes('sel')), dots: w.evs.slice(0, 3).map(e => ({ cls: e.dot })) }));
        v.filters = v.filters.map(f => ({ ...f, cls: 'chip' + (f.pressed === 'true' ? ' on' : '') }));
        v.selEvents = v.selEvents.map(e => ({ ...e, orb: 'orb o-' + e.type }));
        v.selCount = v.selEvents.length ? '일정 ' + v.selEvents.length + '개' : '';
        v.cvEvents = v.cvEvents.map(e => ({ ...e, cls: e.cls.replace('cv-ev', 'cvev') }));
      }
      return v;
    },
  };
}
