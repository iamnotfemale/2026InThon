import { randomBytes, createHash } from 'node:crypto';
import { validateRecipe } from './public/js/recipe-data.js';
import { validateContest } from './public/js/contest-data.js';
import { validateExhibit } from './public/js/exhibit-data.js';
import { validateRestaurant } from './public/js/restaurant-data.js';
import { validateSpace } from './public/js/space-data.js';
import { normalizeBeauty } from './public/js/beauty-data.js';
import { ROW_SELECT } from './public/js/dashboard-live.js';

export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;
const IGSID = /^\d{1,32}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const VERDICTS = new Set(['supported', 'refuted', 'context', 'unverified', 'not_checkable']);
const clip = (value, n) => (typeof value === 'string' && value ? value.slice(0, n) : null);

// Stores DM webhook state in Supabase through its REST API (PostgREST). Server-side only:
// the key must be a secret (sb_secret_...) or legacy service_role key, never a publishable one.
export function createSupabaseState({ url, key, fetchImpl = fetch, timeoutMs = 10000, now = Date.now, embedIndex }) {
  if (!url || !key) throw new Error('Supabase URL and secret key are required');
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  // New sb_secret_ keys are not JWTs and go only in apikey; legacy service_role JWTs also need Authorization.
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

  // returning: ask PostgREST for the written rows (return=representation) and parse them.
  const request = async (method, path, body, prefer, returning = false) => {
    const preferences = [returning ? 'return=representation' : 'return=minimal', ...(prefer ? [prefer] : [])].join(',');
    const res = await fetchImpl(base + path, { method, body: JSON.stringify(body),
      headers: { ...headers, Prefer: preferences }, signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return returning ? res.json() : null;
    let detail = {};
    try { detail = await res.json(); } catch {}
    // Never include the request body or key in errors.
    const error = new Error(`Supabase ${method} ${path.split('?')[0]} failed (${res.status}${detail.code ? ' ' + detail.code : ''})`);
    error.status = res.status; error.code = detail.code;
    throw error;
  };
  const checkKey = key => { if (!/^[a-f0-9]{64}$/.test(key)) throw new Error('Invalid reply key'); };
  const checkSender = igsid => { if (typeof igsid !== 'string' || !IGSID.test(igsid)) throw new Error('Invalid sender id'); };
  // Insert the sender, or refresh last_seen_at (and username when known) if it already exists.
  // Returns the stored row's username (null until known).
  const upsertSender = async (igsid, username) => {
    const rows = await request('POST', '/ig_accounts?on_conflict=igsid&select=username',
      { igsid, last_seen_at: new Date(now()).toISOString(), ...(USERNAME.test(username ?? '') ? { username } : {}) },
      'resolution=merge-duplicates', true);
    return { username: Array.isArray(rows) ? rows[0]?.username ?? null : null };
  };

  return {
    record: ({ receivedAt, messages, entries }) =>
      request('POST', '/dm_receipts', { received_at: receivedAt, messages, entries }),
    async reserveReply(key) {
      checkKey(key);
      try {
        await request('POST', '/dm_replies', { key, status: 'sending', reserved_at: new Date().toISOString() });
        return true;
      } catch (error) {
        // 23505 unique_violation: another instance (or an earlier delivery) already reserved this message.
        if (error.status === 409 && error.code === '23505') return false;
        throw error;
      }
    },
    async replyRecord({ key, status, at }) {
      checkKey(key);
      if (status !== 'sent') throw new Error(`Unsupported reply status: ${status}`);
      await request('PATCH', `/dm_replies?key=eq.${key}`, { status, sent_at: at });
    },

    // Time of a person's real message to the bot (signed webhook only): the 24-hour window for calendar reminders.
    async noteInbound(igsid, at) {
      checkSender(igsid);
      if (!Number.isFinite(Date.parse(at))) throw new Error('Invalid message time');
      await request('POST', '/rpc/note_inbound_dm', { p_igsid: igsid, p_message_at: at });
    },
    // Every Instagram account that DMs the bot, keyed by its Instagram-scoped ID. Resolves to { username }.
    async trackSender(igsid) {
      checkSender(igsid);
      return upsertSender(igsid);
    },
    // Saves the outcome of a Meta profile lookup: the handle on success, otherwise the error codes.
    async recordUsernameLookup(igsid, { username, error } = {}) {
      checkSender(igsid);
      const checked = { username_checked_at: new Date(now()).toISOString() };
      if (USERNAME.test(username ?? '')) {
        await request('PATCH', `/ig_accounts?igsid=eq.${igsid}`, { username, username_lookup_error: null, ...checked });
      } else {
        // Codes and field names only; strip anything else so free text can't end up stored.
        const reason = String(error ?? 'unknown').replace(/[^\w ,.:;()=-]/g, '').trim().slice(0, 200) || 'unknown';
        await request('PATCH', `/ig_accounts?igsid=eq.${igsid}`, { username_lookup_error: reason, ...checked });
      }
    },
    // Returns a one-time token for the web link page. Only its SHA-256 hash is stored.
    async issueLinkToken({ igsid, username }) {
      checkSender(igsid);
      await upsertSender(igsid, username);
      const token = randomBytes(32).toString('hex');
      await request('POST', '/link_tokens', { token_hash: createHash('sha256').update(token).digest('hex'), igsid,
        expires_at: new Date(now() + LINK_TOKEN_TTL_MS).toISOString() });
      return token;
    },
    // Fact-check history per sender: the extracted claim, verdict, reason and cited links, never the DM itself.
    async saveFactCheck(igsid, result = {}) {
      checkSender(igsid);
      if (result.status !== 'done') return null;
      const status = 'done';
      const recipe = result.action === 'recipe' ? validateRecipe({ ...result.recipe, is_recipe: true }) : null;
      const exhibit = result.action === 'schedule' && result.exhibit ? validateExhibit(result.exhibit) : null;
      const contest = result.action === 'schedule' && !exhibit ? validateContest(result.contest) : null;
      const space = result.action === 'space' ? validateSpace(result.space) : null;
      const beauty = result.action === 'beauty' ? normalizeBeauty(result.beauty) : null;
      const verdict = !recipe && !contest && !exhibit && !space && !beauty && VERDICTS.has(result.verdict) ? result.verdict : null;
      const contentIndex = result.contentIndex;
      const contentIndexes = exhibit ? result.contentIndexes : null;
      if (contentIndex && embedIndex) {
        try {
          if (contentIndexes?.length) {
            const embeddings = await embedIndex(contentIndexes.map(index => index.searchText));
            contentIndexes.forEach((index, i) => { index.embedding = embeddings[i]; });
          } else contentIndex.embedding = await embedIndex(contentIndex.searchText);
        }
        catch { /* Search can use the textual index if embedding is temporarily unavailable. */ }
      }
      const indexed = contentIndex ? { contentIndex, ...(contentIndexes ? { contentIndexes } : {}) } : {};
      if (result.action === 'restaurant') {
        // 맛집 has typed tables: one RPC saves the result row, its places and their menus in a single transaction.
        const restaurant = validateRestaurant(result.restaurant);
        const id = await request('POST', '/rpc/save_restaurant_result', {
          p_igsid: igsid, p_claim: clip(result.extracted?.claim, 1000) ?? restaurant.places[0].name,
          p_reason: JSON.stringify({ sourceUrl: result.media?.sourceUrl ?? null, ...indexed }),
          p_places: restaurant.places.map(({ name, category, intro, area, address, phone, hours, closed, priceRange, reservation, waiting,
            parking, menus, links, evidence, checks }) => ({ name, category, intro, area, address, phone, hours, closed, priceRange,
            reservation, waiting, parking, menus, links, evidence, checks })),
        }, undefined, true);
        return { id: Number.isSafeInteger(id) ? id : null };
      }
      const sources = (Array.isArray(result.cited) ? result.cited : []).slice(0, 3)
        .filter(s => typeof s?.url === 'string' && /^https?:\/\//.test(s.url))
        .map(s => ({ url: s.url.slice(0, 2000), title: clip(s.title, 300), source: clip(s.source, 200) }));
      const rows = await request('POST', '/factchecks?select=id', { igsid, status, verdict, sources,
        claim: recipe ? recipe.title : contest ? contest.title : exhibit ? clip(result.extracted?.claim, 1000) ?? exhibit.events[0].title
          : space ? clip(result.extracted?.claim, 1000) ?? space.places[0].name : beauty ? beauty.title : clip(result.extracted?.claim, 1000),
        topic: recipe ? 'recipe' : contest ? 'contest' : exhibit ? 'exhibit' : space ? 'space' : beauty ? 'beauty' : clip(result.extracted?.topic, 50),
        // shortcut: keep v1 recipes, contests, exhibitions, spaces and beauty in the existing RLS-protected result table; move to typed columns when the shared content schema lands.
        reason: recipe ? JSON.stringify({ recipe, sourceUrl: result.media?.sourceUrl ?? null, ...indexed })
          : contest ? JSON.stringify({ contest, sourceUrl: result.media?.sourceUrl ?? null, ...indexed })
          : exhibit ? JSON.stringify({ exhibit, sourceUrl: result.media?.sourceUrl ?? null, ...indexed })
          : space ? JSON.stringify({ space, sourceUrl: result.media?.sourceUrl ?? null, ...indexed })
          : beauty ? JSON.stringify({ beauty, sourceUrl: result.media?.sourceUrl ?? null, ...indexed })
          : contentIndex ? JSON.stringify({ reason: clip(result.reason, 2000), sourceUrl: result.media?.sourceUrl ?? null, ...indexed }) : clip(result.reason, 2000) },
      undefined, true);
      return { id: Array.isArray(rows) ? rows[0]?.id ?? null : null };
    },
    async recentResults(igsid) {
      checkSender(igsid);
      const rows = await request('GET', `/factchecks?igsid=eq.${igsid}&status=eq.done&select=${encodeURIComponent('igsid,' + ROW_SELECT)}&order=created_at.desc,id.desc&limit=3`,
        undefined, undefined, true);
      return rows.filter(row => row.igsid === igsid && row.status === 'done' && Number.isSafeInteger(row.id) && row.id > 0)
        .slice(0, 3).map(({ igsid: _, ...row }) => row);
    },
    async linkedUser(igsid) {
      checkSender(igsid);
      const rows = await request('GET', `/account_links?igsid=eq.${igsid}&select=user_id`, undefined, undefined, true);
      return rows[0]?.user_id ?? null;
    },
    // Called only after every result message was confirmed by Meta.
    async markFactCheckSent(id) {
      if (!Number.isSafeInteger(id) || id <= 0) throw new Error('Invalid fact-check id');
      await request('PATCH', `/factchecks?id=eq.${id}`, { dm_status: 'sent', dm_sent_at: new Date(now()).toISOString() });
    },
  };
}
