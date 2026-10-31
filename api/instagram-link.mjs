import { createInstagramLink } from '../instagram-link.mjs';
import { createResultPreferences } from '../result-preferences.mjs';
import { deleteMemberAccount } from '../account-deletion.mjs';
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from '../public/js/supabase-config.js';

export function createLinkHandler({ links, preferences, deleteAccount, fetchImpl = fetch, origin = 'https://inthon.yeoziphab.com' }) {
  const respond = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(value));
  };
  return async (req, res) => {
    if (req.method !== 'POST') return respond(res, 405, { error: 'POST 요청이 필요해요.' });
    if (req.headers.origin !== origin) return respond(res, 403, { error: '요청한 화면을 확인할 수 없어요.' });
    const authorization = req.headers.authorization;
    if (!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(authorization ?? '')) return respond(res, 401, { error: 'Google로 먼저 로그인해 주세요.' });
    const headers = { apikey: SUPABASE_PUBLISHABLE_KEY, Authorization: authorization, 'Content-Type': 'application/json' };
    try {
      let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 1000) return respond(res, 413, { error: '요청이 너무 커요.' }); }
      let body; try { body = JSON.parse(raw); } catch { return respond(res, 400, { error: '요청 형식이 올바르지 않아요.' }); }
      const userResponse = await fetchImpl(SUPABASE_URL + '/auth/v1/user', { headers, signal: AbortSignal.timeout(10000) });
      if (!userResponse.ok) return respond(res, 401, { error: '로그인이 만료됐어요. 다시 로그인해 주세요.' });
      const user = await userResponse.json();
      if (!/^[a-f0-9-]{36}$/i.test(user.id ?? '')) return respond(res, 401, { error: '로그인을 확인하지 못했어요.' });
      if (body.action === 'preferences') return respond(res, 200, body.delivery !== undefined || body.item !== undefined
        ? await preferences.update(user.id, body) : await preferences.read(user.id));
      if (body.action === 'issue') return respond(res, 200, { status: 'pending', ...await links.issue(user.id, body.username) });
      // Only ever deletes the caller's own account: the user ID comes from the verified Google session above.
      if (body.action === 'delete-account') {
        if (!deleteAccount) return respond(res, 503, { error: '지금은 계정을 삭제할 수 없어요. contact@yeoziphab.com으로 알려 주세요.' });
        await deleteAccount(user.id);
        return respond(res, 200, { status: 'deleted' });
      }
      if (body.action !== 'status') return respond(res, 400, { error: '지원하지 않는 요청이에요.' });
      const state = await links.status(user.id);
      if (state.status !== 'verified') return respond(res, 200, state);
      // Reuse the database's existing atomic one-time link RPC as this authenticated Google user.
      const linked = await fetchImpl(SUPABASE_URL + '/rest/v1/rpc/link_instagram', { method: 'POST', headers,
        body: JSON.stringify({ p_token: state.token }), signal: AbortSignal.timeout(10000) });
      if (!linked.ok) {
        // A previous poll may have committed the RPC before its response was lost.
        const existing = await fetchImpl(SUPABASE_URL + '/rest/v1/account_links?select=igsid&user_id=eq.' + user.id,
          { headers, signal: AbortSignal.timeout(10000) });
        if (!existing.ok || !(await existing.json()).some(row => row.igsid === state.igsid)) throw new Error('Link not committed');
      }
      return respond(res, 200, { status: 'linked', username: state.username });
    } catch (error) {
      return respond(res, error.status === 400 || error.status === 429 ? error.status : 503,
        { error: error.status === 400 || error.status === 429 ? error.message : '연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.' });
    }
  };
}

let handler;
export default function instagramLinkHandler(req, res) {
  if (!process.env.META_APP_SECRET || !process.env.BLOB_READ_WRITE_TOKEN) {
    res.statusCode = 503; return res.end('Server configuration is incomplete');
  }
  const preferences = createResultPreferences({ secret: process.env.META_APP_SECRET });
  handler ??= createLinkHandler({ links: createInstagramLink({ secret: process.env.META_APP_SECRET }), preferences,
    // Requires the server-only Supabase secret key (already set for the DM bot) to remove the login account.
    deleteAccount: process.env.SUPABASE_SECRET_KEY ? uid => deleteMemberAccount({ uid, preferences,
      supabaseUrl: process.env.SUPABASE_URL || SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY }) : undefined,
    origin: process.env.PUBLIC_URL || 'https://inthon.yeoziphab.com' });
  return handler(req, res);
}
