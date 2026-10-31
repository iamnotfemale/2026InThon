import { randomBytes, createHash, createCipheriv, createDecipheriv, timingSafeEqual } from 'node:crypto';
import { put, get, list } from '@vercel/blob';
import { APP_ID, CONFIG_ID, IG_ID, GRAPH, isBotAccount } from './server.mjs';
import { signState, readState } from './oauth-state.mjs';
import { createCloudState } from './cloud-state.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');
const key = secret => createHash('sha256').update('inthon-meta-token-v1:' + secret).digest();
export function sealToken(value, secret) {
  const iv = randomBytes(12); const cipher = createCipheriv('aes-256-gcm', key(secret), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return { iv: iv.toString('base64'), data: data.toString('base64'), tag: cipher.getAuthTag().toString('base64') };
}
export function openToken(value, secret) {
  const decipher = createDecipheriv('aes-256-gcm', key(secret), Buffer.from(value.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(value.tag, 'base64'));
  return JSON.parse(Buffer.concat([decipher.update(Buffer.from(value.data, 'base64')), decipher.final()]).toString());
}

/** Latest credentials saved by the cloud login, or null when only the environment token exists. */
async function loadCredentials() {
  let cursor; let latest;
  do {
    const page = await list({ prefix: 'dm/credentials/', cursor, limit: 1000 });
    for (const blob of page.blobs) if (!latest || blob.pathname > latest.pathname) latest = blob;
    cursor = page.hasMore ? page.cursor : undefined;
  } while (cursor);
  if (!latest) return null;
  const result = await get(latest.pathname, { access: 'private' });
  if (!result?.stream) throw new Error('Token storage unavailable');
  const value = openToken(await new Response(result.stream).json(), process.env.META_APP_SECRET);
  if (value.userId !== IG_ID || !value.accessToken) throw new Error('Wrong token account');
  return value;
}

export async function loadAccessToken() {
  return (await loadCredentials())?.accessToken ?? process.env.META_ACCESS_TOKEN;
}

/**
 * Token for the Instagram User Profile API (sender handles). Meta documents a Page access token for it, so the
 * Page token saved at login is preferred; the user token is the fallback. `kind` is recorded with lookup errors.
 */
export async function loadProfileToken() {
  const value = await loadCredentials();
  if (value?.pageAccessToken) return { token: value.pageAccessToken, kind: 'page-token' };
  return { token: value?.accessToken ?? process.env.META_ACCESS_TOKEN, kind: 'user-token' };
}

/** Finds the Facebook Page connected to the bot's Instagram account and returns its Page access token. */
export async function findPageToken(api, headers) {
  try {
    const pages = await api('/me/accounts?fields=id,access_token,instagram_business_account&limit=100', { headers });
    const page = pages.data?.find(p => p.instagram_business_account?.id === IG_ID && typeof p.access_token === 'string');
    return page ? { pageAccessToken: page.access_token, pageStatus: 'ok' }
      : { pageAccessToken: null, pageStatus: pages.data?.length ? 'other-pages' : 'no-pages' };
  } catch (error) {
    // Only Meta's numeric code is kept (e.g. 200 = permission missing); error text can contain IDs.
    return { pageAccessToken: null, pageStatus: 'error-' + (/code (\d+)/.exec(error.message)?.[1] ?? '0') };
  }
}

const PAGE_STATUS_TEXT = {
  ok: '페이지 토큰을 확보했어요. 이제 DM을 보낸 사람의 Instagram 아이디를 조회할 수 있어요.',
  'no-pages': '페이지 토큰 없음: 승인한 계정에서 Facebook 페이지가 하나도 보이지 않아요. 로그인 구성에 pages_show_list 권한과 페이지 선택이 있는지 확인해 주세요.',
  'other-pages': '페이지 토큰 없음: 보이는 Facebook 페이지 중 @dimi_in과 연결된 페이지가 없어요. 승인 화면에서 @dimi_in과 연결된 페이지를 선택했는지, 페이지가 비즈니스 포트폴리오 소유라면 business_management 권한이 있는지 확인해 주세요.',
};
/** Plain-text result shown after the cloud login, including the Page token outcome. */
export function authResultText(pageStatus) {
  const base = 'Instagram 연결 처리가 완료되었습니다. 다른 계정에서 @dimi_in으로 새 DM을 보내 답장을 확인해 주세요.';
  if (!pageStatus) return base;
  const detail = PAGE_STATUS_TEXT[pageStatus]
    ?? (/^error-\d{1,6}$/.test(pageStatus)
      ? `페이지 토큰 없음: 페이지 목록 조회가 Meta 오류 코드 ${pageStatus.slice(6)}로 실패했어요. 코드 200이면 페이지 권한이 빠진 거예요.`
      : null);
  return detail ? `${base}\n\n${detail}` : base;
}

export async function handleCloudAuth(req, res) {
  const secret = process.env.META_APP_SECRET;
  const origin = new URL(process.env.PUBLIC_URL);
  if (origin.protocol !== 'https:' || origin.origin !== process.env.PUBLIC_URL) throw new Error('Invalid public origin');
  const url = new URL(req.url, origin);
  const allowedOrigins = [origin.origin, 'https://inthon-pi.vercel.app'];
  const requestOrigin = 'https://' + req.headers.host;
  const claim = createCloudState().claimPath;
  const cookieName = '__Host-ig_oauth_cloud';
  const redirect = (location, cookie) => {
    res.writeHead(303, { Location: location, 'Set-Cookie': cookie, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' }); res.end();
  };
  const clear = `${cookieName}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
  let stage = '로그인 요청 확인';
  try {
    if (!allowedOrigins.includes(requestOrigin)) throw new Error('Invalid login host');
    if (req.method !== 'GET') { res.statusCode = 405; return res.end('Method not allowed'); }
    if (url.pathname === '/auth/start') {
      const ticket = readState(url.searchParams.get('ticket'), secret, 'ticket');
      if (!await claim(`dm/oauth/tickets/${ticket.nonce}.json`)) throw new Error('Replay');
      const cookie = randomBytes(32).toString('hex');
      const callback = requestOrigin + '/auth/instagram/callback';
      const state = signState({ purpose: 'state', nonce: randomBytes(32).toString('hex'),
        cookieHash: hash(cookie), redirectUri: callback, expires: Date.now() + 600000 }, secret);
      const auth = new URL('https://www.facebook.com/dialog/oauth');
      auth.search = new URLSearchParams({ client_id: APP_ID, config_id: CONFIG_ID,
        redirect_uri: callback, response_type: 'code', display: 'popup',
        override_default_response_type: 'true', prompt: 'login', state }).toString();
      return redirect(auth.toString(), `${cookieName}=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    }
    const state = readState(url.searchParams.get('state'), secret, 'state');
    if (state.redirectUri !== requestOrigin + '/auth/instagram/callback') throw new Error('Callback origin mismatch');
    const cookie = (req.headers.cookie || '').split('; ').find(value => value.startsWith(cookieName + '='))?.slice(cookieName.length + 1);
    if (!cookie || !/^[a-f0-9]{64}$/.test(state.cookieHash || '')
      || !timingSafeEqual(Buffer.from(hash(cookie)), Buffer.from(state.cookieHash))) throw new Error('Cookie mismatch');
    if (!await claim(`dm/oauth/states/${state.nonce}.json`)) throw new Error('Replay');
    if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Login cancelled');
    const api = async (path, options = {}) => {
      const r = await fetch(GRAPH + path, { ...options, redirect: 'error', signal: AbortSignal.timeout(15000) });
      const body = await r.json();
      if (!r.ok || body.error) throw new Error(`Meta HTTP ${r.status}, code ${Number(body.error?.code) || 0}`);
      return body;
    };
    stage = '토큰 교환';
    const token = await api('/oauth/access_token', { method: 'POST', body: new URLSearchParams({
      client_id: APP_ID, client_secret: secret, redirect_uri: state.redirectUri, code: url.searchParams.get('code') }) });
    if (!token.access_token) throw new Error('Missing token');
    const headers = { Authorization: `Bearer ${token.access_token}` };
    stage = '대상 Instagram 계정 확인';
    // The numeric ID identifies the bot account; the handle can be renamed (inthon2team → dimi_in) without changing it.
    const account = await api(`/${IG_ID}?fields=id,username`, { headers });
    if (!isBotAccount(account)) throw new Error('Wrong account');
    stage = 'messages 구독';
    const subscribed = await api(`/${IG_ID}/subscribed_apps`, { method: 'POST', headers,
      body: new URLSearchParams({ subscribed_fields: 'messages' }) });
    if (subscribed.success !== true) throw new Error('Subscription failed');
    const check = await api(`/${IG_ID}/subscribed_apps`, { headers });
    if (!check.data?.some(app => (app.id === undefined || app.id === APP_ID) && app.subscribed_fields?.includes('messages'))) throw new Error('Subscription missing');
    stage = '페이지 토큰 확인';
    // Optional: a missing Page token must not block messaging, it only disables handle lookups.
    const { pageAccessToken, pageStatus } = await findPageToken(api, headers);
    stage = '암호화 저장';
    const encrypted = sealToken({ accessToken: token.access_token, pageAccessToken, userId: IG_ID,
      savedAt: new Date().toISOString(), expiresIn: token.expires_in ?? null }, secret);
    await put(`dm/credentials/${Date.now()}-${randomBytes(8).toString('hex')}.json`, JSON.stringify(encrypted),
      { access: 'private', addRandomSuffix: false, allowOverwrite: false, contentType: 'application/json' });
    return redirect('/auth/result?page=' + encodeURIComponent(pageStatus), clear);
  } catch (error) {
    res.writeHead(400, { 'Content-Type': 'text/plain; charset=utf-8', 'Set-Cookie': clear,
      'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer' });
    res.end(`${stage}: ${error.message.startsWith('Meta HTTP') ? error.message : '연결하지 못했습니다. 운영 도구에서 다시 시작해 주세요.'}`);
  }
}
