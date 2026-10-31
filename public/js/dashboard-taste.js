// Both screen sizes use the same saved picks and selected planet.
const CATEGORIES = [['recipe','레시피','A',30], ['exhibit','전시·공간','B',105],
  ['contest','공모전·대외활동','C',195], ['restaurant','맛집','D',285]];
const categoryOf = item => item.type === 'space' ? 'exhibit' : item.type;
export function applyTasteOrbitValues(v, s, app) {
  const items = app.allItems().filter(item => s.taste[item.id] && item.status === 'done' && CATEGORIES.some(([type]) => type === categoryOf(item)));
  const tab = s.tasteTab === 'space' ? 'exhibit' : (s.tasteTab || 'all');
  const select = id => () => app.setState({ tasteSel: s.tasteSel === id ? null : id });
  const groups = CATEGORIES.map(([type, label]) => {
    const list = items.filter(item => categoryOf(item) === type);
    return { label:label + ' 궤도', dot: 'dot t-' + type, count: list.length, empty: !list.length,
      cls: 'tl-group' + (tab !== 'all' && tab !== type ? ' dim' : ''),
      items: list.map(item => ({ ...item, orbCls: 'orb o-' + item.type, dot: 'dot t-' + item.type,
        typeLabel: item.type === 'space' ? '취향공간' : label, select: select(item.id), isSel: s.tasteSel === item.id,
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
    tasteTabs: [['all', '전체', ''], ...CATEGORIES.map(([type,label])=>[type,label,'dot t-'+type])]
      .map(([key, label, dot]) => ({ label, dot, count: key === 'all' ? items.length : items.filter(item => categoryOf(item) === key).length,
        cls: tab === key ? 'on' : '', pressed: String(tab === key), pick: () => app.setState({ tasteTab: key, tasteSel: null }) })),
    tasteOrbits: CATEGORIES.map(([type,label,ring,offset],i)=>({ label, dot:'dot t-'+type,
      lineCls:'os-line l-'+ring.toLowerCase(), labelCls:'os-ring-label r'+ring.toLowerCase()+(tab!=='all'&&tab!==type?' dim':''),
      cls:'orbit orbit-'+ring.toLowerCase()+(tab!=='all'&&tab!==type?' dim':''), planets:orbit(groups[i],ring,offset) })),
  });
}
