// Stores DM webhook state in Supabase through its REST API (PostgREST). Server-side only:
// the key must be a secret (sb_secret_...) or legacy service_role key, never a publishable one.
export function createSupabaseState({ url, key, fetchImpl = fetch, timeoutMs = 10000 }) {
  if (!url || !key) throw new Error('Supabase URL and secret key are required');
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const headers = { apikey: key, 'Content-Type': 'application/json', Prefer: 'return=minimal' };
  // New sb_secret_ keys are not JWTs and go only in apikey; legacy service_role JWTs also need Authorization.
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;

  const request = async (method, path, body) => {
    const res = await fetchImpl(base + path, { method, headers, body: JSON.stringify(body),
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
  };
}
