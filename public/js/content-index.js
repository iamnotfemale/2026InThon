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
  const index = normalizeContentIndex(raw, { category, title: row.claim,
    description: recipe?.summary || contest?.summary || list(exhibit?.events).map(e => e.intro || e.title).join(' · ') || stored.reason || row.reason,
    entities: recipe ? list(recipe.ingredients).map(i => i?.name) : contest ? [contest.host].filter(Boolean)
      : list(exhibit?.events).flatMap(e => [e?.name, e?.place, e?.area].filter(Boolean)),
    scope: raw?.coverage?.scope, notes: raw?.coverage?.notes });
  if (raw?.origin === 'stored_result') index.origin = 'stored_result';
  if (raw?.embedding?.model === 'text-embedding-3-small' && list(raw.embedding.vector).length === 256
    && raw.embedding.vector.every(Number.isFinite)) index.embedding = raw.embedding;
  return index;
}

export function lexicalScore(index, query) {
  const terms = [...new Set(normalizeSearch(query).split(/[^\p{L}\p{N}]+/u).filter(Boolean))];
  if (!terms.length) return 0;
  return terms.filter(term => index.searchText.includes(term)).length / terms.length;
}

export function matchesContent(item, query, semantic) {
  if (!query.trim()) return true;
  if (semantic?.query === query.trim()) return semantic.ids.includes(item.rowId || item.id);
  return lexicalScore(item.contentIndex || { searchText: normalizeSearch([item.title, item.key, item.summary, item.claim, item.intro, item.place].join(' ')) }, query) > 0;
}

export function inferInterests(rows) {
  const groups = new Map(); const seen = new Set();
  for (const row of rows) {
    if (row.status !== 'done' || !['recipe', 'exhibit'].includes(row.topic)) continue;
    const index = indexFromRow(row); const identity = storedContent(row).sourceUrl || index.searchText;
    if (seen.has(identity)) continue;
    seen.add(identity);
    for (const tag of new Map(index.tags.map(tag => [normalizeSearch(tag.label).replace(/\s+/g, ''), tag])).values()) {
      const key = index.category + ':' + normalizeSearch(tag.label).replace(/\s+/g, '');
      const group = groups.get(key) || { category: index.category, label: tag.label, evidence: [], signal: 'shared_interest' };
      group.evidence.push({ id: 'fc' + row.id, title: index.title, reason: tag.evidence });
      groups.set(key, group);
    }
  }
  return [...groups.values()].filter(group => group.evidence.length >= 2)
    .sort((a, b) => b.evidence.length - a.evidence.length || a.label.localeCompare(b.label)).slice(0, 12)
    .map(group => ({ ...group, count: group.evidence.length, evidence: group.evidence.slice(0, 6) }));
}
