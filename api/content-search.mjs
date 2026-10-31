import { createHash } from 'node:crypto';
import { createOpenAIDecisions, cosine, embeddingMatches } from '../openai-decisions.mjs';
import { indexedItems, inferInterests, lexicalScore, normalizeSearch } from '../public/js/content-index.js';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../public/js/supabase-config.js';
import { createResultPreferences } from '../result-preferences.mjs';

// shortcut: bounded to the latest 200 owned results, matching the dashboard. Move retrieval to an indexed DB query when the library grows.
export function createContentSearchHandler({ fetchImpl = fetch, preferences, decisions, origin = 'https://inthon.yeoziphab.com' }) {
  const cache = new Map();
  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(JSON.stringify(value));
  };
  return async (req, res) => {
    if (req.method !== 'POST') return reply(res, 405, { error: 'POST 요청이 필요해요.' });
    if (req.headers.origin !== origin) return reply(res, 403, { error: '요청한 화면을 확인할 수 없어요.' });
    const authorization = req.headers.authorization;
    if (!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(authorization ?? '')) return reply(res, 401, { error: '먼저 로그인해 주세요.' });
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1500) return reply(res, 413, { error: '요청이 너무 커요.' }); }
      let body; try { body = JSON.parse(raw); } catch { return reply(res, 400, { error: '요청 형식이 올바르지 않아요.' }); }
      if (!body || typeof body !== 'object' || Array.isArray(body) || !['search', 'interests'].includes(body.action)
        || (body.action === 'search' && (typeof body.query !== 'string' || !body.query.trim() || body.query.length > 200))) {
        return reply(res, 400, { error: '검색어를 200자 이내로 입력해 주세요.' });
      }
      const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: authorization };
      const get = async path => {
        const response = await fetchImpl(SUPABASE_URL + path, { headers, signal: AbortSignal.timeout(10000) });
        if (!response.ok) throw Object.assign(new Error('Data unavailable'), { status: path.startsWith('/auth') ? 401 : 503 });
        return response.json();
      };
      const user = await get('/auth/v1/user');
      if (!/^[a-f0-9-]{36}$/i.test(user.id ?? '')) return reply(res, 401, { error: '로그인을 확인하지 못했어요.' });
      // The caller's JWT is forwarded: database RLS decides which rows are visible. Never accept a UID/IGSID from the body.
      const [owned, settings] = await Promise.all([
        get('/rest/v1/factchecks?select=id,created_at,status,topic,claim,reason&status=eq.done&order=created_at.desc&limit=200'),
        preferences.read(user.id),
      ]);
      const rows = owned.filter(row => row.status === 'done' && !settings.hidden.includes('fc' + row.id));
      const interests = inferInterests(rows);
      const query = body.action === 'search' ? body.query.trim() : '';
      const key = createHash('sha256').update(JSON.stringify([user.id, query, rows])).digest('hex');
      const cached = cache.get(key);
      if (cached && cached.expires > Date.now()) return reply(res, 200, cached.value);
      let candidates = rows.flatMap(indexedItems);
      // A known venue name is a constraint, not a reason to include every museum in the same post.
      if (query) {
        const compact = value => normalizeSearch(value).replace(/\s+/g, '');
        const words = [query, ...query.split(/\s+/)].map(compact).filter(word => word.length >= 3);
        const anchors = candidates.flatMap(c => c.index.attributes.filter(a => a.name === '장소')
          .flatMap(a => words.filter(word => compact(a.value).includes(word))));
        const anchor = anchors.sort((a, b) => b.length - a.length)[0];
        if (anchor) candidates = candidates.filter(c => c.index.attributes.some(a => a.name === '장소' && compact(a.value).includes(anchor)));
      }
      let degraded = !decisions; let rankedBy = 'index';
      let queryVector;
      if (query && decisions && candidates.some(c => embeddingMatches(c.index))) {
        try { queryVector = (await decisions.embed(query)).vector; } catch { degraded = true; }
      }
      candidates = candidates.map(c => ({ ...c, lexical: query ? lexicalScore(c.index, query)
        : interests.filter(g => g.category === c.index.category && c.index.tags.some(t => t.label.replace(/\s+/g, '') === g.label.replace(/\s+/g, ''))).length,
        similarity: queryVector && embeddingMatches(c.index) ? cosine(queryVector, c.index.embedding.vector) : 0 }));
      if (!query) candidates = candidates.filter(c => ['recipe', 'exhibit'].includes(c.index.category)
        && interests.some(group => group.category === c.index.category));
      candidates.sort((a, b) => (b.lexical + b.similarity) - (a.lexical + a.similarity));
      candidates = candidates.slice(0, 24);
      let answers = new Map();
      if (decisions && candidates.length) {
        try { answers = await decisions.rank({ query, interests, candidates }); rankedBy = answers.size ? 'decisions' : 'index'; degraded ||= !answers.size; }
        catch { degraded = true; }
      }
      const results = candidates.map(c => ({ id: c.id, score: answers.get(c.id)?.score ?? null,
        fallback: c.lexical + c.similarity }))
        .filter(c => c.score !== null ? c.score >= 1 : c.fallback > 0)
        .sort((a, b) => (b.score ?? b.fallback) - (a.score ?? a.fallback))
        .map(({ id }) => id);
      const value = { ids: results, interests, rankedBy, degraded, query, scope: 'latest_200' };
      for (const [k, entry] of cache) if (entry.expires <= Date.now()) cache.delete(k);
      if (cache.size >= 100) cache.delete(cache.keys().next().value);
      cache.set(key, { value, expires: Date.now() + 60000 });
      return reply(res, 200, value);
    } catch (error) { return reply(res, error.status === 401 ? 401 : 503, { error: '지금은 검색을 마치지 못했어요. 잠시 후 다시 시도해 주세요.' }); }
  };
}

let handler;
export default function contentSearch(req, res) {
  if (!process.env.META_APP_SECRET || !process.env.BLOB_READ_WRITE_TOKEN) { res.statusCode = 503; return res.end('Server configuration is incomplete'); }
  handler ??= createContentSearchHandler({ preferences: createResultPreferences({ secret: process.env.META_APP_SECRET }),
    decisions: createOpenAIDecisions({ apiKey: process.env.OPENAI_API_KEY }), origin: process.env.PUBLIC_URL || 'https://inthon.yeoziphab.com' });
  return handler(req, res);
}
