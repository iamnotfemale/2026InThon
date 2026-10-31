import { DCLogic } from './dashboard-runtime.js';

export default class DashboardModel extends DCLogic {
  constructor(props) {
    super(props);
    this.state = {
      view: 'home', from: 'home', detailId: null,
      connected: true, account: '@jimin.daily', connectedAt: '2026.10.31 10:12',
      flow: 'idle', codeLeft: 600, code: 'K7P4M2', pendingAccount: '@jimin.daily', codeIdx: 0,
      dataset: 'full', extra: [], simState: 'idle', over: {},
      deleted: {}, fav: { r1: true, r2: true, e1: true, c1: true }, taste: { r1: true, r2: true, e1: true },
      query: '', typeF: 'all', statusF: 'all', favOnly: false, sort: 'new',
      libError: false, libLoading: false,
      menuId: null, detailMenu: false,
      ing: {}, steps: {},
      modal: null, connModal: 'disconnect', delTarget: null, shareStage: 'preview', shares: {},
      toast: null,
      dmMode: 'full', dmType: 'recipe',
      tasteTab: 'all', tasteSel: null,
      tasteLabel: '15분 안팎의 간단한 팬·면 요리', tasteState: 'ai', tasteRemoved: false, tasteDraft: '',
      conds: [{ id: 1, cat: '조리도구', val: '프라이팬' }, { id: 2, cat: '조리도구', val: '전자레인지' }, { id: 3, cat: '요리 시간', val: '20분 이내' }],
      condCat: '조리도구', condVal: '', condSeq: 4,
      feedback: {}, reportOpen: false, reportReason: null,
      visitOpen: false, retype: null,
      cook: null, cookDir: 'fwd', timer: null, reasonOpen: false, srcOpen: false, libView: 'list',
      name: '지민', nameDraft: '지민', email: 'jimin@example.com',
      demoOpen: false, dark: props && props.theme === 'dark'
    };
  }

  componentDidUpdate(prev) {
    if (prev.theme !== this.props.theme) this.setState({ dark: this.props.theme === 'dark' });
  }

  componentWillUnmount() {
    clearInterval(this._ti); clearTimeout(this._tt); clearTimeout(this._sim); clearTimeout(this._fl); clearInterval(this._ct);
  }

  data() {
    if (this._data) return this._data;
    const TYPE = {
      recipe: { label: '레시피', dot: 'dot t-recipe', orb: 'o-recipe' },
      news: { label: '뉴스·정보', dot: 'dot t-news', orb: 'o-news' },
      exhibit: { label: '전시·팝업', dot: 'dot t-exhibit', orb: 'o-exhibit' },
      contest: { label: '공모전·대외활동', dot: 'dot t-contest', orb: 'o-contest' },
      restaurant: { label: '맛집', dot: 'dot t-restaurant', orb: 'o-restaurant' },
      space: { label: '취향공간', dot: 'dot t-space', orb: 'o-space' },
      unknown: { label: '유형 미정', dot: 'dot t-unknown', orb: 'o-unknown' }
    };
    const STATUS = {
      done: { label: '정리 완료', cls: 'badge s-done', group: 'done' },
      processing: { label: '처리 중', cls: 'badge s-proc', group: 'processing' },
      needtype: { label: '유형 선택 필요', cls: 'badge s-warn', group: 'check' },
      insufficient: { label: '자료 부족', cls: 'badge s-err', group: 'failed' }
    };
    const VERDICT = {
      true: { label: '사실', cls: 'v-true' }, mostly: { label: '대체로 사실', cls: 'v-mostly' },
      mis: { label: '오해의 소지', cls: 'v-mis' }, false: { label: '거짓', cls: 'v-false' }, hold: { label: '판단 유보', cls: 'v-hold' }
    };
    const ITEMS = [
      { id: 'r1', type: 'recipe', title: '15분 매콤 두부면', status: 'done', dm: 'sent', dmAt: '오늘 14:21', received: '오늘 14:20', ts: 10311420, key: '조리 15분 · 재료 5개', author: '@sample_kitchen', origin: 'https://example.com/instagram/reel/r1', organized: '오늘 14:21', checkedAt: '2026.10.31 14:21 KST', thumb: true,
        summary: '두부면에 파기름과 고춧가루 양념을 버무리는 한 그릇 요리예요. 원본 영상의 자막과 음성을 기준으로 정리했어요.',
        serving: '1인분', prep: '5분', cook: '10분',
        ingredients: [
          { id: 'i1', name: '두부면', qty: '1팩 (100g)', group: '기본 재료' },
          { id: 'i2', name: '대파', qty: '1/2대', group: '기본 재료' },
          { id: 'i3', name: '고춧가루', qty: '1큰술 또는 2큰술', group: '양념', flag: true },
          { id: 'i4', name: '간장', qty: '1큰술', group: '양념' },
          { id: 'i5', name: '참기름', qty: '분량 미기재', group: '양념', miss: true }
        ],
        steps: [
          { id: 's1', text: '두부면을 찬물에 헹궈 물기를 빼요.', meta: '시간 미기재', uses: ['두부면'] },
          { id: 's2', text: '팬에 기름을 두르고 대파를 볶아 파기름을 내요.', meta: '중불 · 2분', uses: ['대파'] },
          { id: 's3', text: '불을 끈 뒤 고춧가루를 넣어 섞고, 간장을 넣어요.', meta: '불 끈 상태 · 시간 미기재', uses: ['고춧가루', '간장'], note: '고춧가루 분량이 자막(1큰술)과 음성(2큰술)에서 달라요.', tip: '고춧가루는 불을 끈 뒤 넣어야 타지 않는다고 강조했어요.' },
          { id: 's4', text: '두부면을 넣어 버무리고 참기름을 둘러 마무리해요.', meta: '약불 · 1분', uses: ['두부면', '참기름'] }
        ],
        tips: ['고춧가루는 불을 끈 뒤 넣어야 타지 않는다고 강조했어요.'],
        checks: ['고춧가루 분량이 자막(1큰술)과 음성(2큰술)에서 달라요. 원본을 확인해 주세요.'] },
      { id: 'n1', type: 'news', title: 'A시 청년 교통비 지원이 전원에게 지급된다는 주장', status: 'done', dm: 'sent', dmAt: '오늘 13:06', received: '오늘 13:02', ts: 10311302, key: '판단 · 오해의 소지', author: '@sample_cardnews', origin: 'https://example.com/instagram/p/n1', organized: '오늘 13:05', checkedAt: '2026.10.31 13:05 KST', thumb: true,
        claim: 'A시가 만 19–34세 청년 전원에게 매달 교통비를 지원한다.', verdict: 'mis',
        oneLine: '금액·연령은 맞지만, 지원 대상은 조건을 충족한 신청자뿐이에요.',
        checks: [
          { k: '지원 대상', claim: '청년 전원', found: '소득·거주 조건 충족 신청자', st: 'diff' },
          { k: '지원 금액', claim: '매달 교통비', found: '월 최대 5만 원 (가상)', st: 'match' },
          { k: '대상 연령', claim: '만 19–34세', found: '만 19–34세', st: 'match' },
          { k: '신청 조건', claim: '언급 없음', found: '예산 소진 시 조기 마감', st: 'missing' }
        ],
        reason: '가상 공고상 지원 대상은 소득·거주 기간 조건을 충족한 신청자예요. ‘전원 지급’은 이 조건을 생략한 표현이라 다르게 이해될 수 있어요.',
        same: ['지원 금액(월 최대 5만 원, 가상)과 대상 연령(만 19–34세)은 공고와 같아요.'],
        diff: ['공고는 소득·거주 기간 조건을 충족한 신청자에게 지급한다고 명시해요. 원본은 이 조건을 생략했어요.'],
        context: ['신청 기간과 예산 소진 시 조기 마감될 수 있다는 조건이 원본에 빠져 있어요.'],
        limits: [{ label: '최신 정보 확인 필요', text: '다음 연도 공고 미확인' }],
        needed: [],
        sources: [
          { title: 'A시 청년 교통비 지원 사업 공고 (가상)', org: 'A시 · 가상 기관', date: '2026.10.02', rel: '반박', relCls: 'rel rel-con', why: '지원 대상을 조건을 충족한 신청자로 한정해요.', url: 'https://example.com/a-city/notice' },
          { title: '청년 교통비 지원 자주 묻는 질문 (가상)', org: 'A시 청년정책과 · 가상', date: '2026.10.05', rel: '일부 뒷받침', relCls: 'rel rel-pro', why: '지원 금액과 연령 범위가 원본과 같아요.', url: 'https://example.com/a-city/faq' }
        ] },
      { id: 'e1', type: 'exhibit', title: '빛의 방 — 가상 전시', status: 'done', dm: 'sent', dmAt: '어제 21:15', received: '어제 21:14', ts: 10302114, key: '10.10 – 12.20 · 가상 미술관', author: '@sample_gallery', origin: 'https://example.com/instagram/p/e1', organized: '어제 21:15', checkedAt: '2026.10.30 21:15 KST', thumb: true,
        phase: '진행 중', phaseCls: 'badge s-done',
        intro: '빛과 그림자를 주제로 한 몰입형 설치 전시예요. (가상 데이터)',
        period: '2026.10.10 – 2026.12.20', hours: '화–일 10:00 – 19:00 (입장 마감 18:30)', closed: '매주 월요일',
        place: '가상 미술관 2층', address: '가상시 빛길 12', mapUrl: 'https://example.com/map?q=light-room',
        fee: '성인 15,000원 (가상)', booking: '사전 예약 권장 · 현장 발권 가능', conditions: '만 7세 이상',
        reserveUrl: 'https://example.com/light-room/booking', officialUrl: 'https://example.com/light-room',
        visitDates: ['11월 1일 (일)', '11월 3일 (화)', '11월 4일 (수)', '11월 7일 (토)', '11월 8일 (일)'] },
      { id: 'c1', type: 'contest', title: '대학생 생활 아이디어 공모전', status: 'done', dm: 'unknown', dmAt: '', received: '10월 29일', ts: 10291830, key: '마감 11.14 (토) 18:00 · D-14', author: '@sample_foundation', origin: 'https://example.com/instagram/p/c1', organized: '10월 29일 18:32', checkedAt: '2026.10.29 18:32 KST', thumb: true,
        phase: '모집 중', phaseCls: 'badge s-done',
        host: '가상 재단', organizer: '주관 · 가상 공모전 운영사무국',
        dday: 'D-14', deadline: '2026.11.14 (토) 18:00 KST',
        elig: ['국내 대학 재학생·휴학생', '2–4인 팀 구성 필수', '전공 무관'],
        schedule: [
          { label: '접수 시작', date: '2026.10.20 (화) 10:00', st: 'ok' },
          { label: '접수 마감', date: '2026.11.14 (토) 18:00', st: 'run' },
          { label: '서류 결과 발표', date: '2026.11.28 (토)', st: 'wait' },
          { label: '본선 발표', date: '2026.12.12 (토)', st: 'wait' }
        ],
        submit: ['아이디어 기획서 (PDF)', '3분 소개 영상', '팀원 재학증명서'],
        process: ['공식 홈페이지에서 신청서 작성', '제출물 업로드', '접수 확인 메일 수신'],
        benefit: ['수상팀 시상 — 상금 규모는 공고에서 확인되지 않았어요.', '참가 비용: 무료 (공식 공고 기준)'],
        noticeUrl: 'https://example.com/idea-contest/notice', applyUrl: 'https://example.com/idea-contest/apply' },
      { id: 'r2', type: 'recipe', title: '바삭한 감자 팬 요리', status: 'done', dm: 'failed', dmAt: '', received: '10월 28일', ts: 10281940, key: '조리 시간 미기재', author: null, origin: 'https://example.com/instagram/reel/r2', organized: '10월 28일 19:41', checkedAt: '2026.10.28 19:41 KST', thumb: false,
        summary: '채 썬 감자에 전분을 버무려 팬에 납작하게 굽는 요리예요. 원본에 인분과 시간 정보가 없어요.',
        serving: '인분 미기재', prep: '시간 미기재', cook: '시간 미기재',
        ingredients: [
          { id: 'i1', name: '감자', qty: '2개', group: '기본 재료' },
          { id: 'i2', name: '전분', qty: '2큰술', group: '기본 재료' },
          { id: 'i3', name: '소금', qty: '분량 미기재', group: '양념', miss: true },
          { id: 'i4', name: '식용유', qty: '분량 미기재', group: '양념', miss: true }
        ],
        steps: [
          { id: 's1', text: '감자를 채 썰어 물에 담가 전분기를 빼요.', meta: '시간 미기재', uses: ['감자'] },
          { id: 's2', text: '물기를 닦고 전분과 소금을 버무려요.', meta: '시간 미기재', uses: ['전분', '소금'], tip: '감자의 물기를 충분히 닦아야 바삭해진다고 설명했어요.' },
          { id: 's3', text: '팬에 기름을 두르고 납작하게 펴서 양면을 노릇하게 구워요.', meta: '중불 · 시간 미기재', uses: ['식용유'] }
        ],
        tips: ['감자의 물기를 충분히 닦아야 바삭해진다고 설명했어요.'], checks: [] },
      { id: 'f1', type: 'unknown', title: '접근할 수 없는 게시물', status: 'insufficient', dm: 'guide', dmAt: '10월 30일 09:13', received: '10월 30일', ts: 10300912, key: '원본을 확인하지 못했어요', author: null, origin: 'https://example.com/instagram/p/f1', organized: '', checkedAt: '', thumb: false },
      { id: 'n2', type: 'news', title: 'B연구 결과를 단정적으로 소개한 카드뉴스', status: 'done', dm: 'sent', dmAt: '10월 27일 11:24', received: '10월 27일', ts: 10271120, key: '판단 · 판단 유보', author: '@sample_infocard', origin: 'https://example.com/instagram/p/n2', organized: '10월 27일 11:23', checkedAt: '2026.10.27 11:23 KST', thumb: true,
        claim: 'B연구가 하루 스마트폰 사용 시간이 길수록 대학생 학점이 떨어진다는 것을 증명했다.', verdict: 'hold',
        oneLine: '연구 원문을 확인하지 못해 결론을 내리지 않았어요.',
        checks: [
          { k: '연구 결론', claim: '인과관계 ‘증명’', found: '관련성만 언급 (소개 기사)', st: 'diff' },
          { k: '연구 원문', claim: 'B연구 인용', found: '원문 접근 실패', st: 'missing' },
          { k: '표본·방법', claim: '언급 없음', found: '확인 불가', st: 'missing' }
        ],
        reason: '카드뉴스가 인용한 연구 원문에 접근하지 못했고, 확보한 소개 기사는 관련성만 언급해요. 인과관계를 ‘증명’했는지 판단할 근거가 부족해 결론을 내리지 않았어요.',
        same: ['스마트폰 사용 시간과 학점 사이의 관련성을 다뤘다는 점은 소개 기사와 같아요.'],
        diff: ['소개 기사는 ‘관련이 있다’고 표현했지만, 카드뉴스는 ‘증명했다’고 단정했어요.'],
        context: ['표본 규모·조사 방법·연구 기간이 원본에 없어요.'],
        limits: [{ label: '원문 접근 실패', text: '인용 링크가 열리지 않음' }, { label: '근거 부족', text: '다른 자료 없음' }],
        needed: ['연구 원문', '저자·발행처', '같은 주제의 다른 연구'],
        sources: [
          { title: 'B연구 소개 기사 (가상)', org: '가상 매체', date: '2026.10.20', rel: '판단 근거 부족', relCls: 'rel rel-neutral', why: '관련성만 언급하고 인과관계는 다루지 않아요.', url: 'https://example.com/b-study/article' },
          { title: 'B연구 원문', org: '발행처 확인 불가', date: '발행일 확인 불가', rel: '원문 접근 실패', relCls: 'rel rel-fail', why: '인용된 링크가 열리지 않아 내용을 확인하지 못했어요.', url: null }
        ] },
      { id: 'e2', type: 'exhibit', title: '작은 서재 팝업', status: 'done', dm: 'sent', dmAt: '10월 18일 16:03', received: '10월 18일', ts: 10181602, key: '종료 · 10.03 – 10.19', author: '@sample_bookshop', origin: 'https://example.com/instagram/p/e2', organized: '10월 18일 16:03', checkedAt: '2026.10.18 16:03 KST', thumb: true,
        phase: '종료', phaseCls: 'badge s-neutral',
        intro: '독립 출판물을 모아 소개한 팝업 서점이에요. (가상 데이터)',
        period: '2026.10.03 – 2026.10.19', hours: '12:00 – 20:00', closed: '휴무일 미기재',
        place: '가상 서점 1층', address: '가상시 책방로 5', mapUrl: 'https://example.com/map?q=small-library',
        fee: '무료 (원본 기준)', booking: '예약 필요 여부 미기재', conditions: '관람 조건 미기재',
        reserveUrl: null, officialUrl: null, visitDates: [] },
      { id: 'c2', type: 'contest', title: '로컬 기록단 모집', status: 'done', dm: 'sent', dmAt: '10월 15일 20:11', received: '10월 15일', ts: 10152010, key: '마감 10.25 · 시간 미기재', author: '@sample_culture', origin: 'https://example.com/instagram/p/c2', organized: '10월 15일 20:11', checkedAt: '2026.10.15 20:11 KST', thumb: true,
        phase: '마감', phaseCls: 'badge s-neutral',
        host: '가상 문화재단', organizer: '주관 · 가상 지역기록센터',
        dday: null, deadline: '2026.10.25 (일) · 마감 시간 미기재',
        elig: ['가상시 거주 또는 가상시 소재 학교 재학 중인 만 19–29세', '팀 구성 조건은 공고에 없어요'],
        schedule: [
          { label: '접수 마감', date: '2026.10.25 (일) · 시간 미기재', st: 'ok' },
          { label: '활동 기간', date: '2026.11 – 2027.02', st: 'wait' }
        ],
        submit: ['지원서', '기록물 포트폴리오 (선택)'],
        process: ['공식 공고의 지원서 양식 작성', '이메일로 제출'],
        benefit: ['활동비 지급 여부는 공고에서 확인되지 않았어요.'],
        noticeUrl: 'https://example.com/local-archive/notice', applyUrl: null },
      { id: 'm1', type: 'restaurant', title: '가상 들기름 국수집', status: 'done', dm: 'sent', dmAt: '오늘 12:40', received: '오늘 12:38', ts: 10311238, key: '한식 · 성수동 · 1인 1만원대', author: '@sample_foodie', origin: 'https://example.com/instagram/reel/m1', organized: '오늘 12:40', checkedAt: '2026.10.31 12:40 KST', thumb: true,
        intro: '들기름 막국수와 수육을 파는 국수집이에요. (가상 데이터)', category: '한식', priceRange: '1인 1만원대',
        hours: '매일 11:00 – 21:00 (브레이크타임 15:00 – 17:00)', closed: '휴무일 미기재', address: '가상시 성수로 12',
        mapNaver: 'https://map.naver.com/p/search/%EA%B0%80%EC%83%81%20%EB%93%A4%EA%B8%B0%EB%A6%84%20%EA%B5%AD%EC%88%98%EC%A7%91%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%84%B1%EC%88%98%EB%A1%9C%2012', mapKakao: 'https://map.kakao.com/link/search/%EA%B0%80%EC%83%81%20%EB%93%A4%EA%B8%B0%EB%A6%84%20%EA%B5%AD%EC%88%98%EC%A7%91%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%84%B1%EC%88%98%EB%A1%9C%2012', mapGoogle: 'https://www.google.com/maps/search/?api=1&query=%EA%B0%80%EC%83%81%20%EB%93%A4%EA%B8%B0%EB%A6%84%20%EA%B5%AD%EC%88%98%EC%A7%91%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%84%B1%EC%88%98%EB%A1%9C%2012',
        menus: [
          { name: '들기름 막국수', price: '11,000원', note: '면 추가 무료', signature: true },
          { name: '수육 (소)', price: '18,000원', note: null, signature: false },
          { name: '감자전', price: '가격 미기재', note: null, signature: false }
        ],
        reservation: '예약 받지 않음', waiting: '점심 시간 웨이팅 있음', parking: '주차 정보 미기재', phone: '전화번호 미기재',
        placeLinks: [], checks: ['감자전 가격이 원본에 없어요.'] },
      { id: 'sp1', type: 'space', title: '가상 그림책 서점', status: 'done', dm: 'sent', dmAt: '오늘 11:05', received: '오늘 11:02', ts: 10311102, key: '서점·책방 · 연남동 · 월요일 휴무', author: '@sample_bookshelf', origin: 'https://example.com/instagram/p/sp1', organized: '오늘 11:05', checkedAt: '2026.10.31 11:05 KST', thumb: true,
        intro: '그림책과 독립출판물을 모아 둔 작은 서점이에요. 주말에는 그림책 낭독회를 열어요. (가상 데이터)', category: '서점·책방',
        hours: '화–일 12:00 – 20:00', closed: '월요일 휴무', address: '가상시 연남로 3',
        mapNaver: 'https://map.naver.com/p/search/%EA%B0%80%EC%83%81%20%EA%B7%B8%EB%A6%BC%EC%B1%85%20%EC%84%9C%EC%A0%90%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%97%B0%EB%82%A8%EB%A1%9C%203', mapKakao: 'https://map.kakao.com/link/search/%EA%B0%80%EC%83%81%20%EA%B7%B8%EB%A6%BC%EC%B1%85%20%EC%84%9C%EC%A0%90%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%97%B0%EB%82%A8%EB%A1%9C%203', mapGoogle: 'https://www.google.com/maps/search/?api=1&query=%EA%B0%80%EC%83%81%20%EA%B7%B8%EB%A6%BC%EC%B1%85%20%EC%84%9C%EC%A0%90%20%EA%B0%80%EC%83%81%EC%8B%9C%20%EC%97%B0%EB%82%A8%EB%A1%9C%203',
        reservation: '낭독회는 DM으로 신청', waiting: '대기 정보 미기재', parking: '주차 불가', phone: '전화번호 미기재',
        placeLinks: [], checks: ['낭독회 날짜는 원본에 없어요.'] },
      { id: 'r4', type: 'recipe', title: '들기름 막국수', status: 'done', dm: 'sent', dmAt: '10월 26일 19:12', received: '10월 26일', ts: 10261910, key: '조리 10분 · 재료 5개', author: '@sample_noodle', origin: 'https://example.com/instagram/reel/r4', organized: '10월 26일 19:12', checkedAt: '2026.10.26 19:12 KST', thumb: true,
        summary: '삶은 메밀면에 들기름과 간장 양념을 버무리는 비빔면이에요. (가상 데이터)',
        serving: '1인분', prep: '3분', cook: '7분',
        ingredients: [
          { id: 'i1', name: '메밀면', qty: '1인분 (100g)', group: '기본 재료' },
          { id: 'i2', name: '김가루', qty: '분량 미기재', group: '기본 재료', miss: true },
          { id: 'i3', name: '들기름', qty: '2큰술', group: '양념' },
          { id: 'i4', name: '간장', qty: '1큰술', group: '양념' },
          { id: 'i5', name: '설탕', qty: '1/2작은술', group: '양념' }
        ],
        steps: [
          { id: 's1', text: '끓는 물에 메밀면을 삶아요.', meta: '강불 · 4분', uses: ['메밀면'] },
          { id: 's2', text: '찬물에 빡빡 헹구고 물기를 제거해요.', meta: '시간 미기재', uses: ['메밀면'] },
          { id: 's3', text: '들기름·간장·설탕을 넣고 버무린 뒤 김가루를 올려요.', meta: '시간 미기재', uses: ['들기름', '간장', '설탕', '김가루'] }
        ],
        tips: [], checks: [] },
      { id: 'p1', type: 'unknown', title: '새로 보낸 릴스', status: 'needtype', dm: 'guide2', dmAt: '', received: '오늘 15:02', ts: 10311502, key: '어떤 내용으로 정리할지 선택해 주세요', author: null, origin: 'https://example.com/instagram/reel/p1', organized: '', checkedAt: '', thumb: true }
    ];
    const R3 = { id: 'r3', type: 'recipe', title: '간장 버터 계란밥', status: 'done', dm: 'sent', dmAt: '방금', received: '방금', ts: 10311530, key: '조리 5분 · 재료 5개', author: '@sample_homecook', origin: 'https://example.com/instagram/reel/r3', organized: '방금', checkedAt: '2026.10.31 15:30 KST', thumb: true,
      summary: '버터에 부친 반숙 계란을 밥에 올려 간장으로 비벼 먹는 요리예요. (가상 데이터)',
      serving: '1인분', prep: '2분', cook: '3분',
      ingredients: [
        { id: 'i1', name: '밥', qty: '1공기', group: '기본 재료' },
        { id: 'i2', name: '계란', qty: '1개', group: '기본 재료' },
        { id: 'i3', name: '버터', qty: '1조각 (약 10g)', group: '양념' },
        { id: 'i4', name: '간장', qty: '1큰술', group: '양념' },
        { id: 'i5', name: '쪽파', qty: '분량 미기재', group: '양념', miss: true }
      ],
      steps: [
        { id: 's1', text: '팬에 버터를 녹이고 계란을 반숙으로 부쳐요.', meta: '중불 · 2분', uses: ['버터', '계란'] },
        { id: 's2', text: '밥 위에 계란을 올리고 간장을 둘러요.', meta: '시간 미기재', uses: ['밥', '간장'], tip: '계란 노른자를 터뜨리지 않아야 비빌 때 고소하다고 했어요.' },
        { id: 's3', text: '쪽파를 올려 비벼 먹어요.', meta: '시간 미기재', uses: ['쪽파'] }
      ],
      tips: ['계란 노른자를 터뜨리지 않아야 비빌 때 고소하다고 했어요.'], checks: [] };
    const DM = {
      recipe: { title: '15분 매콤 두부면', orb: 'o-recipe',
        summary: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '15분 매콤 두부면 레시피를 정리했어요.\n재료: 두부면, 대파, 고춧가루, 간장, 참기름\n조리: 약 15분 (준비 5분 · 조리 10분)\n재료 분량과 조리 순서 보기 ↓'],
        full: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '[1/3] 15분 매콤 두부면 · 1인분\n· 두부면 1팩 (100g)\n· 대파 1/2대\n· 고춧가루 1큰술 또는 2큰술 (자막·음성 다름, 확인 필요)\n· 간장 1큰술\n· 참기름 분량 미기재', '[2/3] 조리 순서\n1. 두부면을 찬물에 헹궈 물기를 빼요.\n2. 중불에서 대파를 볶아 파기름을 내요. (2분)\n3. 불을 끄고 고춧가루와 간장을 넣어 섞어요.\n4. 두부면을 넣고 약불에서 버무린 뒤 참기름을 둘러요. (1분)', '[3/3] 팁: 고춧가루는 불을 끈 뒤 넣어야 타지 않아요.\n전체 내용은 페이지에서도 확인할 수 있어요 ↓'] },
      news: { title: 'A시 청년 교통비 지원 카드뉴스', orb: 'o-news',
        summary: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '확인한 주장: A시가 만 19–34세 청년 전원에게 매달 교통비를 지원한다.\n판단: 오해의 소지\n가상 공고상 지원 대상은 소득·거주 조건을 충족한 신청자예요.\n근거: A시 청년 교통비 지원 사업 공고 (가상) example.com/a-city/notice\n전체 설명과 출처 ↓'],
        full: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '[1/2] 확인한 주장: A시가 만 19–34세 청년 전원에게 매달 교통비를 지원한다.\n판단: 오해의 소지\n이유: 공고는 조건을 충족한 신청자에게만 지급한다고 명시해요. 금액·연령은 원본과 같아요.', '[2/2] 출처\n· A시 청년 교통비 지원 사업 공고 (가상) — example.com/a-city/notice\n· 청년 교통비 지원 FAQ (가상) — example.com/a-city/faq\n한계: 신청 기간·예산 조기 마감 조건은 원본에 없었어요.\n확인 시점: 2026.10.31 13:05 KST\n전체 내용은 페이지에서도 확인할 수 있어요 ↓'] },
      exhibit: { title: '빛의 방 — 가상 전시', orb: 'o-exhibit',
        summary: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '빛의 방 — 가상 전시\n장소: 가상 미술관 2층 (가상시 빛길 12)\n기간: 2026.10.10 – 12.20\n예약: example.com/light-room/booking\n지도와 상세 정보 ↓'],
        full: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '[1/2] 빛의 방 — 가상 전시 · 진행 중\n장소: 가상 미술관 2층 (가상시 빛길 12)\n기간: 2026.10.10 – 12.20\n운영: 화–일 10:00 – 19:00 (월요일 휴무)\n입장료: 성인 15,000원 (가상)', '[2/2] 예약: example.com/light-room/booking\n공식 안내: example.com/light-room\n지도와 상세 정보 ↓'] },
      contest: { title: '대학생 생활 아이디어 공모전', orb: 'o-contest',
        summary: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '대학생 생활 아이디어 공모전\n대상: 대학 재학·휴학생 2–4인 팀\n마감: 2026.11.14 (토) 18:00 KST\n공식 공고: example.com/idea-contest/notice\n준비할 내용과 상세 조건 ↓'],
        full: ['콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요.', '[1/2] 대학생 생활 아이디어 공모전 · 모집 중\n대상: 국내 대학 재학생·휴학생, 2–4인 팀, 전공 무관\n마감: 2026.11.14 (토) 18:00 KST\n제출물: 기획서 (PDF), 3분 소개 영상, 재학증명서', '[2/2] 절차: 신청서 작성 → 제출물 업로드 → 접수 확인 메일\n공식 공고: example.com/idea-contest/notice\n지원 페이지: example.com/idea-contest/apply\n상세 조건 ↓'] }
    };
    this._data = { TYPE, STATUS, VERDICT, ITEMS, R3, DM };
    return this._data;
  }

  toast(msg, actionLabel, action, ms) {
    clearTimeout(this._tt);
    this.setState({ toast: { msg, actionLabel: actionLabel || null, action: action || null, k: Date.now() } });
    this._tt = setTimeout(() => this.setState({ toast: null }), ms || (action ? 6000 : 3200));
  }

  copy(text, okMsg) {
    const fail = () => this.toast('복사하지 못했어요. 직접 선택해 복사해 주세요.');
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => this.toast(okMsg), fail);
      } else { fail(); }
    } catch (e) { fail(); }
  }

  go(view, extra) {
    this.setState(Object.assign({ view, menuId: null, demoOpen: false, detailMenu: false, reportOpen: false }, extra || {}));
    try { window.scrollTo({ top: 0, behavior: 'smooth' }); } catch (e) {}
  }

  openDetail(id) {
    const s = this.state;
    this.go('detail', { detailId: id, from: s.view === 'detail' ? s.from : s.view, visitOpen: false, retype: null, cook: null, timer: null, reasonOpen: false, srcOpen: false });
  }

  allItems() {
    const s = this.state; const D = this.data();
    const base = s.dataset === 'full' ? D.ITEMS : [];
    return base.concat(s.extra).filter(it => !s.deleted[it.id]).map(it => Object.assign({}, it, s.over[it.id] || {}));
  }

  simulateDm() {
    const s = this.state;
    if (!s.connected || s.simState !== 'idle') return;
    const proc = { id: 'r3', type: 'unknown', title: '새로 보낸 콘텐츠', status: 'processing', dm: 'waiting', dmAt: '', received: '방금', ts: 10311530, key: '콘텐츠를 정리하고 있어요', author: null, origin: 'https://example.com/instagram/reel/r3', organized: '', checkedAt: '', thumb: true };
    this.setState({ extra: s.extra.concat([proc]), simState: 'running', demoOpen: false });
    this.toast('콘텐츠를 받았어요. 내용을 확인해 정리해드릴게요. (데모)');
    this._sim = setTimeout(() => {
      const R3 = this.data().R3;
      this.setState(st => ({ extra: st.extra.map(x => x.id === 'r3' ? Object.assign({}, R3) : x), simState: 'done' }));
      this.toast('간장 버터 계란밥 정리를 마치고 DM으로 보냈어요', 'DM 링크 열기', () => { this.setState({ toast: null }); this.openDetail('r3'); });
    }, 2800);
  }

  setScenario(k) {
    clearTimeout(this._sim); clearInterval(this._ti);
    if (k === 'disconnected') this.setState({ connected: false, flow: 'idle', dataset: 'empty', extra: [], simState: 'idle', view: 'home', demoOpen: false });
    if (k === 'empty') this.setState({ connected: true, flow: 'idle', dataset: 'empty', extra: [], simState: 'idle', view: 'home', demoOpen: false });
    if (k === 'full') this.setState({ connected: true, flow: 'idle', dataset: 'full', view: 'home', demoOpen: false });
  }

  startCode() {
    clearInterval(this._ti); clearTimeout(this._fl);
    const codes = ['K7P4M2', 'R3D8Q5', 'M9T2X6'];
    const idx = (this.state.codeIdx + (this.state.flow === 'idle' ? 0 : 1)) % codes.length;
    this.setState({ flow: 'issuing', modal: null });
    this._fl = setTimeout(() => {
      this.setState({ flow: 'code', codeLeft: 600, code: codes[idx], codeIdx: idx });
      this._ti = setInterval(() => {
        if (this.state.flow !== 'code') { clearInterval(this._ti); return; }
        const n = this.state.codeLeft - 1;
        if (n <= 0) { clearInterval(this._ti); this.setState({ flow: 'expired', codeLeft: 0 }); }
        else this.setState({ codeLeft: n });
      }, 1000);
    }, 750);
  }

  secsOf(meta) {
    const part = (meta || '').split(' · ').map(s => s.trim()).find(s => /^(?:약\s*)?(?:\d+분(?:\s*\d+초)?|\d+초)$/.test(s));
    if (!part) return 0;
    return Number(/(\d+)분/.exec(part)?.[1] || 0) * 60 + Number(/(\d+)초/.exec(part)?.[1] || 0);
  }
  fmt(sec) { return String(Math.floor(sec / 60)).padStart(2, '0') + ':' + String(sec % 60).padStart(2, '0'); }
  chipsOf(meta) { return (meta || '').split(' · ').map(l => ({ label: l, cls: 'mchip' + (/미기재/.test(l) ? ' miss' : '') })); }
  recipe() { return this.allItems().find(it => it.id === this.state.detailId); }
  timerFor(r, stage, idx) {
    if (stage !== 'step' || !r || !r.steps[idx]) return null;
    const secs = this.secsOf(r.steps[idx].meta);
    return secs ? { idx, left: secs, total: secs, running: false } : null;
  }
  cookGo(stage, idx, dir) {
    clearInterval(this._ct);
    this.setState({ cook: { stage, idx }, cookDir: dir, timer: this.timerFor(this.recipe(), stage, idx) });
  }
  cookNext() {
    const s = this.state; const r = this.recipe(); const c = s.cook; if (!c || !r) return;
    if (c.stage === 'prep') return this.cookGo('step', 0, 'fwd');
    if (c.stage === 'step') {
      const key = r.id + r.steps[c.idx].id;
      this.setState({ steps: Object.assign({}, s.steps, { [key]: true }) });
      if (c.idx < r.steps.length - 1) this.cookGo('step', c.idx + 1, 'fwd'); else this.cookGo('done', 0, 'fwd');
    }
  }
  cookPrev() {
    const c = this.state.cook; const r = this.recipe(); if (!c || !r) return;
    if (c.stage === 'step') { if (c.idx > 0) this.cookGo('step', c.idx - 1, 'back'); else this.cookGo('prep', 0, 'back'); }
    else if (c.stage === 'done') this.cookGo('step', r.steps.length - 1, 'back');
  }
  timerToggle() {
    const t = this.state.timer; if (!t) return;
    clearInterval(this._ct);
    if (t.running) { this.setState({ timer: Object.assign({}, t, { running: false }) }); return; }
    this.setState({ timer: Object.assign({}, t, { left: t.left <= 0 ? t.total : t.left, running: true }) });
    this._ct = setInterval(() => {
      const tt = this.state.timer;
      if (!tt || !tt.running) { clearInterval(this._ct); return; }
      const n = tt.left - 1;
      if (n <= 0) { clearInterval(this._ct); this.setState({ timer: Object.assign({}, tt, { left: 0, running: false }) }); this.toast('타이머가 끝났어요. 다음 단계로 넘어가세요.'); }
      else this.setState({ timer: Object.assign({}, tt, { left: n }) });
    }, 1000);
  }

  renderVals() {
    const s = this.state; const D = this.data(); const T = D.TYPE, ST = D.STATUS;
    const all = this.allItems();
    const deco = (it) => {
      const t = T[it.type] || T.unknown; const st = ST[it.status]; const fav = !!s.fav[it.id];
      return Object.assign({}, it, {
        typeLabel: t.label, dot: t.dot, orbCls: 'orb ' + t.orb + (it.status === 'processing' ? ' fast' : ''),
        statusLabel: st.label, statusCls: st.cls, group: st.group,
        favCls: 'btn btn-icon btn-ghost star' + (fav ? ' on' : ''), favLabel: fav ? '즐겨찾기 해제' : '즐겨찾기에 추가', favPressed: fav ? 'true' : 'false',
        open: () => this.openDetail(it.id),
        toggleFav: () => { this.setState({ fav: Object.assign({}, s.fav, { [it.id]: !fav }) }); this.toast(fav ? '즐겨찾기에서 뺐어요' : '즐겨찾기에 추가했어요'); },
        toggleFavMenu: () => { this.setState({ menuId: null, fav: Object.assign({}, s.fav, { [it.id]: !fav }) }); this.toast(fav ? '즐겨찾기에서 뺐어요' : '즐겨찾기에 추가했어요'); },
        menuOpen: s.menuId === it.id, menuExpanded: s.menuId === it.id ? 'true' : 'false',
        toggleMenu: () => this.setState({ menuId: s.menuId === it.id ? null : it.id }),
        askDelete: () => this.setState({ modal: 'delete', delTarget: it.id, menuId: null, detailMenu: false }),
        hasOrigin: !!it.origin, noOrigin: !it.origin,
        isProc: it.status === 'processing',
        cta: it.status === 'needtype' ? '유형 선택하기' : '진행 보기',
        showBadge: it.status !== 'needtype',
        starCardCls: 'btn btn-icon btn-sm star lcard-star' + (fav ? ' on' : '')
      });
    };
    const items = all.map(deco);
    const counts = { recipe: 0, news: 0, exhibit: 0, contest: 0, restaurant: 0, space: 0 };
    items.forEach(it => { if (counts[it.type] !== undefined) counts[it.type]++; });
    const tasteItemsAll = items.filter(it => s.taste[it.id] && it.status === 'done' && ['recipe','exhibit','space','contest','restaurant'].includes(it.type));

    // library
    const q = s.query.trim().toLowerCase();
    const matchQ = it => this.matchesContent ? this.matchesContent(it, s.query) : !q || [it.title, it.key, it.summary, it.claim, it.intro, it.place].join(' ').toLowerCase().indexOf(q) >= 0;
    let lib = items.filter(it => matchQ(it) && (s.typeF === 'all' || it.type === s.typeF) && (s.statusF === 'all' || it.group === s.statusF) && (!s.favOnly || s.fav[it.id]));
    lib.sort((a, b) => q && s.semanticSearch?.query === s.query.trim() ? s.semanticSearch.ids.indexOf(a.id) - s.semanticSearch.ids.indexOf(b.id) : s.sort === 'new' ? b.ts - a.ts : a.ts - b.ts);
    const isFiltered = s.typeF !== 'all' || s.statusF !== 'all' || s.favOnly || !!q;
    const libBlocked = s.libError || s.libLoading;
    const libFirst = items.length === 0;
    const libSearchEmpty = !libFirst && lib.length === 0 && !!q;
    const libFilterEmpty = !libFirst && lib.length === 0 && !q;
    const typeTabs = [['all', '전체', null, items.length], ['recipe', '레시피', 'dot t-recipe', counts.recipe], ['news', '뉴스·정보', 'dot t-news', counts.news], ['exhibit', '전시·팝업', 'dot t-exhibit', counts.exhibit], ['contest', '공모전·대외활동', 'dot t-contest', counts.contest], ['restaurant', '맛집', 'dot t-restaurant', counts.restaurant], ['space', '취향공간', 'dot t-space', counts.space]].map(([k, label, dot, count]) => ({ label, dot, hasDot: !!dot, count, cls: s.typeF === k ? 'on' : '', pressed: s.typeF === k ? 'true' : 'false', pick: () => this.setState({ typeF: k, menuId: null }) }));
    const statusChips = [['all', '전체 상태'], ['processing', '처리 중'], ['done', '정리 완료'], ['check', '확인 필요'], ['failed', '처리하지 못함']].map(([k, label]) => ({ label, cls: 'chip' + (s.statusF === k ? ' on' : ''), pressed: s.statusF === k ? 'true' : 'false', pick: () => this.setState({ statusF: k, menuId: null }) }));
    const sideTypes = [['recipe', '레시피'], ['news', '뉴스·정보'], ['exhibit', '전시·팝업'], ['contest', '공모전·대외활동'], ['restaurant', '맛집'], ['space', '취향공간']].map(([k, label]) => ({ label, dot: 'dot t-' + k, count: counts[k], pick: () => this.go('library', { typeF: k, statusF: 'all', query: '', favOnly: false }) }));

    // home
    const active = items.filter(it => it.status === 'processing' || it.status === 'needtype').sort((a, b) => b.ts - a.ts);
    const recent = items.filter(it => it.status === 'done').sort((a, b) => b.ts - a.ts).slice(0, 9);
    const schedule = [];
    const c1 = items.find(it => it.id === 'c1'); const e1 = items.find(it => it.id === 'e1');
    if (c1) { schedule.push({ mon: '11월', day: '14', title: c1.title, what: '접수 마감 · 18:00 KST', badge: 'D-14', badgeCls: 'badge nodot s-warn', open: () => this.openDetail('c1') }); schedule.push({ mon: '11월', day: '28', title: c1.title, what: '서류 결과 발표', badge: 'D-28', badgeCls: 'badge nodot s-neutral', open: () => this.openDetail('c1') }); }
    if (e1) schedule.push({ mon: '12월', day: '20', title: e1.title, what: '전시 종료일 · 진행 중', badge: 'D-50', badgeCls: 'badge nodot s-neutral', open: () => this.openDetail('e1') });

    // detail
    let d = { tasteable: false, pipeline: [], legend: [], sources: [], ingredients: [], steps: [], tips: [], checks: [], same: [], diff: [], context: [], limits: [], needed: [], elig: [], schedule: [], submit: [], process: [], benefit: [], visitDates: [], menus: [], placeLinks: [], shareIncludes: [] };
    const raw = items.find(it => it.id === s.detailId);
    if (raw) {
      d = Object.assign({}, raw);
      const done = raw.status === 'done';
      d.isDone = done; d.isRecipe = done && raw.type === 'recipe'; d.isNews = done && raw.type === 'news'; d.isExhibit = done && raw.type === 'exhibit'; d.isContest = done && raw.type === 'contest'; d.isRestaurant = done && raw.type === 'restaurant'; d.isSpace = done && raw.type === 'space';
      d.isProc = raw.status === 'processing'; d.isNeedType = raw.status === 'needtype'; d.isInsufficient = raw.status === 'insufficient';
      d.hasAuthor = !!raw.author; d.hasPhase = !!raw.phase && done;
      d.thumbNote = raw.thumb ? '유형별 대체 이미지' : '원본 썸네일 없음';
      d.tasteable = done && ['recipe','exhibit','space','contest','restaurant'].includes(raw.type);
      const tOn = !!s.taste[raw.id];
      d.tasteBtnCls = 'btn' + (tOn ? ' btn-primary' : ''); d.tasteLabel = tOn ? '취향에 모음' : '취향으로 모으기'; d.tastePressed = tOn ? 'true' : 'false';
      d.toggleTaste = () => { this.setState({ taste: Object.assign({}, s.taste, { [raw.id]: !tOn }) }); this.toast(tOn ? '취향에서 뺐어요. 정리 결과는 그대로 있어요.' : '내 취향에 모았어요', tOn ? null : '내 취향 보기', tOn ? null : () => { this.setState({ toast: null }); this.go('taste', { tasteTab: raw.type }); }); };
      d.shareDisabled = !done; d.shareHint = done ? '정리 결과 공유' : '결과가 준비되면 공유할 수 있어요';
      d.shareActive = s.shares[raw.id] === 'active';
      d.isNewsOrDone = done;
      // pipeline
      const pipe = [{ label: '접수됨', sub: raw.received, cls: 'pstep ok' }];
      if (done) pipe.push({ label: '정리 완료', sub: raw.organized, cls: 'pstep ok' });
      if (raw.status === 'processing') pipe.push({ label: '정리 중', sub: '콘텐츠를 정리하고 있어요', cls: 'pstep run' });
      if (raw.status === 'needtype') pipe.push({ label: '유형 선택 필요', sub: '정리할 유형을 골라 주세요', cls: 'pstep warn' });
      if (raw.status === 'insufficient') pipe.push({ label: '정리하지 못함', sub: '원본 자료 부족', cls: 'pstep err' });
      const dmMap = { sent: ['DM 발송 확인', raw.dmAt, 'pstep ok'], failed: ['DM 전달 실패', '결과는 이 페이지에 있어요', 'pstep err'], unknown: ['DM 전달 미확인', '전달 여부를 확인하지 못했어요', 'pstep warn'], waiting: ['DM 대기', '정리가 끝나면 보내요', 'pstep wait'], guide: ['안내 DM 발송', raw.dmAt, 'pstep ok'], guide2: ['유형 선택 DM 발송', '같은 선택지를 DM으로 보냈어요', 'pstep ok'] };
      const dm = dmMap[raw.dm] || dmMap.waiting;
      pipe.push({ label: dm[0], sub: dm[1], cls: dm[2] });
      d.pipeline = pipe;
      d.dmIssue = raw.dm === 'failed' || raw.dm === 'unknown';
      d.dmNote = raw.dm === 'failed' ? 'DM으로 전달하지 못했어요. 정리 결과는 이 페이지에서 그대로 볼 수 있어요.' : 'DM 전달 여부를 확인하지 못했어요. 정리 결과는 이 페이지에서 그대로 볼 수 있으니 다시 보내지 않아도 돼요.';
      d.procTitle = s.over[raw.id] && s.over[raw.id].procType ? s.over[raw.id].procType + '(으)로 정리하고 있어요' : '콘텐츠를 정리하고 있어요';
      if (raw.type === 'recipe' && done) {
        let prevG = null;
        d.ingredients = raw.ingredients.map(g => { const key = raw.id + g.id; const ck = !!s.ing[key]; const show = g.group !== prevG; prevG = g.group; return Object.assign({}, g, { checked: ck, showGroup: show, flag: !!g.flag, cls: 'ing' + (ck ? ' is-done' : '') + (g.flag ? ' flag' : ''), qtyCls: g.miss ? 'miss' : '', toggle: () => this.setState({ ing: Object.assign({}, this.state.ing, { [key]: !ck }) }) }); });
        d.ingCount = raw.ingredients.length;
        const ingCk = {}; raw.ingredients.forEach(g => { ingCk[g.name] = !!s.ing[raw.id + g.id]; });
        const curIdx = raw.steps.findIndex(st => !s.steps[raw.id + st.id]);
        let doneN = 0;
        d.steps = raw.steps.map((st, i) => {
          const key = raw.id + st.id; const ck = !!s.steps[key]; if (ck) doneN++;
          const cur = i === curIdx; const secs = this.secsOf(st.meta);
          return Object.assign({}, st, {
            n: i + 1, checked: ck, pressed: ck ? 'true' : 'false', isCurrent: cur,
            tlCls: 'tl' + (ck ? ' done' : '') + (cur ? ' current' : ''), segCls: 'sbar' + (ck ? ' done' : '') + (cur ? ' cur' : ''),
            aria: (i + 1) + '단계 ' + (ck ? '완료 취소' : '완료로 표시'),
            chips: this.chipsOf(st.meta), uses: (st.uses || []).map(n => ({ name: n, cls: 'uchip' + (ingCk[n] ? ' ok' : '') })), hasUses: !!(st.uses && st.uses.length),
            metaText: (st.meta || '').split(' · ').concat(st.uses || []).join(' · '), showNote: !!st.note && cur, timerAria: secs ? (secs / 60) + '분 타이머 열기' : '',
            hasNote: !!st.note, note: st.note || '', hasTip: !!st.tip, tip: st.tip || '', hasTimer: secs > 0, noTimer: !secs, timerLabel: secs ? (secs / 60) + '분' : '',
            visCls: 'stepvis' + (ck ? ' done' : ''), visHint: ck ? '완료했어요 · 다시 누르면 취소돼요' : '시간 정보가 없어요 · 끝나면 눌러서 완료로 표시',
            toggle: () => this.setState({ steps: Object.assign({}, this.state.steps, { [key]: !ck }) }),
            cookFrom: () => this.cookGo('step', i, 'fwd')
          });
        });
        d.stepDone = doneN; d.stepTotal = raw.steps.length; d.stepPct = Math.round(doneN / raw.steps.length * 100) + '%';
        d.allStepsDone = doneN === raw.steps.length; d.noStepsDone = doneN === 0;
        const mc = v => /미기재/.test(v) ? 'v miss' : 'v';
        d.serving = raw.serving; d.servingCls = mc(raw.serving); d.prepCls = mc(raw.prep); d.cookCls = mc(raw.cook);
        d.shareIncludes = ['요리 이름과 요약', '재료·분량, 조리 순서, 팁', 'Instagram 원본 링크'];
      }
      if (raw.type === 'news' && done) {
        const v = D.VERDICT[raw.verdict];
        d.verdictCls = 'verdict ' + v.cls; d.verdictLabel = v.label; d.vcls = 'vic ' + v.cls;
        d.gaugeOn = raw.verdict !== 'hold'; d.gaugeSub = raw.verdict === 'hold' ? '근거 부족으로 위치 미표시' : '판단';
        d.needleDeg = ({ false: -101.25, mis: -33.75, mostly: 33.75, true: 101.25 }[raw.verdict] || 0) + 'deg';
        d.gaugeAria = '판단: ' + v.label;
        d.isTrue = raw.verdict === 'true'; d.isMostly = raw.verdict === 'mostly'; d.isMis = raw.verdict === 'mis'; d.isFalse = raw.verdict === 'false'; d.isHold = raw.verdict === 'hold';
        d.legend = ['true', 'mostly', 'mis', 'false', 'hold'].map(k => ({ label: D.VERDICT[k].label, cls: 'vstep ' + D.VERDICT[k].cls + (k === raw.verdict ? ' on' : ''), isTrue: k === 'true', isMostly: k === 'mostly', isMis: k === 'mis', isFalse: k === 'false', isHold: k === 'hold' }));
        const relText = { 'rel rel-con': '주장과 다른 근거', 'rel rel-pro': '주장과 일치하는 근거', 'rel rel-neutral': '판단 근거로 부족', 'rel rel-fail': '원문을 열 수 없음' };
        d.sources = raw.sources.map((sr, i) => Object.assign({}, sr, { n: i + 1, hasUrl: !!sr.url, noUrl: !sr.url, ini: (sr.org || '?').trim().charAt(0), relText: relText[sr.relCls] || sr.rel, relOk: sr.relCls === 'rel rel-pro', relNo: sr.relCls === 'rel rel-con', relNa: sr.relCls === 'rel rel-neutral' || sr.relCls === 'rel rel-fail' }));
        d.cmp = (raw.checks || []).map(c => Object.assign({}, c, { cls: 'cmp ' + c.st, isMatch: c.st === 'match', isDiff: c.st === 'diff', isMissing: c.st === 'missing' }));
        const cnt = st => d.cmp.filter(c => c.st === st).length;
        d.cmpSummary = ['일치 ' + cnt('match'), '다름 ' + cnt('diff'), '확인 안 됨 ' + cnt('missing')].join(' · ');
        d.sourceCount = raw.sources.length; d.hasNeeded = raw.needed.length > 0;
        d.shareIncludes = ['확인한 주장과 판단', '판단 이유·한계·근거 자료 링크', '확인 시점과 원본 링크'];
      }
      if (raw.type === 'exhibit' && done) {
        d.hasReserve = !!raw.reserveUrl;
        d.closedCls = /미기재/.test(raw.closed) ? 'v miss' : 'v'; d.bookingCls = /미기재/.test(raw.booking) ? 'v miss' : 'v'; d.condCls = /미기재/.test(raw.conditions) ? 'v miss' : 'v';
        d.visitDates = raw.visitDates.map(label => ({ label, pick: () => { this.setState({ visitOpen: false }); this.toast(label + ' 관람 일정을 캘린더에 추가하도록 열었어요 (데모)'); } }));
        d.shareIncludes = ['행사명·기간·운영 시간', '장소·입장료·예약 안내', '공식 링크와 원본 링크'];
      }
      if (raw.type === 'contest' && done) {
        d.hasDday = !!raw.dday; d.closedRecruit = !raw.dday; d.hasApply = !!raw.applyUrl;
        d.schedule = raw.schedule.map(x => Object.assign({}, x, { cls: 'pstep ' + x.st }));
        d.submit = raw.submit.map((t, i) => ({ n: String(i + 1).padStart(2, '0'), t }));
        d.process = raw.process.map((t, i) => ({ n: String(i + 1).padStart(2, '0'), t }));
        d.shareIncludes = ['공고명·주최·모집 상태', '지원 조건·마감·제출물·절차', '공식 공고 링크와 원본 링크'];
      }
      if (raw.type === 'restaurant' && done) {
        const miss = v => /미기재|없어요/.test(v || '') ? 'v miss' : 'v';
        d.priceRangeCls = miss(raw.priceRange); d.hoursCls = miss(raw.hours); d.closedCls = miss(raw.closed);
        d.reservationCls = miss(raw.reservation); d.waitingCls = miss(raw.waiting); d.parkingCls = miss(raw.parking); d.phoneCls = miss(raw.phone);
        d.addressCls = /미기재/.test(raw.address || '') ? 'miss' : 'muted';
        d.menus = raw.menus.map((m, i) => Object.assign({}, m, { k: i, hasNote: !!m.note, signature: !!m.signature, priceCls: 'price' + (/미기재/.test(m.price) ? ' miss' : '') }));
        d.menuCount = raw.menus.length; d.noMenus = raw.menus.length === 0;
        d.placeLinks = raw.placeLinks || []; d.hasPlaceLinks = d.placeLinks.length > 0;
        d.shareIncludes = ['가게 이름·분류·소개', '위치와 지도 검색 링크', '메뉴·가격과 이용 정보'];
      }
      if (raw.type === 'space' && done) {
        const miss = v => /미기재|없어요/.test(v || '') ? 'v miss' : 'v';
        d.hoursCls = miss(raw.hours); d.closedCls = miss(raw.closed);
        d.reservationCls = miss(raw.reservation); d.waitingCls = miss(raw.waiting); d.parkingCls = miss(raw.parking); d.phoneCls = miss(raw.phone);
        d.addressCls = /미기재/.test(raw.address || '') ? 'miss' : 'muted';
        d.placeLinks = raw.placeLinks || []; d.hasPlaceLinks = d.placeLinks.length > 0;
        d.shareIncludes = ['공간 이름·분류·소개', '위치와 지도 검색 링크', '운영 시간과 이용 정보'];
      }
    }

    // cook mode
    const ck = s.cook && raw && raw.type === 'recipe' && raw.status === 'done' ? s.cook : null;
    let cookV = { cookOpen: false, cookSteps: [], cookSegs: [] };
    if (ck) {
      const N = raw.steps.length; const ready = d.ingredients.filter(g => g.checked).length; const total = d.ingredients.length;
      const t = s.timer; const C = 351.86;
      cookV = {
        cookOpen: true, cookPrep: ck.stage === 'prep', cookDone: ck.stage === 'done', cookNotDone: ck.stage !== 'done',
        cookBodyCls: 'cook-body' + (s.cookDir === 'back' ? ' back' : ''),
        cookCounter: ck.stage === 'prep' ? '재료 준비' : (ck.stage === 'done' ? '완료' : (ck.idx + 1) + ' / ' + N),
        cookPrepCount: total + '개 중 ' + ready + '개 준비됨',
        cookHint: ck.stage === 'prep' ? (ready === total ? '재료 준비 완료' : (total - ready) + '개 남았어요 · 그대로 시작해도 돼요') : '다음을 누르면 이 단계를 완료로 표시해요',
        cookNextLabel: ck.stage === 'prep' ? '조리 시작' : (ck.idx === N - 1 ? '조리 완료' : '다음 단계'),
        cookPrevDisabled: ck.stage === 'prep',
        cookSteps: d.steps.map((st, i) => Object.assign({}, st, { active: ck.stage === 'step' && ck.idx === i })),
        cookSegs: [{ cls: 'csg' + (ck.stage === 'prep' ? ' cur' : ' done'), aria: '재료 준비로 이동', go: () => this.cookGo('prep', 0, 'back') }].concat(d.steps.map((st, i) => ({ cls: 'csg' + (st.checked ? ' done' : '') + (ck.stage === 'step' && ck.idx === i ? ' cur' : ''), aria: (i + 1) + '단계로 이동', go: () => this.cookGo('step', i, (ck.stage === 'prep' || (ck.stage === 'step' && i > ck.idx)) ? 'fwd' : 'back') }))),
        timerTime: t ? this.fmt(t.left) : '00:00', timerOffset: t ? (C * (1 - t.left / t.total)).toFixed(1) : '0',
        ringCls: 'ring' + (t && t.running ? ' running' : ''),
        timerBtnLabel: !t ? '타이머 시작' : (t.running ? '일시정지' : (t.left === t.total ? '타이머 시작' : (t.left === 0 ? '다시 시작' : '계속'))),
        cookDoneText: N + '단계를 모두 완료했어요.'
      };
    }

    // taste
    const tabType = s.tasteTab === 'recipe' ? 'recipe' : 'exhibit';
    const tasteItems = tasteItemsAll.filter(it => it.type === tabType).map(it => Object.assign({}, it, { remove: () => { this.setState({ taste: Object.assign({}, this.state.taste, { [it.id]: false }) }); this.toast('취향에서 뺐어요. 원래 정리 결과는 그대로 있어요.'); } }));
    const tasteCardEligible = tabType === 'recipe' && tasteItems.length >= 2;
    const tasteTabs = [['recipe', '레시피', 'dot t-recipe'], ['exhibit', '전시·공간', 'dot t-exhibit']].map(([k, label, dot]) => ({ label, dot, count: tasteItemsAll.filter(it => it.type === k).length, cls: s.tasteTab === k ? 'on' : '', pressed: s.tasteTab === k ? 'true' : 'false', pick: () => this.setState({ tasteTab: k }) }));
    const tb = { ai: ['AI 제안', 'badge s-neutral'], confirmed: ['확인함', 'badge s-done'], edited: ['직접 수정함', 'badge s-info'] }[s.tasteState];

    // settings
    const f = s.flow; const mm = String(Math.floor(s.codeLeft / 60)).padStart(2, '0'); const ss = String(s.codeLeft % 60).padStart(2, '0');
    const dmSample = D.DM[s.dmType] || D.DM.recipe;
    const activeShares = items.filter(it => s.shares[it.id] === 'active').map(it => ({ title: it.title, orbCls: it.orbCls, open: () => this.openDetail(it.id) }));

    // modals
    const shareActive = raw && s.shares[raw.id] === 'active';
    const delItem = items.find(it => it.id === s.delTarget);
    const viewLabels = { home: '홈', library: '내 콘텐츠', detail: '내 콘텐츠', taste: '내 취향', settings: '설정' };
    const fromLabel = viewLabels[s.from] || '내 콘텐츠';
    const scen = !s.connected ? 'disconnected' : (s.dataset === 'full' ? 'full' : 'empty');
    const scenLabels = { disconnected: '연결 전', empty: '첫 콘텐츠 전', full: '콘텐츠 쌓임' };

    return Object.assign({
      rootCls: 'app' + (s.dark ? ' dark' : ''),
      startCook: () => this.cookGo('prep', 0, 'fwd'),
      closeCook: () => { clearInterval(this._ct); this.setState({ cook: null, timer: null }); },
      cookNext: () => this.cookNext(), cookPrev: () => this.cookPrev(),
      timerToggle: () => this.timerToggle(),
      timerReset: () => { clearInterval(this._ct); const t = this.state.timer; if (t) this.setState({ timer: Object.assign({}, t, { left: t.total, running: false }) }); },
      checkAllIng: () => { if (!raw || !raw.ingredients) return; const next = Object.assign({}, s.ing); raw.ingredients.forEach(g => { next[raw.id + g.id] = true; }); this.setState({ ing: next }); },
      restartCook: () => { if (!raw) return; const next = Object.assign({}, s.steps); raw.steps.forEach(st => { delete next[raw.id + st.id]; }); this.setState({ steps: next }); this.cookGo('prep', 0, 'back'); },
      resetSteps: () => { if (!raw || !raw.steps) return; const next = Object.assign({}, s.steps); raw.steps.forEach(st => { delete next[raw.id + st.id]; }); this.setState({ steps: next }); },
      reasonOpen: s.reasonOpen, reasonExpanded: s.reasonOpen ? 'true' : 'false', reasonChevCls: 'chev' + (s.reasonOpen ? ' open' : ''),
      toggleReason: () => this.setState({ reasonOpen: !s.reasonOpen }),
      srcOpen: s.srcOpen, srcExpanded: s.srcOpen ? 'true' : 'false', srcChevCls: 'chev muted' + (s.srcOpen ? ' open' : ''),
      toggleSrc: () => this.setState({ srcOpen: !s.srcOpen }),
      libIsList: s.libView !== 'grid', libIsGrid: s.libView === 'grid',
      viewListCls: s.libView !== 'grid' ? 'on' : '', viewGridCls: s.libView === 'grid' ? 'on' : '',
      viewListPressed: s.libView !== 'grid' ? 'true' : 'false', viewGridPressed: s.libView === 'grid' ? 'true' : 'false',
      setViewList: () => this.setState({ libView: 'list', menuId: null }), setViewGrid: () => this.setState({ libView: 'grid', menuId: null }),
      name: s.name, initial: s.name.slice(0, 1), account: s.account, connectedAt: s.connectedAt,
      connected: s.connected, notConnected: !s.connected,
      totalCount: items.length, tasteCount: tasteItemsAll.length, sideTypes,
      navHome: 'nav-item' + (s.view === 'home' ? ' on' : ''), navLib: 'nav-item' + (s.view === 'library' || (s.view === 'detail' && s.from !== 'home' && s.from !== 'taste') ? ' on' : ''), navTaste: 'nav-item' + (s.view === 'taste' ? ' on' : ''), navSettings: 'nav-item' + (s.view === 'settings' ? ' on' : ''),
      goHome: () => this.go('home'), goLibrary: () => this.go('library'), goTaste: () => this.go('taste'), goSettings: () => this.go('settings'),
      goLibraryNew: () => this.go('library', { sort: 'new' }),
      goSearch: () => this.go('library'),
      goConnect: () => { this.go('settings'); },
      crumbRoot: s.view === 'detail' ? fromLabel : viewLabels[s.view], hasCrumbLeaf: s.view === 'detail' && !!raw, crumbLeaf: raw ? raw.title : '',
      // mode: the demo defaults below; the real-data mode (public/js/dashboard-app.js) overrides them
      isDemo: true, isLive: false, modeBadge: 'DEMO', email: s.email,
      modeNote: '로그인·Instagram 연결·DM·분석은 모두 시뮬레이션이에요. 데모 기준일 2026.10.31 (KST)',
      connectDesc: '어느 계정에서 보낸 콘텐츠인지 확인해 내 대시보드에 모아드려요. 연결 전에는 보낸 콘텐츠가 내 기록에 들어오지 않아요.',
      dmModeDesc: '앞으로 받을 응답에 적용돼요. 이미 받은 DM은 바뀌지 않고, 개인 결과 페이지는 어느 방식이든 만들어져요.',
      linkGuideOn: false, copyLinkWord: () => {}, checkLink: () => {},
      // demo
      demoOpen: s.demoOpen, demoExpanded: s.demoOpen ? 'true' : 'false', toggleDemo: () => this.setState({ demoOpen: !s.demoOpen, menuId: null }),
      scenarioLabel: scenLabels[scen],
      scenarios: [['disconnected', '연결 전', 'Instagram 미연결, 기록 없음'], ['empty', '첫 콘텐츠 전', '연결 완료, 아직 보낸 콘텐츠 없음'], ['full', '콘텐츠 쌓임', '샘플 콘텐츠 10개']].map(([k, label, desc]) => ({ label, desc, dotCls: scen === k ? 'live' : 'off', pick: () => this.setScenario(k) })),
      simulateDm: () => this.simulateDm(), simDisabled: !s.connected || s.simState !== 'idle',
      simHint: !s.connected ? 'Instagram 연결 후 사용할 수 있어요' : (s.simState === 'running' ? '정리 중…' : (s.simState === 'done' ? '시뮬레이션 완료' : '접수 → 처리 → DM 발송까지 재생')),
      toggleLibError: () => this.setState({ libError: !s.libError }), libErrDot: s.libError ? 'live' : 'off', libErrState: s.libError ? '켜짐' : '꺼짐',
      toggleDark: () => this.setState({ dark: !s.dark }), darkDot: s.dark ? 'live' : 'off', darkState: s.dark ? '켜짐' : '꺼짐',
      sendFromIg: () => this.toast('Instagram 앱에서 @dimi_in에 게시물을 공유해 주세요 (데모)'),
      // home
      isHome: s.view === 'home',
      homeSub: !s.connected ? 'Instagram을 연결하면 보낸 콘텐츠가 여기에 모여요.' : (items.length ? '보낸 콘텐츠와 다가오는 일정을 한곳에서 확인하세요.' : '첫 콘텐츠를 보내면 여기에서 결과를 확인할 수 있어요.'),
      homeDisconnected: !s.connected, homeEmpty: s.connected && items.length === 0, homeFull: s.connected && items.length > 0,
      showExamples: items.length === 0,
      hasActiveWork: active.length > 0, activeCount: active.length, activeItems: active,
      homeHasRecent: recent.length > 0, recentItems: recent,
      hasSchedule: schedule.length > 0, schedule, hasTaste: tasteItemsAll.length > 0,
      // library
      isLibrary: s.view === 'library',
      statusF: s.statusF, onStatus: e => this.setState({ statusF: e.target.value }),
      sort: s.sort, onSort: e => this.setState({ sort: e.target.value }),
      query: s.query, onQuery: e => this.setState({ query: e.target.value, menuId: null }), hasQuery: !!s.query, clearQuery: () => this.setState({ query: '' }),
      favChipCls: 'chip' + (s.favOnly ? ' on' : ''), favOnlyPressed: s.favOnly ? 'true' : 'false', toggleFavOnly: () => this.setState({ favOnly: !s.favOnly }),
      typeTabs, statusChips,
      libShowError: s.libError && !s.libLoading, libShowLoading: s.libLoading,
      skeletonRows: [1, 2, 3, 4, 5],
      reloadLib: () => { this.setState({ libLoading: true, libError: false }); clearTimeout(this._fl); this._fl = setTimeout(() => this.setState({ libLoading: false }), 1100); },
      libShowList: !libBlocked && lib.length > 0, libItems: lib, libCount: lib.length, isFiltered,
      resetFilters: () => this.setState({ typeF: 'all', statusF: 'all', favOnly: false, query: '' }),
      libShowEmpty: !libBlocked && lib.length === 0,
      emptyIsSearch: libSearchEmpty, emptyIsFilter: libFilterEmpty, emptyIsFirst: libFirst,
      emptyTitle: libFirst ? (s.connected ? '아직 보낸 콘텐츠가 없어요.' : 'Instagram을 연결하고 첫 콘텐츠를 보내보세요.') : (libSearchEmpty ? '검색 결과가 없어요.' : '선택한 조건에 맞는 콘텐츠가 없어요.'),
      emptyDesc: libFirst ? '@dimi_in에 게시물이나 릴스를 DM으로 공유하면 여기에 모여요.' : (libSearchEmpty ? '‘' + s.query + '’와 일치하는 콘텐츠를 찾지 못했어요. 검색어를 바꾸거나 지워 보세요.' : '필터를 바꾸거나 초기화해 보세요.'),
      emptyCta: s.connected ? () => this.toast('Instagram 앱에서 @dimi_in에 게시물을 공유해 주세요 (데모)') : () => this.go('settings'),
      emptyCtaLabel: s.connected ? 'Instagram에서 보내기' : 'Instagram 연결하기',
      // detail
      isDetail: s.view === 'detail' && !!raw, d,
      backLabel: fromLabel, goBack: () => this.go(s.from === 'detail' ? 'library' : s.from),
      detailMenu: s.detailMenu, detailMenuExpanded: s.detailMenu ? 'true' : 'false', toggleDetailMenu: () => this.setState({ detailMenu: !s.detailMenu }),
      copyPrivateLink: () => { this.setState({ detailMenu: false }); this.copy('https://디미.app/items/' + (raw ? raw.id : ''), '개인 결과 주소를 복사했어요. 로그인한 본인만 열 수 있어요.'); },
      copyIngredients: () => { if (!raw || !raw.ingredients) return; this.copy(raw.title + ' 재료\n' + raw.ingredients.map(g => '- ' + g.name + ' ' + g.qty).join('\n'), '재료 목록을 복사했어요'); },
      visitOpen: s.visitOpen, visitExpanded: s.visitOpen ? 'true' : 'false', toggleVisit: () => this.setState({ visitOpen: !s.visitOpen }),
      addDeadline: () => this.toast('마감 일정(11.14 18:00 KST)을 캘린더에 추가하도록 열었어요 (데모)'),
      retypeOpts: [['recipe', '레시피', '재료·분량, 조리 순서'], ['news', '뉴스·정보 확인', '주장 단위 사실 확인'], ['exhibit', '전시·팝업', '장소·일정·예약 정보'], ['contest', '공모전·대외활동', '지원 조건·마감·제출물'], ['restaurant', '맛집', '위치·메뉴·가격'], ['space', '취향공간', '위치·운영 시간·이용 정보']].map(([k, label, desc]) => ({ label, desc, dot: 'dot t-' + k, checked: s.retype === k ? 'true' : 'false', cls: 'radio-card' + (s.retype === k ? ' on' : ''), pick: () => this.setState({ retype: k }) })),
      retypeDisabled: !s.retype,
      requestProcess: () => { if (!raw || !s.retype) return; const lbl = { recipe: '레시피', news: '뉴스·정보 확인', exhibit: '전시·팝업', contest: '공모전·대외활동', restaurant: '맛집', space: '취향공간' }[s.retype]; this.setState({ over: Object.assign({}, s.over, { [raw.id]: { status: 'processing', dm: 'waiting', key: lbl + '(으)로 정리하고 있어요', procType: lbl } }) }); this.toast(lbl + '(으)로 정리를 요청했어요'); },
      fbUpCls: 'btn btn-sm' + (raw && s.feedback[raw.id] === 'up' ? ' btn-primary' : ''), fbDownCls: 'btn btn-sm' + (raw && s.feedback[raw.id] === 'down' ? ' btn-primary' : ''),
      fbUpPressed: raw && s.feedback[raw.id] === 'up' ? 'true' : 'false', fbDownPressed: raw && s.feedback[raw.id] === 'down' ? 'true' : 'false',
      fbUp: () => { this.setState({ feedback: Object.assign({}, s.feedback, { [raw.id]: 'up' }) }); this.toast('의견을 보냈어요. 고마워요!'); },
      fbDown: () => { this.setState({ feedback: Object.assign({}, s.feedback, { [raw.id]: 'down' }), reportOpen: true }); this.toast('의견을 보냈어요. 오류가 있다면 알려 주세요.'); },
      reportOpen: s.reportOpen, reportExpanded: s.reportOpen ? 'true' : 'false', toggleReport: () => this.setState({ reportOpen: !s.reportOpen, reportReason: null }),
      reportReasons: ['정보가 원본과 달라요', '링크가 열리지 않아요', '유형이 잘못됐어요', '기타'].map(r => ({ label: r, cls: 'chip' + (s.reportReason === r ? ' on' : ''), pressed: s.reportReason === r ? 'true' : 'false', pick: () => this.setState({ reportReason: r }) })),
      reportDisabled: !s.reportReason, sendReport: () => { this.setState({ reportOpen: false, reportReason: null }); this.toast('오류 신고를 보냈어요'); },
      // share
      openShare: () => { if (!raw || raw.status !== 'done') return; this.setState({ modal: 'share', detailMenu: false, shareStage: s.shares[raw.id] === 'active' ? 'created' : 'preview' }); },
      modalShare: s.modal === 'share' && !!raw,
      shareIsPrivate: !shareActive, shareIsPublic: !!shareActive,
      shareShowPreview: s.shareStage === 'preview' || s.shareStage === 'creating' || s.shareStage === 'created',
      shareCreated: s.shareStage === 'created', shareEnded: s.shareStage === 'ended',
      shareCanCreate: s.shareStage === 'preview' || s.shareStage === 'creating' || s.shareStage === 'ended',
      shareCreating: s.shareStage === 'creating', shareCreateLabel: s.shareStage === 'creating' ? '링크 만드는 중…' : (s.shareStage === 'ended' ? '새 공유 링크 만들기' : '공유 링크 만들기'),
      shareCloseLabel: s.shareStage === 'created' ? '완료' : '취소',
      shareUrl: '디미.app/s/' + (raw ? { r1: 'k3Xq9fLm', n1: 'Pw7cT2aZ', e1: 'Lr8mQe4V', c1: 'Hd2sN9xK', r2: 'Bv5yJ1oR', n2: 'Zt6uW3pC', e2: 'Qa1kF7gE', c2: 'Ym4hS8dT', r3: 'Gc9nX2bL' }[raw.id] || 'aB3dE5fG' : ''),
      createShare: () => { this.setState({ shareStage: 'creating' }); clearTimeout(this._fl); this._fl = setTimeout(() => { this.setState(st => ({ shareStage: 'created', shares: Object.assign({}, st.shares, { [raw.id]: 'active' }) })); this.toast('공유 링크를 만들었어요'); }, 700); },
      copyShare: () => this.copy('https://디미.app/s/' + ({ r1: 'k3Xq9fLm' }[raw && raw.id] || 'aB3dE5fG'), '공유 링크를 복사했어요'),
      endShare: () => { this.setState({ shareStage: 'ended', shares: Object.assign({}, s.shares, { [raw.id]: 'ended' }) }); this.toast('공유를 종료했어요. 이제 이 링크로 볼 수 없어요.'); },
      closeModal: () => this.setState({ modal: null }),
      // delete
      deleteDesc: '이 콘텐츠의 정리 결과와 연결된 공유 링크를 삭제해요. 취향으로 모은 경우 취향에서도 빠져요. 삭제 후에는 되돌릴 수 없어요.',
      libraryDeleteDesc: '정리 결과·취향 연결·공유 링크가 함께 삭제돼요. 콘텐츠의 더보기 메뉴에서 하나씩 삭제해요.',
      modalDelete: s.modal === 'delete' && !!delItem, delTitle: delItem ? delItem.title : '',
      confirmDelete: () => { const id = s.delTarget; const tasteNext = Object.assign({}, s.taste, { [id]: false }); const sharesNext = Object.assign({}, s.shares); delete sharesNext[id]; const back = s.view === 'detail' && s.detailId === id; this.setState({ deleted: Object.assign({}, s.deleted, { [id]: true }), taste: tasteNext, shares: sharesNext, modal: null, delTarget: null, view: back ? (s.from === 'home' ? 'home' : 'library') : s.view }); this.toast('콘텐츠를 삭제했어요'); },
      // taste
      isTaste: s.view === 'taste', tasteTabs, tasteItems, tasteTabCount: tasteItems.length,
      tasteHasItems: tasteItems.length > 0, tasteEmpty: tasteItems.length === 0,
      tasteIntro: '마음에 든 레시피와 전시를 모아보세요.', tasteEditable: true, tasteEvidence: tasteItems,
      tasteShowCard: tasteCardEligible && !s.tasteRemoved, tasteCardGone: tasteCardEligible && s.tasteRemoved, tasteShowSingle: tasteItems.length === 1,
      tasteCardLabel: s.tasteLabel, tasteCardDesc: s.tasteState === 'edited' ? '직접 수정한 표현이에요.' : '짧은 조리 시간과 팬 하나로 만드는 레시피를 모았어요.',
      tasteBadge: tb[0], tasteBadgeCls: tb[1], tasteConfirmDisabled: s.tasteState === 'confirmed',
      confirmTaste: () => { this.setState({ tasteState: 'confirmed' }); this.toast('취향을 확인했어요'); },
      openTasteEdit: () => this.setState({ modal: 'taste', tasteDraft: s.tasteLabel }),
      removeTasteCard: () => { this.setState({ tasteRemoved: true }); this.toast('취향 표현을 삭제했어요'); },
      modalTaste: s.modal === 'taste', tasteDraft: s.tasteDraft, onTasteDraft: e => this.setState({ tasteDraft: e.target.value }),
      aiTasteLabel: '15분 안팎의 간단한 팬·면 요리', useAiTaste: () => this.setState({ tasteDraft: '15분 안팎의 간단한 팬·면 요리' }),
      tasteSaveDisabled: !s.tasteDraft.trim(),
      saveTaste: () => { const v = s.tasteDraft.trim(); const isAi = v === '15분 안팎의 간단한 팬·면 요리'; this.setState({ tasteLabel: v, tasteState: isAi ? 'ai' : 'edited', modal: null }); this.toast('취향 표현을 저장했어요'); },
      conds: s.conds.map(c => Object.assign({}, c, { aria: c.cat + ' ' + c.val + ' 삭제', remove: () => this.setState({ conds: this.state.conds.filter(x => x.id !== c.id) }) })), noConds: s.conds.length === 0,
      condCat: s.condCat, onCondCat: e => this.setState({ condCat: e.target.value }), condVal: s.condVal, onCondVal: e => this.setState({ condVal: e.target.value }),
      addCondDisabled: !s.condVal.trim(), addCond: () => { const v = s.condVal.trim(); if (!v) return; this.setState({ conds: s.conds.concat([{ id: s.condSeq, cat: s.condCat, val: v }]), condSeq: s.condSeq + 1, condVal: '' }); this.toast('생활 조건을 추가했어요'); },
      // settings
      isSettings: s.view === 'settings',
      nameDraft: s.nameDraft, onNameDraft: e => this.setState({ nameDraft: e.target.value }), nameSaveDisabled: !s.nameDraft.trim() || s.nameDraft.trim() === s.name,
      saveName: () => { this.setState({ name: s.nameDraft.trim() }); this.toast('프로필 이름을 저장했어요'); },
      logout: () => this.toast('로그아웃했어요 (데모). Instagram 연결과 진행 중인 정리는 유지돼요.'),
      showConnected: s.connected && f === 'idle', changing: s.connected && f !== 'idle',
      flowStart: !s.connected && f === 'idle', flowIssuing: f === 'issuing', flowCode: f === 'code', flowVerifying: f === 'verifying', flowVerified: f === 'verified', flowExpired: f === 'expired', flowConflict: f === 'conflict',
      code: s.code, codeTime: mm + ':' + ss, pendingAccount: s.pendingAccount,
      startCode: () => this.startCode(),
      cancelFlow: () => { clearInterval(this._ti); clearTimeout(this._fl); this.setState({ flow: 'idle' }); },
      copyCode: () => this.copy('연결 ' + s.code, '연결 문구를 복사했어요'),
      openIgDm: () => this.toast('Instagram 앱의 @dimi_in 대화로 이동해요 (데모)'),
      simReceive: () => { clearInterval(this._ti); this.setState({ flow: 'verifying' }); clearTimeout(this._fl); this._fl = setTimeout(() => this.setState({ flow: 'verified', pendingAccount: this.state.connected ? '@jimin.archive' : '@jimin.daily' }), 1500); },
      simExpire: () => { clearInterval(this._ti); this.setState({ flow: 'expired', codeLeft: 0 }); },
      simConflict: () => { clearInterval(this._ti); this.setState({ flow: 'conflict' }); },
      confirmConnect: () => { const wasConnected = s.connected; this.setState({ connected: true, account: s.pendingAccount, flow: 'idle', connectedAt: '2026.10.31 15:10' }); this.toast(wasConnected ? '연결 계정을 ' + s.pendingAccount + '(으)로 바꿨어요' : 'Instagram을 연결했어요', wasConnected ? null : '첫 콘텐츠 보내기', wasConnected ? null : () => { this.setState({ toast: null }); this.go('home'); }); },
      askDisconnect: () => this.setState({ modal: 'conn', connModal: 'disconnect' }),
      askChange: () => this.setState({ modal: 'conn', connModal: 'change' }),
      modalConn: s.modal === 'conn',
      connModalTitle: s.connModal === 'disconnect' ? 'Instagram 연결을 해제할까요?' : '다른 Instagram 계정으로 변경할까요?',
      connModalDesc: s.connModal === 'disconnect' ? '해제하면 ' + s.account + '에서 보낸 새 콘텐츠가 더 이상 내 기록에 들어오지 않아요.' : '새 계정을 확인하는 동안 ' + s.account + ' 연결은 유지돼요. 확인이 끝나면 새 계정으로 바뀌어요.',
      connModalCta: s.connModal === 'disconnect' ? '연결 해제' : '새 연결 코드 만들기',
      connModalBtnCls: s.connModal === 'disconnect' ? 'btn btn-danger-solid' : 'btn btn-primary',
      confirmConnModal: () => { if (s.connModal === 'disconnect') { this.setState({ connected: false, flow: 'idle', modal: null }); this.toast('연결을 해제했어요. 기존 기록은 그대로 있어요.'); } else { this.startCode(); } },
      dmModes: [['summary', '핵심 요약과 링크', 'DM에서 핵심만 보고, 자세한 내용은 페이지에서 확인해요.', false], ['full', 'DM에서 전체 보기', '정리한 내용을 DM에서 읽어요. 긴 내용은 나눠서 보낼 수 있어요.', true]].map(([k, label, desc, def]) => ({ label, desc, isDefault: def, checked: s.dmMode === k ? 'true' : 'false', cls: 'radio-card' + (s.dmMode === k ? ' on' : ''), pick: () => { if (s.dmMode !== k) { this.setState({ dmMode: k }); this.toast('앞으로 받을 DM에 적용했어요'); } } })),
      dmTypes: [['recipe', '레시피'], ['news', '뉴스'], ['exhibit', '전시'], ['contest', '공모전']].map(([k, label]) => ({ label, dot: 'dot t-' + k, cls: s.dmType === k ? 'on' : '', pressed: s.dmType === k ? 'true' : 'false', pick: () => this.setState({ dmType: k }) })),
      dmBubbles: dmSample[s.dmMode].map((text, i) => ({ text, k: s.dmType + s.dmMode + i })), dmOrbCls: 'orb ' + dmSample.orb, dmSampleTitle: dmSample.title,
      activeShares, noShares: activeShares.length === 0,
      askWithdraw: () => this.setState({ modal: 'withdraw' }), modalWithdraw: s.modal === 'withdraw',
      // toast
      hasToast: !!s.toast, toastMsg: s.toast ? s.toast.msg : '', toastHasAction: !!(s.toast && s.toast.action), toastActionLabel: s.toast ? s.toast.actionLabel : '', toastAction: s.toast && s.toast.action ? s.toast.action : () => {},
      closeToast: () => { clearTimeout(this._tt); this.setState({ toast: null }); }
    }, cookV);
  }
}
