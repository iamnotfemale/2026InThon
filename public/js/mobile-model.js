import { DCLogic } from './dashboard-runtime.js';

export default class MobileModel extends DCLogic {
  constructor(props) {
    super(props);
    const st = (props && props.start) || 'home';
    const map = { recipe: 'r1', cook: 'r1', news: 'n1', exhibit: 'e1', contest: 'c1' };
    this.state = {
      tab: ['library', 'taste'].indexOf(st) >= 0 ? st : 'home',
      detailId: map[st] || null, settingsOpen: st === 'settings',
      cook: st === 'cook' ? { stage: 'step', idx: 1 } : null, cookDir: 'fwd', timer: st === 'cook' ? { idx: 1, left: 78, total: 120, running: false } : null,
      query: '', typeF: 'all', statusF: 'all', sortNew: true,
      fav: { r1: true, r2: true, e1: true, c1: true }, taste: { r1: true, r2: true, e1: true },
      ing: st === 'cook' ? { r1i1: true, r1i2: true, r1i3: true, r1i4: true } : {}, steps: st === 'cook' ? { r1s1: true } : {},
      share: null, shares: {}, srcOpen: false, retype: null, over: {},
      tasteState: 'ai', tasteRemoved: false, dmMode: 'full', toast: null, dark: props && props.theme === 'dark'
    };
  }
  componentDidUpdate(prev) {
    if (prev.theme !== this.props.theme) this.setState({ dark: this.props.theme === 'dark' });
    if (prev.start !== this.props.start) {
      const st = this.props.start || 'home'; const map = { recipe: 'r1', cook: 'r1', news: 'n1', exhibit: 'e1', contest: 'c1' };
      this.setState({ tab: ['library', 'taste'].indexOf(st) >= 0 ? st : 'home', detailId: map[st] || null, settingsOpen: st === 'settings', cook: st === 'cook' ? { stage: 'step', idx: 1 } : null, timer: st === 'cook' ? { idx: 1, left: 78, total: 120, running: false } : null });
    }
  }
  componentWillUnmount() { clearTimeout(this._tt); clearInterval(this._ct); clearTimeout(this._fl); }
  data() {
    if (this._data) return this._data;
    const ITEMS = [
      { id: 'r1', type: 'recipe', title: '15분 매콤 두부면', status: 'done', dm: 'sent', received: '오늘 14:20', ts: 1431, key: '조리 15분 · 재료 5개', author: '@sample_kitchen', checkedAt: '2026.10.31 14:21 KST', origin: 'https://example.com/instagram/reel/r1',
        summary: '두부면에 파기름과 고춧가루 양념을 버무리는 한 그릇 요리예요.', serving: '1인분', prep: '5분', cook: '10분',
        ingredients: [{ id: 'i1', name: '두부면', qty: '1팩 (100g)' }, { id: 'i2', name: '대파', qty: '1/2대' }, { id: 'i3', name: '고춧가루', qty: '1큰술 또는 2큰술', flag: true }, { id: 'i4', name: '간장', qty: '1큰술' }, { id: 'i5', name: '참기름', qty: '분량 미기재', miss: true }],
        steps: [{ id: 's1', text: '두부면을 찬물에 헹궈 물기를 빼요.', meta: '시간 미기재', uses: ['두부면'] }, { id: 's2', text: '팬에 기름을 두르고 대파를 볶아 파기름을 내요.', meta: '중불 · 2분', uses: ['대파'] }, { id: 's3', text: '불을 끈 뒤 고춧가루를 넣어 섞고, 간장을 넣어요.', meta: '불 끈 상태 · 시간 미기재', uses: ['고춧가루', '간장'], note: '고춧가루 분량이 자막(1큰술)과 음성(2큰술)에서 달라요.' }, { id: 's4', text: '두부면을 넣어 버무리고 참기름을 둘러 마무리해요.', meta: '약불 · 1분', uses: ['두부면', '참기름'] }],
        checks: ['고춧가루 분량이 자막(1큰술)과 음성(2큰술)에서 달라요. 원본을 확인해 주세요.'] },
      { id: 'n1', type: 'news', title: 'A시 청년 교통비 지원이 전원에게 지급된다는 주장', status: 'done', dm: 'sent', received: '오늘 13:02', ts: 1302, key: '판단 · 오해의 소지', author: '@sample_cardnews', checkedAt: '2026.10.31 13:05 KST',
        claim: 'A시가 만 19–34세 청년 전원에게 매달 교통비를 지원한다.', verdict: 'mis', oneLine: '금액·연령은 맞지만, 지원 대상은 조건을 충족한 신청자뿐이에요.',
        checks: [{ k: '지원 대상', claim: '청년 전원', found: '소득·거주 조건 충족 신청자', st: 'diff' }, { k: '지원 금액', claim: '매달 교통비', found: '월 최대 5만 원 (가상)', st: 'match' }, { k: '대상 연령', claim: '만 19–34세', found: '만 19–34세', st: 'match' }, { k: '신청 조건', claim: '언급 없음', found: '예산 소진 시 조기 마감', st: 'missing' }],
        sources: [{ title: 'A시 청년 교통비 지원 사업 공고 (가상)', org: 'A시 · 가상 기관', date: '2026.10.02', url: 'https://example.com/a-city/notice' }, { title: '청년 교통비 지원 자주 묻는 질문 (가상)', org: 'A시 청년정책과 · 가상', date: '2026.10.05', url: 'https://example.com/a-city/faq' }] },
      { id: 'e1', type: 'exhibit', title: '빛의 방 — 가상 전시', status: 'done', dm: 'sent', received: '어제 21:14', ts: 1021, key: '10.10 – 12.20 · 가상 미술관', author: '@sample_gallery', checkedAt: '2026.10.30 21:15 KST', phase: '진행 중', phaseCls: 'badge s-done',
        intro: '빛과 그림자를 주제로 한 몰입형 설치 전시예요. (가상 데이터)', period: '2026.10.10 – 2026.12.20', hours: '화–일 10:00 – 19:00', closed: '매주 월요일', place: '가상 미술관 2층', address: '가상시 빛길 12', mapUrl: 'https://example.com/map?q=light-room', fee: '성인 15,000원 (가상)', booking: '사전 예약 권장', reserveUrl: 'https://example.com/light-room/booking', officialUrl: 'https://example.com/light-room' },
      { id: 'c1', type: 'contest', title: '대학생 생활 아이디어 공모전', status: 'done', dm: 'unknown', received: '10월 29일', ts: 929, key: '마감 11.14 (토) 18:00 · D-14', author: '@sample_foundation', checkedAt: '2026.10.29 18:32 KST', phase: '모집 중', phaseCls: 'badge s-done',
        host: '가상 재단 · 가상 공모전 운영사무국', dday: 'D-14', deadline: '2026.11.14 (토) 18:00 KST', elig: ['국내 대학 재학생·휴학생', '2–4인 팀 구성 필수', '전공 무관'],
        schedule: [{ label: '접수 시작', date: '2026.10.20 (화) 10:00', st: 'ok' }, { label: '접수 마감', date: '2026.11.14 (토) 18:00', st: 'run' }, { label: '서류 결과 발표', date: '2026.11.28 (토)', st: 'wait' }],
        submit: ['아이디어 기획서 (PDF)', '3분 소개 영상', '팀원 재학증명서'], noticeUrl: 'https://example.com/idea-contest/notice', applyUrl: 'https://example.com/idea-contest/apply' },
      { id: 'r2', type: 'recipe', title: '바삭한 감자 팬 요리', status: 'done', dm: 'failed', received: '10월 28일', ts: 928, key: '조리 시간 미기재', author: null, checkedAt: '2026.10.28 19:41 KST',
        summary: '채 썬 감자에 전분을 버무려 팬에 납작하게 굽는 요리예요.', serving: '인분 미기재', prep: '미기재', cook: '미기재',
        ingredients: [{ id: 'i1', name: '감자', qty: '2개' }, { id: 'i2', name: '전분', qty: '2큰술' }, { id: 'i3', name: '소금', qty: '분량 미기재', miss: true }, { id: 'i4', name: '식용유', qty: '분량 미기재', miss: true }],
        steps: [{ id: 's1', text: '감자를 채 썰어 물에 담가 전분기를 빼요.', meta: '시간 미기재', uses: ['감자'] }, { id: 's2', text: '물기를 닦고 전분과 소금을 버무려요.', meta: '시간 미기재', uses: ['전분', '소금'] }, { id: 's3', text: '팬에 기름을 두르고 납작하게 펴서 양면을 노릇하게 구워요.', meta: '중불 · 시간 미기재', uses: ['식용유'] }], checks: [] },
      { id: 'n2', type: 'news', title: 'B연구 결과를 단정적으로 소개한 카드뉴스', status: 'done', dm: 'sent', received: '10월 27일', ts: 927, key: '판단 · 판단 유보', author: '@sample_infocard', checkedAt: '2026.10.27 11:23 KST',
        claim: 'B연구가 하루 스마트폰 사용 시간이 길수록 대학생 학점이 떨어진다는 것을 증명했다.', verdict: 'hold', oneLine: '연구 원문을 확인하지 못해 결론을 내리지 않았어요.',
        checks: [{ k: '연구 결론', claim: '인과관계 ‘증명’', found: '관련성만 언급 (소개 기사)', st: 'diff' }, { k: '연구 원문', claim: 'B연구 인용', found: '원문 접근 실패', st: 'missing' }],
        sources: [{ title: 'B연구 소개 기사 (가상)', org: '가상 매체', date: '2026.10.20', url: 'https://example.com/b-study/article' }] },
      { id: 'e2', type: 'exhibit', title: '작은 서재 팝업', status: 'done', dm: 'sent', received: '10월 18일', ts: 918, key: '종료 · 10.03 – 10.19', author: '@sample_bookshop', checkedAt: '2026.10.18 16:03 KST', phase: '종료', phaseCls: 'badge s-neutral',
        intro: '독립 출판물을 모아 소개한 팝업 서점이에요. (가상 데이터)', period: '2026.10.03 – 2026.10.19', hours: '12:00 – 20:00', closed: '휴무일 미기재', place: '가상 서점 1층', address: '가상시 책방로 5', mapUrl: 'https://example.com/map?q=small-library', fee: '무료 (원본 기준)', booking: '예약 필요 여부 미기재', reserveUrl: null, officialUrl: null, origin: 'https://example.com/instagram/p/e2' },
      { id: 'c2', type: 'contest', title: '로컬 기록단 모집', status: 'done', dm: 'sent', received: '10월 15일', ts: 915, key: '마감 10.25 · 시간 미기재', author: '@sample_culture', checkedAt: '2026.10.15 20:11 KST', phase: '마감', phaseCls: 'badge s-neutral',
        host: '가상 문화재단', dday: null, deadline: '2026.10.25 (일) · 마감 시간 미기재', elig: ['가상시 거주 또는 재학 중인 만 19–29세'], schedule: [{ label: '접수 마감', date: '2026.10.25 (일) · 시간 미기재', st: 'ok' }, { label: '활동 기간', date: '2026.11 – 2027.02', st: 'wait' }],
        submit: ['지원서', '기록물 포트폴리오 (선택)'], noticeUrl: 'https://example.com/local-archive/notice', applyUrl: null },
      { id: 'm1', type: 'restaurant', title: '가상 들기름 국수집', status: 'done', dm: 'sent', received: '오늘 12:38', ts: 1238, key: '한식 · 성수동 · 1인 1만원대', author: '@sample_foodie', checkedAt: '2026.10.31 12:40 KST',
        intro: '들기름 막국수와 수육을 파는 국수집이에요. (가상 데이터)', category: '한식', priceRange: '1인 1만원대', hours: '매일 11:00 – 21:00 (브레이크타임 15:00 – 17:00)', closed: '휴무일 미기재',
        address: '가상시 성수로 12', mapNaver: 'https://map.naver.com/p/search/%EA%B0%80%EC%83%81%20%EB%93%A4%EA%B8%B0%EB%A6%84%20%EA%B5%AD%EC%88%98%EC%A7%91%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%84%B1%EC%88%98%EB%A1%9C%2012', mapKakao: 'https://map.kakao.com/link/search/%EA%B0%80%EC%83%81%20%EB%93%A4%EA%B8%B0%EB%A6%84%20%EA%B5%AD%EC%88%98%EC%A7%91%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%84%B1%EC%88%98%EB%A1%9C%2012', reservation: '예약 받지 않음', waiting: '점심 시간 웨이팅 있음',
        menus: [{ name: '들기름 막국수', price: '11,000원', note: '면 추가 무료', signature: true }, { name: '수육 (소)', price: '18,000원', note: null, signature: false }, { name: '감자전', price: '가격 미기재', note: null, signature: false }] },
      { id: 'sp1', type: 'space', title: '가상 그림책 서점', status: 'done', dm: 'sent', received: '오늘 11:02', ts: 1102, key: '서점·책방 · 연남동 · 월요일 휴무', author: '@sample_bookshelf', checkedAt: '2026.10.31 11:05 KST',
        intro: '그림책과 독립출판물을 모아 둔 작은 서점이에요. 주말에는 그림책 낭독회를 열어요. (가상 데이터)', category: '서점·책방', hours: '화–일 12:00 – 20:00', closed: '월요일 휴무',
        address: '가상시 연남로 3', mapNaver: 'https://map.naver.com/p/search/%EA%B0%80%EC%83%81%20%EA%B7%B8%EB%A6%BC%EC%B1%85%20%EC%84%9C%EC%A0%90%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%97%B0%EB%82%A8%EB%A1%9C%203', mapKakao: 'https://map.kakao.com/link/search/%EA%B0%80%EC%83%81%20%EA%B7%B8%EB%A6%BC%EC%B1%85%20%EC%84%9C%EC%A0%90%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%97%B0%EB%82%A8%EB%A1%9C%203', reservation: '낭독회는 DM으로 신청', waiting: '대기 정보 미기재', parking: '주차 불가', phone: '전화번호 미기재' },
      { id: 'p1', type: 'unknown', title: '새로 보낸 릴스', status: 'needtype', dm: 'guide', received: '오늘 15:02', ts: 1502, key: '어떤 내용으로 정리할지 선택해 주세요', author: null },
      { id: 'f1', type: 'unknown', title: '접근할 수 없는 게시물', status: 'insufficient', dm: 'guide', received: '10월 30일', ts: 1009, key: '원본을 확인하지 못했어요', author: null }
    ];
    this._data = { ITEMS };
    return this._data;
  }
  toast(msg, label, action) { clearTimeout(this._tt); this.setState({ toast: { msg, label: label || null, action: action || null } }); this._tt = setTimeout(() => this.setState({ toast: null }), action ? 5000 : 2800); }
  secsOf(meta) { const m = /(\d+)분/.exec(meta || ''); return m ? parseInt(m[1], 10) * 60 : 0; }
  fmt(n) { return String(Math.floor(n / 60)).padStart(2, '0') + ':' + String(n % 60).padStart(2, '0'); }
  item(id) { return this._data.ITEMS.find(x => x.id === id); }
  cookGo(stage, idx, dir) {
    clearInterval(this._ct);
    const r = this.item(this.state.detailId); let timer = null;
    if (stage === 'step' && r) { const secs = this.secsOf(r.steps[idx].meta); if (secs) timer = { idx, left: secs, total: secs, running: false }; }
    this.setState({ cook: { stage, idx }, cookDir: dir, timer });
  }
  cookNext() {
    const s = this.state; const r = this.item(s.detailId); const c = s.cook; if (!c || !r) return;
    if (c.stage === 'prep') return this.cookGo('step', 0, 'fwd');
    if (c.stage === 'step') { this.setState({ steps: Object.assign({}, s.steps, { [r.id + r.steps[c.idx].id]: true }) }); if (c.idx < r.steps.length - 1) this.cookGo('step', c.idx + 1, 'fwd'); else this.cookGo('done', 0, 'fwd'); }
  }
  cookPrev() { const c = this.state.cook; if (!c) return; if (c.stage === 'step') { if (c.idx > 0) this.cookGo('step', c.idx - 1, 'back'); else this.cookGo('prep', 0, 'back'); } }
  timerToggle() {
    const t = this.state.timer; if (!t) return; clearInterval(this._ct);
    if (t.running) { this.setState({ timer: Object.assign({}, t, { running: false }) }); return; }
    this.setState({ timer: Object.assign({}, t, { left: t.left <= 0 ? t.total : t.left, running: true }) });
    this._ct = setInterval(() => { const tt = this.state.timer; if (!tt || !tt.running) { clearInterval(this._ct); return; } const n = tt.left - 1; if (n <= 0) { clearInterval(this._ct); this.setState({ timer: Object.assign({}, tt, { left: 0, running: false }) }); this.toast('타이머가 끝났어요'); } else this.setState({ timer: Object.assign({}, tt, { left: n }) }); }, 1000);
  }
  renderVals() {
    const s = this.state; this.data(); const ITEMS = this._data.ITEMS;
    const TL = { recipe: '레시피', news: '뉴스·정보', exhibit: '전시·팝업', contest: '공모전·대외활동', restaurant: '맛집', space: '취향공간', unknown: '유형 미정' };
    const ST = { done: ['정리 완료', 'badge s-done', 'done'], processing: ['처리 중', 'badge s-proc', 'processing'], needtype: ['유형 선택 필요', 'badge s-warn', 'check'], insufficient: ['자료 부족', 'badge s-err', 'failed'] };
    const DM = { sent: ['DM 발송 확인', 'badge s-neutral'], failed: ['DM 전달 실패', 'badge s-err'], unknown: ['DM 전달 미확인', 'badge s-warn'], guide: ['안내 DM 발송', 'badge s-neutral'], waiting: ['DM 대기', 'badge s-neutral'] };
    const deco = (raw) => {
      const it = Object.assign({}, raw, s.over[raw.id] || {}); const st = ST[it.status]; const fav = !!s.fav[it.id];
      return Object.assign(it, {
        typeLabel: TL[it.type], dot: 'dot t-' + it.type, orbCls: 'orb o-' + it.type + (it.status === 'processing' ? ' fast' : ''),
        statusLabel: st[0], statusCls: st[1], group: st[2],
        favCls: 'icon-btn' + (fav ? ' on' : ''), favLabel: fav ? '즐겨찾기 해제' : '즐겨찾기에 추가', favPressed: fav ? 'true' : 'false',
        toggleFav: () => { this.setState({ fav: Object.assign({}, this.state.fav, { [it.id]: !fav }) }); this.toast(fav ? '즐겨찾기에서 뺐어요' : '즐겨찾기에 추가했어요'); },
        open: () => this.setState({ detailId: it.id, srcOpen: false, retype: null, cook: null }),
        cta: it.status === 'needtype' ? '유형 선택' : '보기'
      });
    };
    const items = ITEMS.map(deco);
    const counts = { recipe: 0, news: 0, exhibit: 0, contest: 0, restaurant: 0, space: 0 }; items.forEach(i => { if (counts[i.type] !== undefined) counts[i.type]++; });
    const q = s.query.trim().toLowerCase();
    let lib = items.filter(i => (this.matchesContent ? this.matchesContent(i, s.query) : !q || (i.title + ' ' + i.key).toLowerCase().indexOf(q) >= 0) && (s.typeF === 'all' || i.type === s.typeF) && (s.statusF === 'all' || i.group === s.statusF) && (!s.favOnly || s.fav[i.id]));
    lib.sort((a, b) => q && s.semanticSearch?.query === s.query.trim() ? s.semanticSearch.ids.indexOf(a.id) - s.semanticSearch.ids.indexOf(b.id) : s.sortNew ? b.ts - a.ts : a.ts - b.ts);
    const isFiltered = !!q || s.typeF !== 'all' || s.statusF !== 'all' || !!s.favOnly;
    const tasteAll = items.filter(i => s.taste[i.id] && i.status === 'done' && ['recipe','exhibit','contest','restaurant'].includes(i.type));
    const tasteType = s.tab === 'taste' && s.tasteTab === 'exhibit' ? 'exhibit' : (s.tasteTab || 'recipe');
    const tasteItems = tasteAll.filter(i => i.type === tasteType).map(i => Object.assign({}, i, { remove: () => { this.setState({ taste: Object.assign({}, this.state.taste, { [i.id]: false }) }); this.toast('취향에서 뺐어요. 정리 결과는 그대로예요.'); } }));

    // detail
    let d = { checks: [], ingredients: [], steps: [], cmp: [], sources: [], elig: [], schedule: [], submit: [], menus: [] };
    const raw = s.detailId ? items.find(i => i.id === s.detailId) : null;
    let cookV = { cookOpen: false, cookSteps: [], cookSegs: [] };
    if (raw) {
      d = Object.assign({}, raw);
      const done = raw.status === 'done';
      d.tasteable = done && ['recipe','exhibit','space','contest','restaurant'].includes(raw.type);
      d.isDone = done; d.isRecipe = done && raw.type === 'recipe'; d.isNews = done && raw.type === 'news'; d.isExhibit = done && raw.type === 'exhibit'; d.isRestaurant = done && raw.type === 'restaurant'; d.isSpace = done && raw.type === 'space'; d.isContest = done && raw.type === 'contest';
      d.isProc = raw.status === 'processing'; d.isNeedType = raw.status === 'needtype'; d.isInsufficient = raw.status === 'insufficient';
      d.hasAuthor = !!raw.author; d.hasPhase = !!raw.phase; d.shareDisabled = !done;
      const dm = DM[raw.dm] || DM.waiting; d.dmLabel = dm[0]; d.dmCls = dm[1];
      const tOn = !!s.taste[raw.id];
      d.tasteBtnCls = 'btn' + (tOn ? ' btn-primary' : ''); d.tastePressed = tOn ? 'true' : 'false'; d.tasteLabel = tOn ? '취향에서 빼기' : '취향으로 모으기';
      d.toggleTaste = () => { this.setState({ taste: Object.assign({}, s.taste, { [raw.id]: !tOn }) }); this.toast(tOn ? '취향에서 뺐어요' : '내 취향에 모았어요'); };
      d.procTitle = (s.over[raw.id] && s.over[raw.id].procType ? s.over[raw.id].procType + '(으)로 ' : '') + '정리하고 있어요';
      if (raw.type === 'recipe' && done) {
        const ingCk = {};
        d.ingredients = raw.ingredients.map(g => { const k = raw.id + g.id; const ck = !!s.ing[k]; ingCk[g.name] = ck; return Object.assign({}, g, { checked: ck, cls: 'ing' + (ck ? ' is-done' : '') + (g.flag ? ' flag' : ''), qtyCls: g.miss ? 'miss' : '', toggle: () => this.setState({ ing: Object.assign({}, this.state.ing, { [k]: !ck }) }) }); });
        d.ingCount = d.ingredients.length; d.ingReady = d.ingredients.filter(g => g.checked).length;
        const cur = raw.steps.findIndex(x => !s.steps[raw.id + x.id]); let dn = 0;
        d.steps = raw.steps.map((x, i) => { const k = raw.id + x.id; const ck = !!s.steps[k]; if (ck) dn++; const secs = this.secsOf(x.meta);
          return Object.assign({}, x, { n: i + 1, checked: ck, pressed: ck ? 'true' : 'false', tlCls: 'tl' + (ck ? ' done' : '') + (i === cur ? ' current' : ''), aria: (i + 1) + '단계 ' + (ck ? '완료 취소' : '완료로 표시'),
            metaText: (x.meta || '').split(' · ').concat(x.uses || []).join(' · '), chips: (x.meta || '').split(' · ').map(l => ({ label: l, cls: 'mchip' + (/미기재/.test(l) ? ' miss' : '') })),
            uses: (x.uses || []).map(n => ({ name: n, cls: 'uchip' + (ingCk[n] ? ' ok' : '') })), hasNote: !!x.note, note: x.note || '', hasTimer: secs > 0, noTimer: !secs,
            visCls: 'stepvis' + (ck ? ' done' : ''), visHint: ck ? '완료했어요 · 다시 누르면 취소' : '끝나면 눌러서 완료로 표시',
            toggle: () => this.setState({ steps: Object.assign({}, this.state.steps, { [k]: !ck }) }) }); });
        d.stepDone = dn; d.stepTotal = raw.steps.length;
        const mc = v => /미기재/.test(v) ? 'miss' : ''; d.servingCls = mc(raw.serving); d.prepCls = mc(raw.prep); d.cookCls = mc(raw.cook);
        const c = s.cook;
        if (c) {
          const t = s.timer; const N = raw.steps.length;
          cookV = { cookOpen: true, cookPrep: c.stage === 'prep', cookDone: c.stage === 'done', cookNotDone: c.stage !== 'done',
            cookPaneCls: 'cook-pane' + (s.cookDir === 'back' ? ' back' : ''),
            cookCounter: c.stage === 'prep' ? '재료 준비' : (c.stage === 'done' ? '완료' : (c.idx + 1) + ' / ' + N),
            cookNextLabel: c.stage === 'prep' ? '조리 시작' : (c.idx === N - 1 ? '조리 완료' : '다음 단계'), cookPrevDisabled: c.stage === 'prep',
            cookSteps: d.steps.map((x, i) => Object.assign({}, x, { active: c.stage === 'step' && c.idx === i })),
            cookSegs: [{ cls: 'csg' + (c.stage === 'prep' ? ' cur' : ' done'), aria: '재료 준비', go: () => this.cookGo('prep', 0, 'back') }].concat(d.steps.map((x, i) => ({ cls: 'csg' + (x.checked ? ' done' : '') + (c.stage === 'step' && c.idx === i ? ' cur' : ''), aria: (i + 1) + '단계', go: () => this.cookGo('step', i, c.stage === 'prep' || i > c.idx ? 'fwd' : 'back') }))),
            timerTime: t ? this.fmt(t.left) : '00:00', timerOffset: t ? (351.86 * (1 - t.left / t.total)).toFixed(1) : '0',
            timerBtnLabel: !t ? '시작' : (t.running ? '일시정지' : (t.left === t.total ? '타이머 시작' : (t.left === 0 ? '다시 시작' : '계속'))) };
        }
      }
      if (raw.type === 'news' && done) {
        const VL = { true: '사실', mostly: '대체로 사실', mis: '오해의 소지', false: '거짓', hold: '판단 유보' };
        d.verdictLabel = VL[raw.verdict]; d.gaugeOn = raw.verdict !== 'hold'; d.gaugeSub = raw.verdict === 'hold' ? '근거 부족으로 위치 미표시' : '판단';
        d.needleDeg = ({ false: -101.25, mis: -33.75, mostly: 33.75, true: 101.25 }[raw.verdict] || 0) + 'deg'; d.gaugeAria = '판단: ' + VL[raw.verdict];
        d.cmp = raw.checks.map(c => Object.assign({}, c, { cls: 'cmp ' + c.st, isMatch: c.st === 'match', isDiff: c.st === 'diff', isMissing: c.st === 'missing' }));
        const n = st => raw.checks.filter(c => c.st === st).length; d.cmpSummary = '일치 ' + n('match') + ' · 다름 ' + n('diff') + ' · 확인 안 됨 ' + n('missing');
        d.sources = raw.sources.map(x => Object.assign({}, x, { href: x.url, ini: (x.org || '출처').trim().charAt(0) })); d.sourceCount = raw.sources.length; d.noSources = !d.sourceCount;
      }
      if (raw.type === 'exhibit' && done) {
        const mv = v => /미기재/.test(v) ? 'v miss' : 'v'; d.closedCls = mv(raw.closed); d.bookingCls = mv(raw.booking);
        d.hasReserve = !!raw.reserveUrl;
      }
      if (raw.type === 'restaurant' && done) {
        const mv = v => /미기재|없어요/.test(v || '') ? 'v miss' : 'v';
        d.priceRangeCls = mv(raw.priceRange); d.hoursCls = mv(raw.hours); d.closedCls = mv(raw.closed); d.reservationCls = mv(raw.reservation); d.waitingCls = mv(raw.waiting);
        d.menus = raw.menus.map((m, i) => Object.assign({}, m, { k: i, hasNote: !!m.note, signature: !!m.signature, priceCls: 'price' + (/미기재/.test(m.price) ? ' miss' : '') }));
        d.noMenus = raw.menus.length === 0;
      }
      if (raw.type === 'space' && done) {
        const mv = v => /미기재|없어요/.test(v || '') ? 'v miss' : 'v';
        d.hoursCls = mv(raw.hours); d.closedCls = mv(raw.closed); d.reservationCls = mv(raw.reservation); d.waitingCls = mv(raw.waiting);
        d.parkingCls = mv(raw.parking); d.phoneCls = mv(raw.phone);
      }
      if (raw.type === 'contest' && done) {
        d.ddayLabel = raw.dday || '마감'; d.hasApply = !!raw.applyUrl;
        d.schedule = raw.schedule.map(x => Object.assign({}, x, { cls: 'pstep ' + x.st }));
        d.submit = raw.submit.map((t, i) => ({ n: String(i + 1).padStart(2, '0'), t }));
      }
    }
    const sh = s.share;
    const sched = [{ mon: '11월', day: '14', title: '대학생 생활 아이디어 공모전', what: '접수 마감 · 18:00 KST', badge: 'D-14', id: 'c1' }, { mon: '11월', day: '28', title: '대학생 생활 아이디어 공모전', what: '서류 결과 발표', badge: 'D-28', id: 'c1' }, { mon: '12월', day: '20', title: '빛의 방 — 가상 전시', what: '전시 종료일', badge: 'D-50', id: 'e1' }].map(x => Object.assign(x, { open: () => this.setState({ detailId: x.id, cook: null }) }));
    const tb = { ai: ['AI 제안', 'badge s-neutral'], confirmed: ['확인함', 'badge s-done'], edited: ['직접 수정함', 'badge s-proc'] }[s.tasteState];

    return Object.assign({
      rootCls: 'm' + (s.dark ? ' dark' : ''),
      isHome: s.tab === 'home', notHome: s.tab !== 'home', isLibrary: s.tab === 'library', isTaste: s.tab === 'taste',
      tabTitle: s.tab === 'library' ? '내 콘텐츠' : '내 취향',
      tabHome: 'tab' + (s.tab === 'home' ? ' on' : ''), tabLib: 'tab' + (s.tab === 'library' ? ' on' : ''), tabTaste: 'tab' + (s.tab === 'taste' ? ' on' : ''),
      goHome: () => this.setState({ tab: 'home' }), goLibrary: () => this.setState({ tab: 'library' }), goTaste: () => this.setState({ tab: 'taste' }),
      openSettings: () => this.setState({ settingsOpen: true }), closeSettings: () => this.setState({ settingsOpen: false }), settingsOpen: s.settingsOpen,
      sendFromIg: () => this.toast('Instagram 앱에서 @dimi_in에 공유해 주세요 (데모)'),
      hasActive: items.some(i => i.status === 'needtype' || i.status === 'processing'), activeItems: items.filter(i => i.status === 'needtype' || i.status === 'processing'), activeCount: items.filter(i => i.status === 'needtype' || i.status === 'processing').length,
      recentItems: items.filter(i => i.status === 'done').sort((a, b) => b.ts - a.ts).slice(0, 8), schedule: sched,
      statusF: s.statusF, onStatus: e => this.setState({ statusF: e.target.value }),
      sort: s.sortNew ? 'new' : 'old', onSort: e => this.setState({ sortNew: e.target.value === 'new' }),
      favChipCls: 'chip' + (s.favOnly ? ' on' : ''), favOnlyPressed: s.favOnly ? 'true' : 'false', toggleFavOnly: () => this.setState({ favOnly: !s.favOnly }),
      query: s.query, onQuery: e => this.setState({ query: e.target.value }),
      typeChips: [['all', '전체', null, items.length], ['recipe', '레시피', 'dot t-recipe', counts.recipe], ['news', '뉴스·정보', 'dot t-news', counts.news], ['exhibit', '전시·팝업', 'dot t-exhibit', counts.exhibit], ['contest', '공모전', 'dot t-contest', counts.contest], ['restaurant', '맛집', 'dot t-restaurant', counts.restaurant], ['space', '취향공간', 'dot t-space', counts.space]].map(([k, label, dot, count]) => ({ label, dot, hasDot: !!dot, count, cls: 'chip' + (s.typeF === k ? ' on' : ''), pressed: s.typeF === k ? 'true' : 'false', pick: () => this.setState({ typeF: k }) })),
      statusChips: [['all', '전체 상태'], ['processing', '처리 중'], ['done', '정리 완료'], ['check', '확인 필요'], ['failed', '처리하지 못함']].map(([k, label]) => ({ label, cls: 'chip' + (s.statusF === k ? ' on' : ''), pressed: s.statusF === k ? 'true' : 'false', pick: () => this.setState({ statusF: k }) })),
      libItems: lib, libCount: lib.length, libHasItems: lib.length > 0, libEmpty: lib.length === 0, isFiltered,
      emptyTitle: q ? '검색 결과가 없어요.' : '선택한 조건에 맞는 콘텐츠가 없어요.', emptyDesc: q ? '검색어를 바꾸거나 지워 보세요.' : '필터를 바꾸거나 초기화해 보세요.',
      resetFilters: () => this.setState({ query: '', typeF: 'all', statusF: 'all' }),
      sortLabel: s.sortNew ? '최근순' : '오래된순', toggleSort: () => this.setState({ sortNew: !s.sortNew }),
      tasteTabs: [['recipe', '레시피', 'dot t-recipe'], ['exhibit', '전시·공간', 'dot t-exhibit']].map(([k, label, dot]) => ({ label, dot, count: tasteAll.filter(i => i.type === k).length, cls: tasteType === k ? 'on' : '', pressed: tasteType === k ? 'true' : 'false', pick: () => this.setState({ tasteTab: k }) })),
      tasteIntro: '마음에 든 레시피와 전시를 모아보세요.', tasteEditable: true, tasteCardLabel: '15분 안팎의 간단한 팬·면 요리', tasteCardDesc: '짧은 조리 시간과 팬 하나로 만드는 레시피를 모았어요.',
      tasteItems, tasteEmpty: tasteItems.length === 0, tasteSingle: tasteItems.length === 1, tasteShowCard: tasteType === 'recipe' && tasteItems.length >= 2 && !s.tasteRemoved,
      tasteBadge: tb[0], tasteBadgeCls: tb[1], tasteConfirmed: s.tasteState === 'confirmed',
      confirmTaste: () => { this.setState({ tasteState: 'confirmed' }); this.toast('취향을 확인했어요'); }, editTaste: () => { this.setState({ tasteState: 'edited' }); this.toast('수정 화면은 데스크톱 시안과 같아요 (데모)'); },
      removeTasteCard: () => { this.setState({ tasteRemoved: true }); this.toast('취향 표현을 삭제했어요. 모은 콘텐츠는 그대로예요.'); },
      hasDetail: !!raw, d, closeDetail: () => { clearInterval(this._ct); this.setState({ detailId: null, cook: null, share: null }); },
      srcOpen: s.srcOpen, srcExpanded: s.srcOpen ? 'true' : 'false', srcChevStyle: s.srcOpen ? 'transform: rotate(180deg); transition: transform .25s ease' : 'transition: transform .25s ease', toggleSrc: () => this.setState({ srcOpen: !s.srcOpen }),
      retypeOpts: [['recipe', '레시피', '재료·분량, 조리 순서'], ['news', '뉴스·정보 확인', '주장 단위 사실 확인'], ['exhibit', '전시·팝업', '장소·일정·예약 정보'], ['contest', '공모전·대외활동', '지원 조건·마감·제출물'], ['restaurant', '맛집', '위치·메뉴·가격'], ['space', '취향공간', '위치·운영 시간·이용 정보']].map(([k, label, desc]) => ({ label, desc, dot: 'dot t-' + k, checked: s.retype === k ? 'true' : 'false', cls: 'radio-card' + (s.retype === k ? ' on' : ''), pick: () => this.setState({ retype: k }) })),
      retypeDisabled: !s.retype,
      requestProcess: () => { if (!raw || !s.retype) return; const lbl = { recipe: '레시피', news: '뉴스·정보 확인', exhibit: '전시·팝업', contest: '공모전·대외활동', restaurant: '맛집', space: '취향공간' }[s.retype]; this.setState({ over: Object.assign({}, s.over, { [raw.id]: { status: 'processing', dm: 'waiting', key: lbl + '(으)로 정리하고 있어요', procType: lbl } }) }); this.toast(lbl + '(으)로 정리를 요청했어요'); },
      startCook: () => this.cookGo('prep', 0, 'fwd'), closeCook: () => { clearInterval(this._ct); this.setState({ cook: null, timer: null }); },
      cookNext: () => this.cookNext(), cookPrev: () => this.cookPrev(), timerToggle: () => this.timerToggle(),
      timerReset: () => { clearInterval(this._ct); const t = this.state.timer; if (t) this.setState({ timer: Object.assign({}, t, { left: t.total, running: false }) }); },
      checkAllIng: () => { if (!raw || !raw.ingredients) return; const n = Object.assign({}, s.ing); raw.ingredients.forEach(g => { n[raw.id + g.id] = true; }); this.setState({ ing: n }); },
      restartCook: () => { if (!raw) return; const n = Object.assign({}, s.steps); raw.steps.forEach(x => { delete n[raw.id + x.id]; }); this.setState({ steps: n }); this.cookGo('prep', 0, 'back'); },
      openShare: () => { if (!raw || raw.status !== 'done') return; this.setState({ share: s.shares[raw.id] === 'active' ? 'created' : 'preview' }); },
      closeShare: () => this.setState({ share: null }), shareOpen: !!sh && !!raw,
      sharePrivate: sh !== 'created', sharePublic: sh === 'created', shareCreated: sh === 'created', shareEnded: sh === 'ended',
      shareCanCreate: sh === 'preview' || sh === 'creating' || sh === 'ended', shareCreating: sh === 'creating', shareCreateLabel: sh === 'creating' ? '링크 만드는 중…' : (sh === 'ended' ? '새 공유 링크 만들기' : '공유 링크 만들기'),
      createShare: () => { this.setState({ share: 'creating' }); clearTimeout(this._fl); this._fl = setTimeout(() => { this.setState(st => ({ share: 'created', shares: Object.assign({}, st.shares, { [raw.id]: 'active' }) })); this.toast('공유 링크를 만들었어요'); }, 700); },
      endShare: () => { this.setState({ share: 'ended', shares: Object.assign({}, s.shares, { [raw.id]: 'ended' }) }); this.toast('공유를 종료했어요'); },
      copyShare: () => { try { navigator.clipboard.writeText('https://디미.app/s/k3Xq9fLm').then(() => this.toast('링크를 복사했어요'), () => this.toast('복사하지 못했어요. 직접 선택해 주세요.')); } catch (e) { this.toast('복사하지 못했어요. 직접 선택해 주세요.'); } },
      nativeShare: () => this.toast('기기 공유 시트를 열어요 (데모)'),
      dmModes: [['summary', '핵심 요약과 링크', 'DM에서 핵심만 보고, 자세한 내용은 페이지에서 확인해요.'], ['full', 'DM에서 전체 보기', '정리한 내용을 DM에서 읽어요. 긴 내용은 나눠서 보낼 수 있어요.']].map(([k, label, desc]) => ({ label, desc, checked: s.dmMode === k ? 'true' : 'false', cls: 'radio-card' + (s.dmMode === k ? ' on' : ''), pick: () => { if (s.dmMode !== k) { this.setState({ dmMode: k }); this.toast('앞으로 받을 DM에 적용했어요'); } } })),
      changeAccount: () => this.toast('연결 코드 화면으로 이동해요 (데모)'), disconnect: () => this.toast('연결 해제 확인 시트를 열어요 (데모)'),
      goLibraryFromSettings: () => this.setState({ settingsOpen: false, tab: 'library' }), logout: () => this.toast('로그아웃했어요 (데모)'), withdraw: () => this.toast('탈퇴 처리 기간·보관 예외는 정책 확정 후 안내돼요'),
      toggleDark: () => this.setState({ dark: !s.dark }), darkLabel: s.dark ? '켜짐' : '꺼짐',
      hasToast: !!s.toast, toastMsg: s.toast ? s.toast.msg : '', toastHasAction: !!(s.toast && s.toast.action), toastActionLabel: s.toast ? s.toast.label : '', toastAction: s.toast && s.toast.action ? s.toast.action : () => {}
    }, cookV);
  }
}
