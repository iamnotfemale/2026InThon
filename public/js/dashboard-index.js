import { matchesContent } from './content-index.js';

export function applyIndexValues(v, s, app) {
  if (s.mode !== 'live') return v;
  const patterns = (s.indexInterests || []).filter(g => g.category === (s.tasteTab || 'recipe'));
  const group = patterns.find(g => g.label === s.interestLabel) || patterns[0];
  const evidence = group ? app.allItems().filter(item => item.type === group.category && group.evidence.some(e => e.id === item.id))
    .map(item => ({ ...item, dot: 'dot t-' + item.type, open: () => app.openDetail(item.id) })) : [];
  const category = s.tasteTab || 'recipe'; const categoryName = category === 'recipe' ? '레시피' : '전시·팝업';
  const count = app.allItems().filter(item => item.type === category).length;
  Object.assign(v, {
    onQuery: e => app.setState({ query: e.target.value, semanticSearch: null, searchNote: '', menuId: null }),
    searchKey: e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); app.searchContents(); } },
    searchContents: () => app.searchContents(),
    searchStatus: s.searchBusy ? '디미가 검색하고 있어요…' : s.searchNote || '',
    tasteShowCard: !!group && evidence.length >= 2 && !s.tasteRemoved, tasteCardLabel: group ? `${group.label}에 관심을 보이고 있어요` : '',
    tasteCardDesc: group ? `서로 다른 콘텐츠 ${group.count || group.evidence.length}개에서 반복됐어요. 공유 기록을 바탕으로 한 추정이에요.` : '',
    tasteBadge: '관심 추정', tasteBadgeCls: 'badge s-neutral', tasteEvidence: evidence, tasteEditable: false,
    tasteIntro: '공유해주신 콘텐츠에서 관심을 찾고, 다시 볼 만한 콘텐츠를 꺼내드려요. 탭 숫자는 직접 모은 콘텐츠 수예요.',
    tasteShowSingle: false, tasteSingle: false,
    interestPatterns: patterns.map(pattern => ({ label: pattern.label + ' · ' + pattern.count,
      cls: 'chip' + (pattern === group ? ' on' : ''), pressed: pattern === group ? 'true' : 'false',
      pick: () => app.setState({ interestLabel: pattern.label, tasteRemoved: false }) })),
    showInterestNotice: !group || evidence.length < 2 || !!s.tasteRemoved,
    interestNoticeTitle: s.interestState === 'loading' ? '디미가 관심 패턴을 살펴보고 있어요.' : s.interestState === 'error' ? '관심 패턴을 불러오지 못했어요.'
      : s.tasteRemoved ? '관심 카드를 숨겼어요.' : '아직 반복되는 관심이 뚜렷하지 않아요.',
    interestNoticeDesc: s.interestState === 'error' ? '직접 모아둔 콘텐츠는 아래에서 계속 볼 수 있어요.'
      : `${categoryName} ${count}개를 기준으로 살펴봐요. 서로 다른 게시물에서 같은 특징이 반복되면 근거와 다시 볼 콘텐츠를 보여드려요. 아래 목록은 직접 모아둔 콘텐츠예요.`,
    refreshInterests: () => { app.setState({ tasteRemoved: false }); app.loadInterests(); },
    tasteRecommendations: (s.interestIds || []).map(id => app.allItems().find(item => item.id === id))
      .filter(item => item && item.type === category && group && (group.evidence.some(e => e.id === item.id)
        || item.contentIndex?.tags.some(tag => tag.label === group.label))).slice(0, 3)
      .map(item => ({ title: item.title, open: () => app.openDetail(item.id) })),
  });
  return v;
}

export const matchesIndexedItem = (item, query, state) => matchesContent(item, query, state.semanticSearch);
