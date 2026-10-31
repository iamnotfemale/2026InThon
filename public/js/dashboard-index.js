import { matchesContent } from './content-index.js';

export function applyIndexValues(v, s, app) {
  if (s.mode !== 'live') return v;
  const group = (s.indexInterests || []).find(g => g.category === (s.tasteTab || 'recipe'));
  const evidence = group ? app.allItems().filter(item => group.evidence.some(e => e.id === (item.rowId || item.id)))
    .map(item => ({ ...item, dot: 'dot t-' + item.type, open: () => app.openDetail(item.id) })) : [];
  const visibleIds = new Set(app.allItems().map(item => item.rowId || item.id));
  const interestIds = category => new Set((s.indexInterests || []).filter(g => !category || g.category === category)
    .flatMap(g => g.evidence.map(e => e.id)).filter(id => visibleIds.has(id)));
  Object.assign(v, {
    onQuery: e => app.setState({ query: e.target.value, semanticSearch: null, searchNote: '', menuId: null }),
    searchKey: e => { if (e.key === 'Enter' && !e.isComposing) { e.preventDefault(); app.searchContents(); } },
    searchContents: () => app.searchContents(),
    searchStatus: s.searchBusy ? '디미가 의미를 살펴보고 있어요…' : s.searchNote || '검색어를 입력하고 의미로 찾기를 눌러 주세요.',
    tasteShowCard: !!group && evidence.length >= 2 && !s.tasteRemoved, tasteCardLabel: group ? `${group.label}에 관심을 보이고 있어요` : '',
    tasteCardDesc: group ? `서로 다른 콘텐츠 ${group.count || group.evidence.length}개에서 반복됐어요. 공유 기록을 바탕으로 한 추정이에요.` : '',
    tasteBadge: '관심 추정', tasteBadgeCls: 'badge s-neutral', tasteEvidence: evidence, tasteEditable: false,
    tasteIntro: '보낸 콘텐츠에서 반복되는 관심을 살펴보세요.',
    tasteCount: interestIds().size,
    tasteTabs: (v.tasteTabs || []).map((tab, i) => ({ ...tab, count: interestIds(i === 0 ? 'recipe' : 'exhibit').size })),
    tasteRecommendations: (s.interestIds || []).map(id => app.allItems().find(item => (item.rowId || item.id) === id))
      .filter(item => item && item.type === (s.tasteTab || 'recipe')).slice(0, 3)
      .map(item => ({ title: item.title, open: () => app.openDetail(item.id) })),
  });
  return v;
}

export const matchesIndexedItem = (item, query, state) => matchesContent(item, query, state.semanticSearch);
