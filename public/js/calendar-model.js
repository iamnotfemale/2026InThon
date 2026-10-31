import { DCLogic } from './dashboard-runtime.js';

export default class CalendarModel extends DCLogic {
  constructor(props) {
    super(props);
    this.state = {
      view: 'month', cursor: '2026-11-01', sel: '2026-11-07',
      filter: { recipe: true, exhibit: true, contest: true, restaurant: true, space: true },
      events: [
        { id: 1, item: 'r1', kind: 'cook', date: '2026-11-01', time: '18:30', rem: ['h1'], dm: true },
        { id: 2, item: 'e1', kind: 'visit', date: '2026-11-07', time: '14:00', rem: ['eve', 'day9'], dm: true },
        { id: 3, item: 'c1', kind: 'prep', date: '2026-11-09', time: null, rem: ['day9'], dm: true },
        { id: 4, item: 'r2', kind: 'cook', date: '2026-11-12', time: '19:00', rem: ['h1'], dm: true },
        { id: 5, item: 'c1', kind: 'deadline', date: '2026-11-14', time: '18:00', rem: ['d3', 'day9'], dm: true },
        { id: 6, item: 'r4', kind: 'cook', date: '2026-11-21', time: '12:30', rem: ['day9'], dm: false },
        { id: 7, item: 'c1', kind: 'result', date: '2026-11-28', time: null, rem: ['day9'], dm: true }
      ],
      seq: 8, viewItem: null, viewEv: null, modal: null, toast: null, dark: props && props.theme === 'dark'
    };
  }
  componentDidUpdate(prev) { if (prev.theme !== this.props.theme) this.setState({ dark: this.props.theme === 'dark' }); }
  componentWillUnmount() { clearTimeout(this._tt); }
  consts() {
    if (this._c) return this._c;
    const CONTENT = {
      r1: { type: 'recipe', title: '15분 매콤 두부면', sub: '레시피 · 조리 15분', summary: '두부면에 파기름과 고춧가루 양념을 버무리는 한 그릇 요리예요.', listTitle: '재료', list: [['두부면', '1팩 (100g)'], ['대파', '1/2대'], ['고춧가루', '1큰술 또는 2큰술'], ['간장', '1큰술'], ['참기름', '분량 미기재', 1]] },
      r2: { type: 'recipe', title: '바삭한 감자 팬 요리', sub: '레시피 · 조리 시간 미기재', summary: '채 썬 감자에 전분을 버무려 팬에 납작하게 굽는 요리예요. 원본에 인분과 시간 정보가 없어요.', listTitle: '재료', list: [['감자', '2개'], ['전분', '2큰술'], ['소금', '분량 미기재', 1], ['식용유', '분량 미기재', 1]] },
      r4: { type: 'recipe', title: '들기름 막국수', sub: '레시피 · 조리 10분', summary: '삶은 메밀면에 들기름과 간장 양념을 버무리는 비빔면이에요.', listTitle: '재료', list: [['메밀면', '1인분 (100g)'], ['들기름', '2큰술'], ['간장', '1큰술'], ['설탕', '1/2작은술'], ['김가루', '분량 미기재', 1]] },
      e1: { type: 'exhibit', title: '빛의 방 — 가상 전시', sub: '전시 · 10.10 – 12.20 · 월 휴무', summary: '빛과 그림자를 주제로 한 몰입형 설치 전시예요.', facts: [['기간', '2026.10.10 – 12.20'], ['운영', '화–일 10:00 – 19:00'], ['휴무', '매주 월요일'], ['장소', '가상 미술관 2층'], ['관람료', '성인 15,000원'], ['예약', '사전 예약 권장']], from: '2026-10-10', to: '2026-12-20', closed: [1] },
      e2: { type: 'exhibit', title: '작은 서재 팝업', sub: '전시 · 종료됨', disabled: true },
      c1: { type: 'contest', title: '대학생 생활 아이디어 공모전', sub: '공모전 · 마감 11.14 (토) 18:00', summary: '국내 대학생 2–4인 팀이 생활 속 문제를 푸는 아이디어를 제안하는 공모전이에요.', facts: [['주최', '가상 재단'], ['마감', '11.14 (토) 18:00'], ['참가 대상', '대학 재학·휴학생 2–4인 팀']], listTitle: '공고 일정', list: [['접수 시작', '10.20 (화) 10:00'], ['접수 마감', '11.14 (토) 18:00'], ['서류 결과 발표', '11.28 (토)'], ['본선 발표', '12.12 (토)']], fixed: { deadline: ['2026-11-14', '18:00'], result: ['2026-11-28', null] } },
      c2: { type: 'contest', title: '로컬 기록단 모집', sub: '공모전 · 마감됨', disabled: true }
    };
    const KINDS = { recipe: [['cook', '요리할 날']], exhibit: [['visit', '방문할 날']], contest: [['deadline', '마감일'], ['prep', '준비 시작'], ['result', '결과 발표']], restaurant: [['visit', '방문할 날']], space: [['visit', '방문할 날']] };
    const KLABEL = { cook: '요리할 날', visit: '방문할 날', deadline: '마감일', prep: '준비 시작', result: '결과 발표' };
    const KSHORT = { cook: '요리', visit: '방문', deadline: '마감', prep: '준비', result: '발표' };
    const REM = [['day9', '당일 오전 9시'], ['h1', '1시간 전'], ['eve', '전날 오후 8시'], ['d3', '3일 전 오전 9시']];
    this._c = { CONTENT, KINDS, KLABEL, KSHORT, REM, NOW: new Date(2026, 10, 1, 10, 0), WD: ['일', '월', '화', '수', '목', '금', '토'] };
    return this._c;
  }
  p2(n) { return String(n).padStart(2, '0'); }
  key(d) { return d.getFullYear() + '-' + this.p2(d.getMonth() + 1) + '-' + this.p2(d.getDate()); }
  parse(k) { const a = k.split('-').map(Number); return new Date(a[0], a[1] - 1, a[2]); }
  add(k, n) { const d = this.parse(k); d.setDate(d.getDate() + n); return this.key(d); }
  dlabel(k) { const d = this.parse(k); return (d.getMonth() + 1) + '월 ' + d.getDate() + '일 (' + this.consts().WD[d.getDay()] + ')'; }
  remAt(ev, r) {
    const d = this.parse(ev.date);
    if (r === 'day9') { d.setHours(9, 0); return d; }
    if (r === 'h1') { if (!ev.time) return null; const t = ev.time.split(':').map(Number); d.setHours(t[0] - 1, t[1]); return d; }
    if (r === 'eve') { d.setDate(d.getDate() - 1); d.setHours(20, 0); return d; }
    if (r === 'd3') { d.setDate(d.getDate() - 3); d.setHours(9, 0); return d; }
    return null;
  }
  atLabel(dt) {
    const C = this.consts(); const now = C.NOW;
    const same = dt.toDateString() === now.toDateString();
    const tm = this.p2(dt.getHours()) + ':' + this.p2(dt.getMinutes());
    return (same ? '오늘' : (dt.getMonth() + 1) + '/' + dt.getDate() + ' (' + C.WD[dt.getDay()] + ')') + ' ' + tm;
  }
  toast(msg) { clearTimeout(this._tt); this.setState({ toast: msg }); this._tt = setTimeout(() => this.setState({ toast: null }), 3200); }
  openModal(base) {
    const C = this.consts(); const s = this.state;
    if (base && base.id) { const ev = s.events.find(e => e.id === base.id); this.setState({ modal: Object.assign({ mode: 'edit', mini: ev.date.slice(0, 7) + '-01', allDay: !ev.time }, JSON.parse(JSON.stringify(ev))) }); return; }
    const date = base && base.date ? base.date : s.sel;
    this.setState({ modal: { mode: 'add', id: null, item: null, kind: null, date, time: '19:00', allDay: false, rem: ['day9'], dm: true, mini: date.slice(0, 7) + '-01' } });
  }
  cvVals() {
    const C = this.consts(); const s = this.state; const c = s.viewItem ? C.CONTENT[s.viewItem] : null;
    if (!c) return { cvOpen: false, cvFacts: [], cvList: [], cvEvents: [] };
    const TL = { recipe: '레시피', exhibit: '전시·팝업', contest: '공모전·대외활동', restaurant: '맛집', space: '취향공간' };
    const evs = s.events.filter(e => e.item === s.viewItem).sort((a, b) => (a.date + (a.time || '')).localeCompare(b.date + (b.time || '')));
    return {
      cvOpen: true, cvTitle: c.title, cvType: TL[c.type], cvDot: 'dot t-' + c.type, cvOrb: 'orb o-' + c.type, cvSummary: c.summary || '',
      cvFacts: (c.facts || []).map(([k, v]) => ({ k, v })), cvHasFacts: !!(c.facts && c.facts.length), cvHasList: !!(c.list && c.list.length), cvListTitle: c.listTitle || '', cvList: (c.list || []).map(([a, b, miss]) => ({ a, b, bCls: 'b' + (miss ? ' miss' : '') })),
      cvEvents: evs.map(e => ({ label: this.dlabel(e.date) + (e.time ? ' ' + e.time : ''), kind: C.KLABEL[e.kind], cls: 'cv-ev' + (e.id === s.viewEv ? ' cur' : ''), pick: () => this.setState({ sel: e.date, cursor: e.date.slice(0, 7) + '-01', viewItem: null, viewEv: null }) })),
      cvHasEvents: evs.length > 0, cvEvCount: evs.length,
      closeCv: () => this.setState({ viewItem: null, viewEv: null }),
      cvAdd: () => { const id = s.viewItem; this.setState({ viewItem: null, viewEv: null }); this.openModal(); this.pickItem(id); }
    };
  }
  setDraft(patch) { this.setState({ modal: Object.assign({}, this.state.modal, patch) }); }
  pickItem(id) {
    const C = this.consts(); const c = C.CONTENT[id]; const kinds = C.KINDS[c.type]; const m = this.state.modal;
    const kind = kinds[0][0]; const patch = { item: id, kind };
    if (c.fixed && c.fixed[kind]) { patch.date = c.fixed[kind][0]; patch.time = c.fixed[kind][1] || ''; patch.allDay = !c.fixed[kind][1]; patch.mini = patch.date.slice(0, 7) + '-01'; patch.rem = ['d3', 'day9']; }
    else if (c.type === 'exhibit') { patch.time = '14:00'; patch.allDay = false; patch.rem = ['eve', 'day9']; if (!this.dayOk(id, m.date)) { patch.date = this.nextOk(id, m.date); patch.mini = patch.date.slice(0, 7) + '-01'; } }
    else { patch.rem = m.rem && m.rem.length ? m.rem : ['day9']; }
    this.setDraft(patch);
  }
  pickKind(kind) {
    const C = this.consts(); const m = this.state.modal; const c = C.CONTENT[m.item]; const patch = { kind };
    if (c && c.fixed && c.fixed[kind]) { patch.date = c.fixed[kind][0]; patch.time = c.fixed[kind][1] || ''; patch.allDay = !c.fixed[kind][1]; patch.mini = patch.date.slice(0, 7) + '-01'; }
    this.setDraft(patch);
  }
  dayOk(item, k) {
    const C = this.consts(); const c = item ? C.CONTENT[item] : null; const d = this.parse(k);
    if (d < this.parse(this.key(C.NOW))) return false;
    if (c && c.type === 'exhibit' && c.from) { if (k < c.from || k > c.to) return false; if (c.closed.indexOf(d.getDay()) >= 0) return false; }
    return true;
  }
  nextOk(item, k) { let x = k; for (let i = 0; i < 60; i++) { if (this.dayOk(item, x)) return x; x = this.add(x, 1); } return k; }
  save() {
    const s = this.state; const m = s.modal; if (!m || !m.item || !m.kind) return;
    const ev = { id: m.id || s.seq, item: m.item, kind: m.kind, date: m.date, time: m.allDay ? null : (m.time || null), rem: (m.rem || []).filter(r => !(r === 'h1' && (m.allDay || !m.time))), dm: m.dm };
    const events = m.id ? s.events.map(e => e.id === m.id ? ev : e) : s.events.concat([ev]);
    const n = ev.dm ? ev.rem.length : 0;
    if (this.setState({ events, seq: m.id ? s.seq : s.seq + 1, modal: null, sel: ev.date, cursor: ev.date.slice(0, 7) + '-01' }) === false) return;
    this.toast(this.dlabel(ev.date) + ' 일정을 ' + (m.id ? '수정' : '등록') + '했어요' + (n ? ' · 리마인드 DM ' + n + '개 예약 (데모)' : ''));
  }
  renderVals() {
    const C = this.consts(); const s = this.state; const today = this.key(C.NOW);
    const events = s.events.filter(e => C.CONTENT[e.item]);
    const visible = events.filter(e => s.filter[C.CONTENT[e.item].type]).sort((a, b) => (a.date + (a.time || '00:00')).localeCompare(b.date + (b.time || '00:00')));
    const decoEv = (e) => {
      const c = C.CONTENT[e.item]; const past = e.date < today;
      const rems = (e.rem || []).map(r => { const at = this.remAt(e, r); if (!at) return null; const lbl = C.REM.find(x => x[0] === r)[1]; const sent = at < C.NOW; return { at: this.atLabel(at), label: lbl, st: !e.dm ? '꺼짐' : (sent ? '보냄' : '예약됨'), stCls: 'st ' + (!e.dm ? 'st-off' : (sent ? 'st-sent' : 'st-sched')) }; }).filter(Boolean);
      return Object.assign({}, e, {
        title: c.title, type: c.type, dot: 'dot t-' + c.type, kindLabel: C.KLABEL[e.kind], kindShort: C.KSHORT[e.kind],
        timeLabel: e.time || '종일', hasBell: e.dm && rems.length > 0, remCount: rems.length,
        cls: 'ev' + (past ? ' past' : ''), wcls: 'wev' + (e.kind === 'deadline' ? ' deadline' : ''),
        rems, noRems: rems.length === 0, swCls: 'switch' + (e.dm ? ' on' : ''), dmChecked: e.dm ? 'true' : 'false',
        toggleDm: () => { this.setState({ events: this.state.events.map(x => x.id === e.id ? Object.assign({}, x, { dm: !x.dm }) : x) }); this.toast(e.dm ? 'DM 리마인드를 껐어요' : 'DM 리마인드를 켰어요'); },
        view: () => this.setState({ viewItem: e.item, viewEv: e.id }), viewAria: c.title + ' 콘텐츠 보기',
        edit: () => this.openModal({ id: e.id }),
        remove: () => { this.setState({ events: this.state.events.filter(x => x.id !== e.id) }); this.toast('일정을 삭제했어요.'); }
      });
    };
    const byDate = {}; visible.forEach(e => { (byDate[e.date] = byDate[e.date] || []).push(decoEv(e)); });
    const cur = this.parse(s.cursor); const vy = cur.getFullYear(), vm = cur.getMonth();
    const first = new Date(vy, vm, 1); const dim = new Date(vy, vm + 1, 0).getDate(); const rows = Math.ceil((first.getDay() + dim) / 7);
    const start = new Date(vy, vm, 1 - first.getDay());
    const cells = [];
    for (let i = 0; i < rows * 7; i++) {
      const d = new Date(start); d.setDate(start.getDate() + i); const k = this.key(d); const evs = byDate[k] || [];
      cells.push({ d: d.getDate(), aria: this.dlabel(k) + ' · 일정 ' + evs.length + '개', pressed: s.sel === k ? 'true' : 'false',
        cls: 'mc' + (d.getMonth() !== vm ? ' out' : '') + (k === today ? ' today' : '') + (s.sel === k ? ' sel' : ''),
        numCls: 'num' + (d.getDay() === 0 ? ' sun' : ''), evs: evs.slice(0, 3), hasMore: evs.length > 3, more: evs.length - 3,
        pick: () => this.setState({ sel: k }) });
    }
    const selD = this.parse(s.sel); const wStart = this.add(s.sel, -selD.getDay());
    const weekCols = [0, 1, 2, 3, 4, 5, 6].map(i => { const k = this.add(wStart, i); const d = this.parse(k); const evs = byDate[k] || [];
      return { d: d.getDate(), dow: C.WD[d.getDay()], aria: this.dlabel(k), cls: 'wc' + (k === today ? ' today' : '') + (s.sel === k ? ' sel' : ''), evs, empty: evs.length === 0,
        pick: () => this.setState({ sel: k }), add: () => { this.setState({ sel: k }); this.openModal({ date: k }); }, addAria: this.dlabel(k) + '에 일정 추가' }; });
    const ws = this.parse(wStart), we = this.parse(this.add(wStart, 6));
    const title = s.view === 'month' ? vy + '년 ' + (vm + 1) + '월' : (ws.getMonth() + 1) + '월 ' + ws.getDate() + '일 – ' + (we.getMonth() + 1) + '월 ' + we.getDate() + '일';
    const ups = [];
    events.forEach(e => { if (!e.dm) return; (e.rem || []).forEach(r => { const at = this.remAt(e, r); if (at && at >= C.NOW) ups.push({ at, e }); }); });
    ups.sort((a, b) => a.at - b.at);
    const counts = { recipe: 0, exhibit: 0, contest: 0, restaurant: 0, space: 0 }; events.forEach(e => counts[C.CONTENT[e.item].type]++);
    const allOn = Object.keys(C.KINDS).every(type => s.filter[type]);

    // modal
    const m = s.modal; let mv = { modalOpen: false, contentOpts: [], kindOpts: [], miniDays: [], remOpts: [] };
    if (m) {
      const c = m.item ? C.CONTENT[m.item] : null;
      const locked = !!(c && c.fixed && c.fixed[m.kind]);
      const mc = this.parse(m.mini); const my = mc.getFullYear(), mm = mc.getMonth(); const mf = new Date(my, mm, 1); const mdim = new Date(my, mm + 1, 0).getDate(); const mrows = Math.ceil((mf.getDay() + mdim) / 7);
      const ms = new Date(my, mm, 1 - mf.getDay()); const miniDays = [];
      for (let i = 0; i < mrows * 7; i++) { const d = new Date(ms); d.setDate(ms.getDate() + i); const k = this.key(d); const ok = locked ? k === m.date : this.dayOk(m.item, k);
        let why = ''; if (!ok && c && c.type === 'exhibit') why = (k < c.from || k > c.to) ? '전시 기간이 아니에요' : '휴무일이에요';
        miniDays.push({ d: d.getDate(), aria: this.dlabel(k), why, disabled: !ok, cls: 'md' + (d.getMonth() !== mm ? ' out' : '') + (k === today ? ' today' : '') + (k === m.date ? ' on' : ''), pick: () => this.setDraft({ date: k }) }); }
      const draftEv = { date: m.date, time: m.allDay ? null : m.time };
      const firstRem = (m.rem || []).filter(r => !(r === 'h1' && (m.allDay || !m.time)))[0];
      const at = firstRem ? this.remAt(draftEv, firstRem) : null;
      const wmap = { day9: '오늘은', eve: '내일은', d3: '3일 뒤는', h1: '한 시간 뒤는' };
      const w = wmap[firstRem] || '';
      const t = c ? c.title : '';
      const ptxt = { cook: w + ' ‘' + t + '’ 해먹기로 한 날이에요! 재료를 미리 확인해 보세요. 레시피 보기 ↓', visit: w + ' ‘' + t + '’ 가는 날이에요. 운영 시간과 예약은 공식 페이지에서 확인하세요 ↓', deadline: w + ' ‘' + t + '’ 마감일이에요 (' + m.date.slice(5).replace('-', '.') + ' ' + (m.time || '') + ' KST). 제출물을 확인해 보세요 ↓', prep: w + ' ‘' + t + '’ 준비를 시작하기로 한 날이에요. 지원 조건부터 확인해 볼까요? ↓', result: w + ' ‘' + t + '’ 결과 발표일이에요. 공식 공고에서 확인해 보세요 ↓' }[m.kind] || '';
      mv = {
        modalOpen: true, modalTitle: m.mode === 'edit' ? '일정 수정' : '일정 추가', closeModal: () => this.setState({ modal: null }),
        contentOpts: Object.keys(C.CONTENT).map(id => { const x = C.CONTENT[id]; return { title: x.title, sub: x.sub, orb: 'orb o-' + x.type, disabled: !!x.disabled, pressed: m.item === id ? 'true' : 'false', cls: 'opt' + (m.item === id ? ' on' : ''), pick: () => this.pickItem(id) }; }),
        kindOpts: c ? C.KINDS[c.type].map(([k, l]) => ({ label: l, cls: 'chip' + (m.kind === k ? ' on' : ''), pressed: m.kind === k ? 'true' : 'false', pick: () => this.pickKind(k) })) : [{ label: '콘텐츠를 먼저 골라 주세요', cls: 'chip', pressed: 'false', pick: () => {} }],
        draftDateLabel: this.dlabel(m.date), dateLocked: locked, dateFree: !locked,
        miniTitle: my + '년 ' + (mm + 1) + '월', miniDays,
        miniPrev: () => { const d = this.parse(m.mini); d.setMonth(d.getMonth() - 1); this.setDraft({ mini: this.key(d) }); },
        miniNext: () => { const d = this.parse(m.mini); d.setMonth(d.getMonth() + 1); this.setDraft({ mini: this.key(d) }); },
        hasDateHint: !!(c && c.from && c.to), dateHint: c && c.from ? '확인된 기간 ' + c.from + ' ~ ' + c.to + ' 안에서 골라 주세요.' : '',
        draftTime: m.time || '', onTime: e => this.setDraft({ time: e.target.value }), timeDisabled: m.allDay || locked, timeLockedFlag: locked,
        allDayCls: 'chip' + (m.allDay ? ' on' : ''), toggleAllDay: () => this.setDraft({ allDay: !m.allDay }),
        draftSwCls: 'switch' + (m.dm ? ' on' : ''), draftDmChecked: m.dm ? 'true' : 'false', toggleDraftDm: () => this.setDraft({ dm: !m.dm }),
        remOpts: C.REM.map(([k, l]) => { const on = (m.rem || []).indexOf(k) >= 0; const dis = !m.dm || (k === 'h1' && (m.allDay || !m.time)); return { label: l, disabled: dis, cls: 'chip' + (on && !dis ? ' on' : ''), pressed: on ? 'true' : 'false', toggle: () => this.setDraft({ rem: on ? m.rem.filter(x => x !== k) : (m.rem || []).concat([k]) }) }; }),
        showPreview: !!(c && m.dm && at), previewAt: at ? this.atLabel(at) : '', previewText: ptxt,
        footHint: !c ? '콘텐츠를 고르면 일정 종류와 날짜를 정할 수 있어요.' : (m.dm ? '리마인드는 예약 시각에 DM으로 보내요 (데모).' : 'DM 리마인드 없이 캘린더에만 표시돼요.'),
        save: () => this.save(), saveDisabled: !c || !m.kind, saveLabel: m.mode === 'edit' ? '수정 완료' : '일정 등록'
      };
    }

    return Object.assign({
      rootCls: 'app' + (s.dark ? ' dark' : ''), toggleDark: () => this.setState({ dark: !s.dark }), darkLabel: s.dark ? '라이트 모드' : '다크 모드',
      title, isMonth: s.view === 'month', isWeek: s.view === 'week',
      segMonth: s.view === 'month' ? 'on' : '', segWeek: s.view === 'week' ? 'on' : '',
      viewMonth: () => this.setState({ view: 'month', cursor: s.sel.slice(0, 7) + '-01' }), viewWeek: () => this.setState({ view: 'week' }),
      prev: () => { if (s.view === 'month') { const d = this.parse(s.cursor); d.setMonth(d.getMonth() - 1); this.setState({ cursor: this.key(d) }); } else { const k = this.add(s.sel, -7); this.setState({ sel: k, cursor: k.slice(0, 7) + '-01' }); } },
      next: () => { if (s.view === 'month') { const d = this.parse(s.cursor); d.setMonth(d.getMonth() + 1); this.setState({ cursor: this.key(d) }); } else { const k = this.add(s.sel, 7); this.setState({ sel: k, cursor: k.slice(0, 7) + '-01' }); } },
      goToday: () => this.setState({ sel: today, cursor: today.slice(0,7) + '-01' }),
      openAddSel: () => this.openModal({ date: s.sel < today ? today : s.sel }),
      filters: [['all', '전체', null, events.length], ['recipe', '레시피', 'dot t-recipe', counts.recipe], ['exhibit', '전시·팝업', 'dot t-exhibit', counts.exhibit], ['contest', '공모전·대외활동', 'dot t-contest', counts.contest], ['restaurant', '맛집', 'dot t-restaurant', counts.restaurant], ['space', '취향공간', 'dot t-space', counts.space]].map(([k, label, dot, count]) => {
        const on = k === 'all' ? allOn : (!allOn && s.filter[k]);
        return { label, dot, hasDot: !!dot, count, cls: on ? 'on' : '', pressed: on ? 'true' : 'false',
          toggle: () => this.setState({ filter: Object.fromEntries(Object.keys(C.KINDS).map(type => [type, k === 'all' || type === k])) }) };
      }),
      cells, weekCols,
      ...this.cvVals(),
      selLabel: this.dlabel(s.sel), selIsToday: s.sel === today, selEvents: byDate[s.sel] || [], selEmpty: !(byDate[s.sel] || []).length,
      upcoming: ups.slice(0, 5).map(u => { const c = C.CONTENT[u.e.item]; return { aria: this.atLabel(u.at) + ' ' + c.title + ' 일정으로 이동', at: this.atLabel(u.at), title: c.title, kind: C.KSHORT[u.e.kind], dot: 'dot t-' + c.type, pick: () => this.setState({ sel: u.e.date, cursor: u.e.date.slice(0, 7) + '-01' }) }; }), upCount: ups.length,
      hasToast: !!s.toast, toastMsg: s.toast || ''
    }, mv);
  }
}
