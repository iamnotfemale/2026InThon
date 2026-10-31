// Deletes a member and everything tied to them. Used when signup finds the person is under 14
// (the privacy policy promises immediate deletion) and reusable for account withdrawal.
const UID = /^[a-f0-9-]{36}$/i;
const IGSID = /^\d{1,32}$/;

/**
 * Order matters for retries: linked Instagram data first, then settings, the login account last,
 * so a failure part-way can be repeated by the same signed-in user.
 */
export async function deleteMemberAccount({ uid, supabaseUrl, secretKey, preferences, fetchImpl = fetch }) {
  if (!UID.test(uid ?? '')) throw new Error('Invalid user id');
  if (!supabaseUrl || !secretKey) throw new Error('Account deletion is not configured');
  // Server-only secret key; new sb_secret_ keys go in apikey only, legacy service_role JWTs also in Authorization.
  const headers = { apikey: secretKey, 'Content-Type': 'application/json' };
  if (!secretKey.startsWith('sb_')) headers.Authorization = `Bearer ${secretKey}`;
  const call = async (method, path) => {
    const response = await fetchImpl(supabaseUrl.replace(/\/+$/, '') + path, { method, headers, signal: AbortSignal.timeout(10000) });
    if (!response.ok && !(method === 'DELETE' && response.status === 404)) {
      throw new Error(`Account deletion failed (${method} ${path.split('?')[0]} ${response.status})`);
    }
    return response;
  };
  const links = await (await call('GET', `/rest/v1/account_links?select=igsid&user_id=eq.${uid}`)).json();
  // Deleting the sender row cascades to its fact-check results, link tokens and the account link.
  for (const { igsid } of links) {
    if (IGSID.test(igsid ?? '')) await call('DELETE', `/rest/v1/ig_accounts?igsid=eq.${igsid}`);
  }
  await preferences?.clear(uid);
  await call('DELETE', `/auth/v1/admin/users/${uid}`);
  return { deletedInstagramAccounts: links.length };
}
