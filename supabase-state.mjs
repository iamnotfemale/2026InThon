import { randomBytes, createHash } from 'node:crypto';

export const LINK_TOKEN_TTL_MS = 10 * 60 * 1000;
const IGSID = /^\d{1,32}$/;
const USERNAME = /^[A-Za-z0-9._]{1,30}$/;
const FACTCHECK_STATUSES = new Set(['done', 'not_checkable', 'no_input', 'failed']);
const VERDICTS = new Set(['supported', 'refuted', 'context', 'unverified', 'not_checkable']);
const clip = (value, n) => (typeof value === 'string' && value ? value.slice(0, n) : null);

// Stores DM webhook state in Supabase through its REST API (PostgREST). Server-side only:
// the key must be a secret (sb_secret_...) or legacy service_role key, never a publishable one.
export function createSupabaseState({ url, key, fetchImpl = fetch, timeoutMs = 10000, now = Date.now }) {
  if (!url || !key) throw new Error('Supabase URL and secret key are required');
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  // New sb_secret_ keys are not JWTs and go only in apikey; legacy service_role JWTs also need Authorization.
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

  const request = async (method, path, body, prefer) => {
    const res = await fetchImpl(base + path, { method, body: JSON.stringify(body),
      headers: prefer ? { ...headers, Prefer: `${headers.Prefer},${prefer}` } : headers,
      signal: AbortSignal.timeout(timeoutMs) });
    if (res.ok) return null;
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
  const upsertSender = (igsid, username) => request('POST', '/ig_accounts?on_conflict=igsid',
    { igsid, last_seen_at: new Date(now()).toISOString(), ...(USERNAME.test(username ?? '') ? { username } : {}) },
    'resolution=merge-duplicates');

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

    // Every Instagram account that DMs the bot, keyed by its Instagram-scoped ID.
    async trackSender(igsid) {
      checkSender(igsid);
      await upsertSender(igsid);
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
      const status = FACTCHECK_STATUSES.has(result.status) ? result.status : 'failed';
      const verdict = VERDICTS.has(result.verdict) ? result.verdict : (status === 'not_checkable' ? 'not_checkable' : null);
      const sources = (Array.isArray(result.cited) ? result.cited : []).slice(0, 3)
        .filter(s => typeof s?.url === 'string' && /^https?:\/\//.test(s.url))
        .map(s => ({ url: s.url.slice(0, 2000), title: clip(s.title, 300), source: clip(s.source, 200) }));
      await request('POST', '/factchecks', { igsid, status, verdict, sources,
        claim: clip(result.extracted?.claim, 1000), topic: clip(result.extracted?.topic, 50), reason: clip(result.reason, 2000) });
    },
  };
}
