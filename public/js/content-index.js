// The same factual index is used by browser search, server retrieval and interest aggregation.
const text = (value, max = 1000) => typeof value === 'string' ? value.normalize('NFKC').trim().slice(0, max) : '';
const list = value => Array.isArray(value) ? value : [];
export const normalizeSearch = value => text(value, 8000).toLocaleLowerCase('ko');

export function normalizeContentIndex(raw, { category = 'news', title = '', description = '', entities = [], attributes = [], scope = [], notes = [] } = {}) {
  const tags = list(raw?.tags).slice(0, 16).filter(tag => text(tag?.label, 60) && text(tag?.evidence, 300))
    .map(tag => ({ label: text(tag.label, 60), evidence: text(tag.evidence, 300) }));
  const index = { version: 1, category, title: text(title, 300),
    description: text(raw?.description) || text(description), tags,
    entities: [...new Set([...list(raw?.entities), ...entities].map(value => text(value, 100)).filter(Boolean))].slice(0, 40),
    attributes: [...list(raw?.attributes), ...attributes].slice(0, 32)
      .filter(a => text(a?.name, 60) && text(a?.value, 200) && text(a?.evidence, 300))
      .map(a => ({ name: text(a.name, 60), value: text(a.value, 200), evidence: text(a.evidence, 300) })),
    coverage: { scope: list(scope).map(x => text(x, 200)).slice(0, 20), notes: list(notes).map(x => text(x, 300)).slice(0, 20) },
    origin: text(raw?.description) ? 'gemini' : 'stored_result' };
  index.searchText = normalizeSearch([index.title, index.description, ...tags.map(t => t.label), ...index.entities,
    ...index.attributes.map(a => `${a.name}: ${a.value}`)].join('\n'));
  return index;
}

export function storedContent(row) {
  try { const value = JSON.parse(row.reason); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; }
  catch { return {}; }
}

export function indexFromRow(row) {
  const stored = storedContent(row); const recipe = stored.recipe; const contest = stored.contest; const exhibit = stored.exhibit;
  const category = ['recipe', 'exhibit', 'contest'].includes(row.topic) ? row.topic : 'news';
  const raw = stored.contentIndex;
  const legacyTags = recipe ? list(recipe.ingredients).filter(i => i?.evidence && !/^(물|소금|설탕|후추|기름|식용유|간장|다진마늘)$/.test(i.name))
    .map(i => ({ label: i.name, evidence: i.evidence })) : [];
  const index = normalizeContentIndex(raw?.tags?.length ? raw : { ...raw, tags: legacyTags }, { category, title: row.claim,
    description: recipe?.summary || contest?.summary || list(exhibit?.events).map(e => e.intro || e.title).join(' · ') || stored.reason || row.reason,
    entities: recipe ? list(recipe.ingredients).map(i => i?.name) : contest ? [contest.host].filter(Boolean)
      : list(exhibit?.events).flatMap(e => [e?.name, e?.place, e?.area].filter(Boolean)),
    scope: raw?.coverage?.scope, notes: raw?.coverage?.notes });
  if (raw?.origin === 'stored_result') index.origin = 'stored_result';
  if (raw?.embedding?.model === 'text-embedding-3-small' && list(raw.embedding.vector).length === 256
    && raw.embedding.vector.every(Number.isFinite)) index.embedding = raw.embedding;
  return index;
}

export function eventContentIndex(event) {
  const evidence = field => event.evidence?.[field] || event.media || '해당 전시의 정리 정보';
  return normalizeContentIndex({ tags: ['kind', 'area', 'place', 'hostOrArtist'].filter(key => event[key])
    .map(key => ({ label: event[key], evidence: evidence(key === 'hostOrArtist' ? 'host_or_artist' : key) })) },
  { category: 'exhibit', title: event.title, description: event.intro || event.title,
    entities: [event.name, event.kind, event.hostOrArtist, event.place, event.address, event.area].filter(Boolean),
    attributes: [['장소','place'],['지역','area'],['주소','address'],['시작일','start'],['종료일','end'],['입장료','fee']]
      .filter(([, key]) => event[key]).map(([name, key]) => ({ name, value: event[key], evidence: evidence(key) })),
    scope: [event.media].filter(Boolean), notes: [...list(event.checks), ...list(event.conflicts)] });
}

// Search IDs match the actual detail cards; one post can contain several unrelated exhibitions.
export function indexedItems(row) {
  const stored = storedContent(row);
  if (row.topic !== 'exhibit' || !Array.isArray(stored.exhibit?.events)) return [{ id: 'fc' + row.id, index: indexFromRow(row) }];
  return stored.exhibit.events.map((event, i) => {
    const index = eventContentIndex(event); const embedding = stored.contentIndexes?.[i]?.embedding;
    if (embedding?.model === 'text-embedding-3-small' && list(embedding.vector).length === 256 && embedding.vector.every(Number.isFinite)) index.embedding = embedding;
    return { id: 'fc' + row.id + (i ? '-' + (i + 1) : ''), index };
  });
}

export function lexicalScore(index, query) {
  const terms = [...new Set(normalizeSearch(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
  if (!terms.length) return 0;
  return terms.filter(term => index.searchText.includes(term)).length / terms.length;
}

export function matchesContent(item, query, semantic) {
  if (!query.trim()) return true;
  if (semantic?.query === query.trim()) return semantic.ids.includes(item.id);
  return lexicalScore(item.contentIndex || { searchText: normalizeSearch([item.title, item.key, item.summary, item.claim, item.intro, item.place].join(' ')) }, query) > 0;
}

export function inferInterests(rows) {
  const groups = new Map(); const seen = new Set();
  for (const row of rows) {
    if (row.status !== 'done' || !['recipe', 'exhibit'].includes(row.topic)) continue;
    const index = indexFromRow(row); const identity = storedContent(row).sourceUrl || index.searchText;
    if (seen.has(identity)) continue;
    seen.add(identity);
    for (const item of indexedItems(row)) {
      for (const tag of new Map(item.index.tags.map(tag => [normalizeSearch(tag.label).replace(/\s+/g, ''), tag])).values()) {
        const key = item.index.category + ':' + normalizeSearch(tag.label).replace(/\s+/g, '');
        const group = groups.get(key) || { category: item.index.category, label: tag.label, evidence: [], signal: 'shared_interest' };
        if (!group.evidence.some(e => e.postId === 'fc' + row.id)) group.evidence.push({ id: item.id, postId: 'fc' + row.id, title: item.index.title, reason: tag.evidence });
        groups.set(key, group);
      }
    }
  }
  return [...groups.values()].filter(group => group.evidence.length >= 2)
    .sort((a, b) => b.evidence.length - a.evidence.length || a.label.localeCompare(b.label)).slice(0, 12)
    .map(group => ({ ...group, count: group.evidence.length, evidence: group.evidence.slice(0, 6) }));
}
