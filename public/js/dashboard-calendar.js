import CalendarModel from './calendar-model.js';

import { VALID_TIME, validCalendarDate, calendarContent, SCHEDULE_TYPES as TYPES } from './calendar-rules.js';
import { browserId, importLocalEvents, memberErrorText } from './member-sync.js';
import { REMINDER_KEYS, REMINDER_OPTIONS, reminderAt, reminderText, reminderStatus, kstLabel } from './reminder-rules.js';

export { validCalendarDate, calendarContent };
const koreaNow = () => new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Seoul' }));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const shift = (day, days) => { const d = new Date(day + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + days); return d.toISOString().slice(0, 10); };

const JOB_STATUSES = ['scheduled', 'sending', 'sent', 'cancelled', 'skipped', 'failed', 'unknown'];
/**
 * A server event → the design model's event. dm/rem are the stored options; jobs are the server's real send states
 * (only these are shown as sent/scheduled, never a time-based guess).
 */
export function serverEvent(e) {
  if (!e || !UUID.test(e.id ?? '') || !/^fc[1-9]\d*(-\d+)?$/.test(e.content_id ?? '') || !['cook', 'visit', 'deadline', 'prep', 'result'].includes(e.kind)
    || !validCalendarDate(e.date) || (e.time !== null && !VALID_TIME.test(e.time)) || !Number.isSafeInteger(e.revision)) throw new Error('Invalid event');
  const rem = REMINDER_KEYS.filter(key => Array.isArray(e.reminders) && e.reminders.includes(key));
  const jobs = (Array.isArray(e.reminder_jobs) ? e.reminder_jobs : []).filter(job => REMINDER_KEYS.includes(job?.key)
    && JOB_STATUSES.includes(job.status) && Number.isFinite(Date.parse(job.scheduled_at)))
    .map(job => ({ key: job.key, scheduled_at: job.scheduled_at, status: job.status, reason: typeof job.reason === 'string' ? job.reason : null }));
  return { id: e.id, item: e.content_id, kind: e.kind, date: e.date, time: e.time, revision: e.revision, dm: rem.length > 0, rem, jobs };
}
/** Options to send: none when the switch is off; "1시간 전" only for timed schedules. */
const chosenReminders = (dm, rem, time) => (dm ? REMINDER_KEYS.filter(key => (rem || []).includes(key) && !(key === 'h1' && !time)) : []);
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
  // reminders_available comes from the server (feature switch + worker configured); eligibility is the 24-hour window.
  let reminders = { available: false, eligibility: null, at: 0 }; let quietToggleToast = false;
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
      reminders = { available: result.reminders_available === true, eligibility: result.dm_eligibility ?? null, at: Date.now() };
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
      contextKey = nextKey; generation++; ranges = []; busy = false; reminders = { available: false, eligibility: null, at: 0 };
      loadState = live() && uid() && api ? 'loading' : 'idle';
      calendar.state = { ...structuredClone(demoState), cursor: today.slice(0, 7) + '-01', sel: today };
      if (live()) { calendar.state.events = []; calendar.state.seq = 1; }
      if (loadState === 'loading') loadRange(...initial);
    }
    // Month view shows up to six weeks around the cursor; browsing beyond the first year+two fetches that window too.
    if (live() && uid() && loadState === 'ready') { const cursor = calendar.state.cursor; loadRange(shift(cursor, -7), shift(cursor, 42)); }
    // Send states change on the server (worker); refresh them while the calendar is in use, at most every 2 minutes.
    if (live() && uid() && loadState === 'ready' && reminders.available && !busy && Date.now() - reminders.at > 120000) {
      reminders.at = Date.now(); ranges = ranges.filter(r => !(r[0] === initial[0] && r[1] === initial[1])); loadRange(...initial);
    }
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
      if (!m && after.length === before.length) {
        // The DM switch on a schedule card: change only the reminder options (a new revision on the server).
        const next = after.find(x => { const b = before.find(y => y.id === x.id); return b && b.dm !== x.dm; });
        const old = next && before.find(e => e.id === next.id);
        if (!next) return false;
        quietToggleToast = true;
        if (!reminders.available) { app.toast('DM 리마인드는 아직 준비 중이에요.'); return false; }
        const options = chosenReminders(next.dm, old.rem.length ? old.rem : ['day9'], old.time);
        send('save', run, () => api.updateEvent(old.id, { content_id: old.item, kind: old.kind, date: old.date, time: old.time ?? null,
          timezone: 'Asia/Seoul', revision: old.revision, reminders: options }), result => {
          apply({ events: merge([serverEvent(result)]) });
          app.toast(options.length ? 'DM 리마인드를 켰어요' : 'DM 리마인드를 껐어요');
        });
        return false;
      }
      if (!m || after.length > before.length + 1) return false;
      const ev = m.id ? after.find(e => e.id === m.id) : after.at(-1);
      if (!ev) return false;
      const fields = { content_id: ev.item, kind: ev.kind, date: ev.date, time: ev.time ?? null, timezone: 'Asia/Seoul',
        // Until the server offers reminders, they are not sent at all (an edit keeps whatever is stored).
        ...(reminders.available ? { reminders: chosenReminders(m.dm, m.rem, ev.time ?? null) } : {}) };
      const old = m.id ? before.find(e => e.id === m.id) : null;
      // One key per draft: a retry after a lost answer returns the same schedule instead of a second one.
      m.idem ||= 'ev:' + (globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`);
      send('save', run, () => (old ? api.updateEvent(old.id, { ...fields, revision: old.revision }) : api.createEvent(fields, m.idem)), result => {
        const saved = serverEvent(result);
        apply({ events: merge([saved]), modal: null, sel: saved.date, cursor: saved.date.slice(0, 7) + '-01' });
        app.ensureReferences?.([saved.item]);
        const scheduled = saved.jobs.filter(job => job.status === 'scheduled').length;
        app.toast(calendar.dlabel(saved.date) + ' 일정을 ' + (old ? '수정' : '등록') + '했어요' + (scheduled ? ' · DM 알림 ' + scheduled + '개 예약' : ''));
      });
      return false;
    }
    calendar.state = { ...calendar.state, ...patch };
    refresh();
    return true;
  };
  calendar.toast = (...args) => {
    if (quietDeleteToast && args[0] === '일정을 삭제했어요.') { quietDeleteToast = false; return; }
    if (quietToggleToast && /^DM 리마인드를 (켰|껐)어요$/.test(args[0])) { quietToggleToast = false; return; }
    return app.toast(...args);
  };
  const openModal = calendar.openModal.bind(calendar);
  // Real reminders are opt-in: a new schedule starts with the switch off ("당일 오전 9시" ready to pick).
  calendar.openModal = base => {
    openModal(base);
    if (!live() || !calendar.state.modal) return;
    const m = calendar.state.modal;
    calendar.state.modal = !reminders.available ? { ...m, dm: false, rem: [] } : m.mode === 'add' ? { ...m, dm: false, rem: ['day9'] } : m;
  };
  const save = calendar.save.bind(calendar);
  calendar.save = () => {
    const m = calendar.state.modal; const c = m && constants.CONTENT[m.item];
    const fixed = c?.fixed?.[m.kind];
    if (busy) return;
    if (!c || !constants.KINDS[c.type].some(([kind]) => kind === m.kind) || !validCalendarDate(m.date)
      || !calendar.dayOk(m.item, m.date) || (!m.allDay && !VALID_TIME.test(m.time))
      || (fixed && (m.date !== fixed[0] || (m.allDay ? null : m.time) !== fixed[1]))) return app.toast('콘텐츠와 날짜·시간을 확인해 주세요.');
    if (live() && !reminders.available) { m.dm = false; m.rem = []; }
    save();
  };
  /** The 24-hour rule in the member's words, from the server's dm_eligibility. */
  function windowNote() {
    const e = reminders.eligibility;
    const rule = 'Instagram 정책상 @dimi_in은 회원님이 마지막으로 DM을 보낸 뒤 24시간 안에만 알림을 보낼 수 있어요.';
    if (!e) return rule;
    if (e.reason === 'not_linked') return 'Instagram 계정을 연결해야 DM 알림을 받을 수 있어요.';
    if (e.eligible_now && e.window_ends_at) return rule + ' 지금은 ' + kstLabel(new Date(e.window_ends_at), new Date()) + '까지 보낼 수 있어요.';
    return rule + ' 지금은 보낼 수 없어요. 알림 시각 전 24시간 안에 @dimi_in에 DM을 보내 주세요.';
  }
  const optionLabel = key => REMINDER_OPTIONS.find(([k]) => k === key)[1];
  /** Real send states on cards, the real upcoming list, and a preview of the exact DM text. */
  function liveReminders(v, mobile) {
    const byId = new Map(calendar.state.events.map(e => [e.id, e]));
    const decorate = e => {
      const ev = byId.get(e.id); if (!ev) return e;
      const rems = ev.dm ? ev.rem.flatMap(key => {
        const job = ev.jobs.find(j => j.key === key);
        const at = job ? new Date(job.scheduled_at) : reminderAt(key, ev.date, ev.time);
        if (!at) return [];
        const s = reminderStatus(job); const detail = s.tone === 'off' && job ? s.long : '';
        return [{ at: kstLabel(at, new Date()), st: s.short, stCls: 'st st-' + s.tone,
          label: optionLabel(key) + (mobile ? ' · ' + (detail || s.short) : detail ? ' · ' + detail : '') }];
      }) : [];
      return { ...e, rems, noRems: rems.length === 0, hasBell: rems.length > 0, remCount: rems.length };
    };
    v.selEvents = v.selEvents.map(decorate);
    v.weekCols = v.weekCols.map(w => ({ ...w, evs: w.evs.map(decorate) }));
    v.cells = v.cells.map(c => ({ ...c, evs: c.evs.map(decorate) }));
    const nowMs = Date.now();
    const ups = calendar.state.events.filter(e => e.dm && constants.CONTENT[e.item]).flatMap(e => e.jobs
      .filter(job => job.status === 'scheduled' && Date.parse(job.scheduled_at) >= nowMs).map(job => ({ e, at: new Date(job.scheduled_at) })))
      .sort((a, b) => a.at - b.at);
    v.upCount = ups.length;
    v.upcoming = ups.slice(0, 5).map(({ e, at }) => { const c = constants.CONTENT[e.item];
      return { title: c.title, at: kstLabel(at, new Date()), kind: constants.KSHORT[e.kind], dot: 'dot t-' + c.type,
        aria: kstLabel(at, new Date()) + ' ' + c.title + ' 일정으로 이동', pick: () => calendar.setState({ sel: e.date, cursor: e.date.slice(0, 7) + '-01' }) }; });
    const m = calendar.state.modal; const c = m?.item ? constants.CONTENT[m.item] : null;
    if (m && c) {
      const time = m.allDay ? null : (m.time || null);
      const first = chosenReminders(m.dm, m.rem, time)[0]; const at = first ? reminderAt(first, m.date, time) : null;
      v.showPreview = Boolean(at);
      if (at) {
        v.previewAt = kstLabel(at, new Date());
        v.previewText = reminderText({ kind: m.kind, date: m.date, time, title: c.title, contentId: m.item,
          publicUrl: globalThis.location?.origin, now: at });
      }
      v.footHint = m.dm ? '알림 시각에 @dimi_in이 DM을 보내요. 그 시각이 마지막 DM 후 24시간을 넘기면 보내지 않고 상태로 알려 드려요.'
        : 'DM 리마인드 없이 캘린더에만 표시돼요.';
    }
  }
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
            : '일정은 내 계정에 저장돼 다른 기기에서도 보여요. 시간은 한국 시간(KST) 기준이에요.'
              + (reminders.available ? '' : ' DM 리마인드는 준비 중이에요.');
      const on = live() && reminders.available;
      v.dmUnavailable = live() && !reminders.available;
      v.upcomingTitle = live() && !on ? '다가오는 일정' : '다가오는 DM 리마인드';
      v.reminderNote = !live() ? '@dimi_in의 리마인드 화면 예시예요. 실제 DM을 보내지 않아요.' : on ? windowNote() : 'DM 리마인드는 준비 중이에요. 현재는 일정만 저장돼요.';
      v.openFullContent = () => { const id = calendar.state.viewItem; calendar.setState({ viewItem: null, viewEv: null }); app.openDetail(id); };
      if (on) liveReminders(v, mobile);
      else if (live()) {
        v.remOpts = v.remOpts.map(option => ({ ...option, disabled: true, pressed: 'false', cls: 'chip' }));
        v.showPreview = false; v.footHint = '내 계정에 일정을 저장해요. DM 리마인드는 준비 중이에요.';
      }
      if (live()) {
        v.saveDisabled ||= busy || loadState !== 'ready' || !calendar.state.modal?.item || !calendar.dayOk(calendar.state.modal.item, calendar.state.modal.date);
        if (busy) v.saveLabel = '저장 중…';
      }
      if (live() && !on) {
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
