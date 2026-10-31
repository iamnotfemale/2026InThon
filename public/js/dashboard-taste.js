// Both screen sizes use the same saved picks and selected planet.
export function applyTasteOrbitValues(v, s, app) {
  const items = app.allItems().filter(item => s.taste[item.id] && item.status === 'done' && ['recipe', 'exhibit'].includes(item.type));
  const tab = s.tasteTab || 'all';
  const select = id => () => app.setState({ tasteSel: s.tasteSel === id ? null : id });
  const groups = [['recipe', '레시피 궤도'], ['exhibit', '전시·공간 궤도']].map(([type, label]) => {
    const list = items.filter(item => item.type === type);
    return { label, dot: 'dot t-' + type, count: list.length, empty: !list.length,
      cls: 'tl-group' + (tab !== 'all' && tab !== type ? ' dim' : ''),
      items: list.map(item => ({ ...item, orbCls: 'orb o-' + type, dot: 'dot t-' + type,
        typeLabel: type === 'recipe' ? '레시피' : '전시·공간', select: select(item.id), isSel: s.tasteSel === item.id,
        rowCls: 'tl-row' + (s.tasteSel === item.id ? ' sel' : ''), selPressed: String(s.tasteSel === item.id),
        summary: (typeof item.summary === 'string' && item.summary) || item.intro || '',
        hasSummary: !!((typeof item.summary === 'string' && item.summary) || item.intro),
        open: () => app.openDetail(item.id),
        remove: () => { app.setState({ taste: { ...s.taste, [item.id]: false }, tasteSel: null }); app.toast('취향에서 뺐어요. 정리 결과는 그대로 있어요.'); } })) };
  });
  const orbit = (group, ring, offset) => group.items.slice(0, 8).map((item, i, list) => ({ ...item,
    aria: item.title + ' 선택', btnCls: 'pl-btn' + (item.isSel ? ' sel' : ''),
    cls: 'pl a' + ((Math.round((offset + i * 360 / list.length) / 15) * 15) % 360) + ' r' + ring }));
  return Object.assign(v, {
    tasteCount: items.length, tasteHasAny: !!items.length, tasteNone: !items.length, tasteGroups: groups,
    tasteTabs: [['all', '전체', ''], ['recipe', '레시피', 'dot t-recipe'], ['exhibit', '전시·공간', 'dot t-exhibit']]
      .map(([key, label, dot]) => ({ label, dot, count: key === 'all' ? items.length : items.filter(item => item.type === key).length,
        cls: tab === key ? 'on' : '', pressed: String(tab === key), pick: () => app.setState({ tasteTab: key, tasteSel: null }) })),
    orbitA: orbit(groups[0], 'A', 30), orbitB: orbit(groups[1], 'B', 75),
    orbitACls: 'orbit orbit-a' + (tab === 'exhibit' ? ' dim' : ''), orbitBCls: 'orbit orbit-b' + (tab === 'recipe' ? ' dim' : ''),
    labelACls: 'os-ring-label ra' + (tab === 'exhibit' ? ' dim' : ''), labelBCls: 'os-ring-label rb' + (tab === 'recipe' ? ' dim' : ''),
  });
}
