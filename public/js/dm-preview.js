const EXAMPLES = {
  recipe: { label:'레시피', title:'15분 매콤 두부면',
    summary:'매콤 두부면 레시피를 정리했어요! 재료와 조리 순서는 아래 결과에서 확인해 주세요.',
    full:['매콤 두부면 · 1인분\n준비 5분 · 조리 10분', '재료: 두부면 1팩, 대파 1/2대, 고춧가루 1큰술, 간장 1큰술',
      '1. 대파를 썰고 두부면의 물기를 빼주세요.\n2. 팬에 대파를 볶고 양념을 넣어주세요.\n3. 두부면을 넣고 가볍게 버무려주세요.'] },
  news: { label:'뉴스·정보', title:'청년 지원 사업을 소개한 카드뉴스',
    summary:'주장과 근거를 확인했어요. 판단 이유와 출처 링크는 아래 결과에서 살펴보세요.',
    full:['팩트체크 응답 예시\n판단: 조건 확인 필요', '공식 공고의 신청 대상과 기간을 함께 확인해 주세요. 정리 결과에는 확인한 근거 링크와 한계가 포함돼요.'] },
  exhibit: { label:'전시·팝업', title:'빛의 방 — 예시 전시',
    summary:'전시 장소와 기간을 모아뒀어요. 운영 시간과 방문 정보는 아래 결과에서 확인해 주세요.',
    full:['빛의 방 — 예시 전시\n기간: 11월 1일 – 12월 20일\n장소: 가상 미술관 2층', '운영: 화–일 10:00 – 19:00\n휴무: 월요일\n예약과 요금은 공식 안내에서 다시 확인해 주세요.'] },
  contest: { label:'공모전·대외활동', title:'대학생 아이디어 공모전 — 예시',
    summary:'지원 조건과 마감일을 정리했어요. 준비할 내용과 공고 링크는 아래 결과에 모아뒀어요.',
    full:['대학생 아이디어 공모전 — 예시\n대상: 대학 재학·휴학생\n마감: 11월 14일 18:00 KST', '제출물: 기획서, 소개 영상\n접수 방법과 세부 조건은 결과에 첨부된 공식 공고를 확인해 주세요.'] },
  restaurant: { label:'맛집', title:'들기름 국수집 — 예시',
    summary:'가게 위치와 대표 메뉴를 정리했어요. 방문 정보는 아래 결과에서 확인해 주세요.',
    full:['들기름 국수집 — 예시\n위치: 성수동\n대표 메뉴: 들기름 국수 12,000원', '운영: 11:00 – 20:00\n예약·웨이팅 정보는 원본과 가게의 최신 안내를 확인해 주세요.'] },
};

// This is a labelled illustration of delivery settings; it never sends a DM.
export function applyDmPreview(v, state, app) {
  const type = EXAMPLES[state.dmType] ? state.dmType : 'recipe';
  const example = EXAMPLES[type];
  return Object.assign(v, {
    dmTypes: Object.entries(EXAMPLES).map(([key, value]) => ({ label:value.label, dot:'dot t-' + key,
      cls:type === key ? 'on' : '', pressed:String(type === key), pick:()=>app.setState({dmType:key}) })),
    dmOrbCls:'orb o-' + type, dmSampleTitle:example.title, dmPreviewLink:state.dmMode !== 'full',
    dmBubbles:['디미가 금방 정리해드릴게요!', ...(state.dmMode === 'full' ? example.full : [example.summary])]
      .map((text, i)=>({text,k:type + ':' + state.dmMode + ':' + i})),
  });
}
