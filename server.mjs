import http from 'node:http';
import { createHmac, createHash, timingSafeEqual, randomBytes } from 'node:crypto';
import { readFileSync, appendFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { join, dirname } from 'node:path';
import { readSecrets, writeSecrets } from './secrets.mjs';
import { createLoginTicket } from './oauth-state.mjs';
import { isContentMessage } from './instagram-source.mjs';
import { resultLinkMessage } from './result-preferences.mjs';
import { CONTEST_ACK } from './contest.mjs';
import { RESTAURANT_ACK } from './restaurant.mjs';
import { createSenderActivities } from './sender-activity.mjs';

export const SCOPES = ['instagram_basic', 'instagram_manage_messages'];
export const APP_ID = '2418018855613539';
export const CONFIG_ID = '2085773485459248';
export const IG_ID = '17841414630453998';
export const GRAPH = 'https://graph.facebook.com/v26.0';
// A username can change; the configured numeric account ID is the authorization boundary.
export const isBotAccount = account => account?.id === IG_ID;
const root = dirname(fileURLToPath(import.meta.url));
const random = () => randomBytes(32).toString('hex');
const equal = (a, b) => typeof a === 'string' && typeof b === 'string'
  && Buffer.byteLength(a) === Buffer.byteLength(b) && timingSafeEqual(Buffer.from(a), Buffer.from(b));
const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const page = content => `<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>디미 DM 테스트</title><style>body{font:16px/1.6 system-ui;max-width:780px;margin:40px auto;padding:0 20px}label{display:block;margin:16px 0}input{display:block;width:100%;box-sizing:border-box;padding:8px}button{padding:10px 16px;cursor:pointer}code{overflow-wrap:anywhere}pre{white-space:pre-wrap}section{border-top:1px solid #ccc;margin-top:24px;padding-top:12px}</style><main>${content}</main></html>`;
function respond(res, status, text, html = false) {
  res.writeHead(status, { 'Content-Type': html ? 'text/html; charset=utf-8' : 'text/plain; charset=utf-8',
    'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'" });
  res.end(text);
}
function redirect(res, location, cookie) {
  res.writeHead(303, { Location: location, 'Cache-Control': 'no-store', 'Referrer-Policy': 'no-referrer',
    ...(cookie ? { 'Set-Cookie': cookie } : {}) }); res.end();
}
async function body(req, limit = 1024 * 1024) {
  const chunks = []; let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > limit) throw Object.assign(new Error('Request too large'), { status: 413 });
    chunks.push(chunk);
  }
  return Buffer.concat(chunks);
}

export function readReplyKeys(file) {
  try {
    return new Set(readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
      const { key } = JSON.parse(line);
      if (!/^[a-f0-9]{64}$/.test(key ?? '')) throw new Error('Invalid reply journal');
      return key;
    }));
  } catch (error) { if (error.code === 'ENOENT') return new Set(); throw error; }
}

export const FACTCHECK_ACK = '디미가 핵심 주장과 근거를 살펴보고 정리해드릴게요!';
export const FACTCHECK_FAILED = '지금은 근거 확인을 마치지 못했어요. 잠시 후 다시 보내주세요.';
export const CHAT_FAILED = '지금은 답장을 만들지 못했어요. 잠시 후 다시 보내주세요.';
// DMs that ask for a web login link instead of a fact-check.
export const LINK_COMMANDS = new Set(['연결', '로그인', '대시보드']);
const USERNAME = /^[A-Za-z0-9._]{1,30}$/; // Instagram handle format
export const LINK_FAILED = '지금은 연결 링크를 만들지 못했어요. 잠시 후 다시 "연결"이라고 보내주세요.';
export const linkMessage = url => '아래 링크를 열고 구글로 로그인하면 이 Instagram 계정이 연결돼요.\n'
  + '링크는 10분 동안 한 번만 쓸 수 있어요. 다른 사람에게 보내지 마세요.\n\n' + url;

export function createServers({ config, persist, record, apiFetch = fetch, now = Date.now,
  handledReplies = new Set(), replyRecord = () => {}, reserveReply, background = task => task, loadAccessToken, loadProfileToken, factCheck,
  observeMessages, trackSender, issueLinkToken, saveFactCheck, markFactCheckSent, recordUsernameLookup, respondToMessage, verifyInstagramCode, getDeliveryMode }) {
  const csrf = random(); const launches = new Map(); const states = new Map();
  const stats = { verifications: 0, signedEvents: 0, messages: 0, replies: 0, replyFailures: 0, lastEventAt: null,
    tokenSaved: Boolean(config.accessToken), subscription: '미확인', lastError: null, senderActionFailures: 0 };
  const callback = () => `${config.publicUrl}/auth/instagram/callback`;
  const expire = map => { for (const [key, item] of map) if (item.expires < now()) map.delete(key); };
  const save = updates => { const next = { ...config, ...updates }; persist(next); Object.assign(config, updates); };
  async function api(url, options = {}) {
    const response = await apiFetch(url, { ...options, signal: options.signal ?? AbortSignal.timeout(15000), redirect: 'error' });
    const data = await response.json();
    if (!response.ok || data.error || data.error_type) {
      // API errors can echo credentials, so expose only numeric codes.
      // Subcode and type (e.g. OAuthException) are fixed identifiers, safe to log; error text can contain user IDs.
      const subcode = Number(data.error?.error_subcode) || 0;
      const type = /^\w{1,64}$/.test(data.error?.type ?? '') ? data.error.type : '';
      throw new Error(`Meta API 요청 실패 (HTTP ${response.status}, code ${Number(data.error?.code) || 0}`
        + `${subcode ? `, subcode ${subcode}` : ''}${type ? `, ${type}` : ''})`);
    }
    return data;
  }
  const beginActivity = createSenderActivities({
    sendAction: (recipient, action, token) => api(`${GRAPH}/${IG_ID}/messages`, { method: 'POST',
      signal: AbortSignal.timeout(2000), headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: recipient }, sender_action: action }) }),
    onFailure: action => { stats.senderActionFailures++; console.warn('Instagram sender action failed:', action); },
  });
  async function profile(token) {
    const result = await api(`${GRAPH}/me/assigned_instagram_accounts?fields=id,username&limit=100`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    const account = result.data?.find(isBotAccount);
    if (account) return account;
    // The assigned-accounts edge may omit the target; verify the explicitly configured account with the same token.
    const target = await api(`${GRAPH}/${IG_ID}?fields=id,username`, { headers: { Authorization: `Bearer ${token}` } });
    if (!isBotAccount(target)) {
      throw new Error('@dimi_in 계정의 토큰인지 확인해 주세요.');
    }
    return target;
  }
  async function autoReply(deliveries) {
    let accessToken = config.accessToken;
    if (loadAccessToken) {
      try { accessToken = await loadAccessToken(); }
      catch { stats.replyFailures++; stats.lastError = '운영 토큰을 불러오지 못했습니다.'; return; }
    }
    if (!accessToken || config.userId !== IG_ID) return;
    for (const { accountId, event: m } of deliveries) {
      const age = now() - Number(m.timestamp);
      if (accountId !== IG_ID || m.recipient?.id !== IG_ID || m.sender?.id === IG_ID
        || typeof m.sender?.id !== 'string' || !/^\d+$/.test(m.sender.id)
        || typeof m.message.mid !== 'string' || !m.message.mid || m.message.mid.length > 2048
        || m.message.is_self || m.message.is_deleted || !Number.isFinite(age) || age < -300000 || age > 86400000) continue;
      const key = createHash('sha256').update(`${IG_ID}:${m.message.mid}`).digest('hex');
      if (handledReplies.has(key)) continue;
      handledReplies.add(key);
      let activity;
      try {
        // Reserve before sending: retries, concurrent deliveries and restarts must not send the greeting twice.
        if (reserveReply) {
          if (!await reserveReply(key)) continue;
        } else replyRecord({ key, status: 'sending', at: new Date(now()).toISOString() });
        activity = beginActivity(m.sender.id, accessToken);
        const send = async message => {
          const result = await api(`${GRAPH}/${IG_ID}/messages`, { method: 'POST',
            headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ recipient: { id: m.sender.id }, message: typeof message === 'string' ? { text: message } : message }) });
          if (typeof result.message_id !== 'string' || !result.message_id) throw new Error('Send not confirmed');
        };
        const sender = m.sender.id;
        // Storage problems must not stop the reply itself; they only cost history.
        const quietly = async (task, label) => { try { await task(); } catch { stats.lastError = label; } };
        let knownUsername = null;
        let tracking;
        const track = () => tracking ??= trackSender
          ? quietly(async () => { knownUsername = (await trackSender(sender))?.username ?? null; }, '발신자 기록 실패')
          : Promise.resolve();
        // The choice prompt needs only a durable content ticket; record/profile work follows its delivery.
        if (!respondToMessage || !isContentMessage(m.message) || m.message.quick_reply) track();
        // The handle is only for display; linking and replies work without it. Failures are kept as codes only
        // (Vercel log + ig_accounts.username_lookup_error), never Meta's error text, which can contain user IDs.
        const lookupUsername = async () => {
          let outcome; let profileToken = accessToken; let tokenKind = 'user-token';
          try {
            // Meta documents a Page token for the User Profile API; the kind used is kept with any error for diagnosis.
            if (loadProfileToken) ({ token: profileToken, kind: tokenKind } = await loadProfileToken());
            const profile = await api(`${GRAPH}/${sender}?fields=username`, { headers: { Authorization: `Bearer ${profileToken}` } });
            outcome = USERNAME.test(profile.username ?? '') ? { username: profile.username }
              : { error: `${tokenKind}: no username; fields: ${Object.keys(profile).filter(k => k !== 'id').join(',') || 'none'}` };
          } catch (error) {
            outcome = { error: tokenKind + ': '
              + (error.message.startsWith('Meta API') ? error.message.replace(/^.*?\((.*)\)$/, '$1') : error.name) };
          }
          if (outcome.error) console.warn('Instagram profile lookup failed:', outcome.error);
          if (recordUsernameLookup) await quietly(() => recordUsernameLookup(sender, outcome), '아이디 조회 결과 기록 실패');
          return outcome.username;
        };
        const command = typeof m.message.text === 'string' ? m.message.text.trim() : '';
        const isCode = /^(?=.*[A-Z])(?=.*\d)[A-Z0-9]{6}$/i.test(command);
        if (verifyInstagramCode && isCode && !isContentMessage(m.message)) {
          await track();
          let reply;
          try { reply = await verifyInstagramCode(command, sender); }
          catch { reply = '인증을 확인하지 못했어요. 잠시 후 같은 번호를 다시 보내 주세요.'; }
          await send(reply);
        } else if (issueLinkToken && config.publicUrl && LINK_COMMANDS.has(command)) {
          await track();
          const username = knownUsername ?? await lookupUsername();
          let text;
          try { text = linkMessage(`${config.publicUrl}/link#token=${await issueLinkToken({ igsid: sender, username })}`); }
          catch { stats.lastError = '연결 링크 생성 실패'; text = LINK_FAILED; }
          await send(text);
        } else if (respondToMessage || factCheck) {
          const content = !respondToMessage || isContentMessage(m.message);
          // Backfill a missing handle alongside the AI response, without delaying the reply.
          const backfill = () => track().then(() => trackSender && recordUsernameLookup && !knownUsername ? lookupUsername() : null);
          if (!respondToMessage) { await send(FACTCHECK_ACK); activity.typing(); }
          let result;
          // A model or search outage must not be reported as a verdict; tell the user the check did not finish.
          try { result = await (respondToMessage ?? factCheck)(m.message, {
            senderId: sender, acknowledge: async action => { await send(action === 'recipe'
              ? '디미가 금방 정리해드릴게요! 재료와 조리 순서까지 함께 살펴볼게요.'
              : action === 'schedule' ? CONTEST_ACK : action === 'restaurant' ? RESTAURANT_ACK : FACTCHECK_ACK); activity.typing(); },
          }); }
          catch { stats.lastError = 'AI 처리 실패'; result = { status: 'failed', messages: [content ? FACTCHECK_FAILED : CHAT_FAILED] }; }
          let savedId = null;
          if ((result.kind === 'content' || !respondToMessage) && result.status === 'done' && saveFactCheck) {
            await track(); // The sender row must exist before writing a content result with its foreign key.
            await quietly(async () => { savedId = (await saveFactCheck(sender, result))?.id ?? null; }, '팩트체크 기록 실패');
          }
          let messages = result.messages;
          if (savedId && config.publicUrl && getDeliveryMode) {
            let mode = 'summary';
            try { mode = await getDeliveryMode(sender); } catch { stats.lastError = '받는 방식 조회 실패'; }
            if (mode !== 'full') messages = [resultLinkMessage(config.publicUrl, savedId, result)];
          }
          for (const text of messages) await send(text);
          await activity.finish();
          // Reached only if every message was confirmed; a failed send leaves the record 'pending' for the dashboard.
          if (savedId && markFactCheckSent) await quietly(() => markFactCheckSent(savedId), 'DM 발송 기록 실패');
          await backfill();
        } else await send('안녕, 디미예요!');
        await track();
        stats.replies++;
        await replyRecord({ key, status: 'sent', at: new Date(now()).toISOString() });
      } catch (error) {
        stats.replyFailures++;
        stats.lastError = '자동 답장: ' + (error.message.startsWith('Meta API') ? error.message : '전송 결과를 확인하지 못했습니다.');
        // shortcut: failed or uncertain sends are not retried; add a durable outbox before using this beyond a local test.
      } finally { await activity?.finish(); }
    }
  }
  const protect = handler => async (req, res) => {
    try { await handler(req, res); }
    catch (error) {
      stats.lastError = '요청 처리 실패. 로컬 설정과 Meta 연결 상태를 확인해 주세요.';
      if (!res.headersSent) respond(res, error.status || 500, stats.lastError);
      else res.end();
    }
  };
  const publicServer = http.createServer(protect(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    if (req.method === 'GET' && url.pathname === '/health') return respond(res, 200, 'ok');
    if (url.pathname === '/webhooks/instagram' && req.method === 'GET') {
      if (url.searchParams.get('hub.mode') !== 'subscribe'
        || !equal(url.searchParams.get('hub.verify_token'), config.verifyToken)
        || !url.searchParams.has('hub.challenge')) return respond(res, 403, 'Forbidden');
      stats.verifications++;
      return respond(res, 200, url.searchParams.get('hub.challenge'));
    }
    if (url.pathname === '/webhooks/instagram' && req.method === 'POST') {
      if (!config.webhookSecret) return respond(res, 503, 'Webhook signing secret is not configured');
      const raw = await body(req);
      const signature = req.headers['x-hub-signature-256'];
      const expected = 'sha256=' + createHmac('sha256', config.webhookSecret).update(raw).digest('hex');
      if (!equal(signature, expected)) return respond(res, 403, 'Invalid signature');
      let event;
      try { event = JSON.parse(raw); } catch { return respond(res, 400, 'Invalid JSON'); }
      if (event?.object !== 'instagram' || !Array.isArray(event.entry)
        || event.entry.some(e => !e || typeof e !== 'object' || (e.messaging !== undefined && !Array.isArray(e.messaging))
          || (e.changes !== undefined && !Array.isArray(e.changes)))) {
        return respond(res, 400, 'Invalid Instagram event');
      }
      const messages = event.entry.flatMap(e => [...(e.messaging ?? []),
        ...(e.changes ?? []).filter(c => c?.field === 'messages').map(c => c.value)]
        .map(m => ({ accountId: e.id, event: m })))
        .filter(({ event: m }) => m?.message && !m.message.is_echo);
      const receipt = { receivedAt: new Date(now()).toISOString(), messages: messages.length, entries: event.entry.length };
      await record(receipt); // Persist before acknowledging so failed writes can be retried by Meta.
      stats.signedEvents++; stats.messages += messages.length; stats.lastEventAt = receipt.receivedAt;
      respond(res, 200, 'EVENT_RECEIVED');
      // Acknowledge promptly; sending the reply must not delay the webhook response.
      const tasks = [autoReply(messages)];
      if (observeMessages) tasks.push(Promise.resolve().then(() => observeMessages(messages))
        .catch(() => { console.warn('Media diagnostic storage unavailable'); }));
      await background(Promise.all(tasks));
      return;
    }
    if (req.method === 'GET' && url.pathname === '/auth/start') {
      expire(launches); expire(states);
      const ticket = url.searchParams.get('ticket'); const launch = launches.get(ticket); launches.delete(ticket);
      if (!launch) return respond(res, 403, '로컬 설정 화면에서 로그인을 시작해 주세요.');
      const state = random(); const cookie = random();
      states.set(state, { cookie, expires: now() + 600000, redirectUri: callback() });
      const auth = new URL('https://www.facebook.com/dialog/oauth');
      auth.search = new URLSearchParams({ client_id: APP_ID, config_id: CONFIG_ID, redirect_uri: callback(),
        response_type: 'code', display: 'popup', override_default_response_type: 'true', state, prompt: 'login' }).toString();
      return redirect(res, auth.href, `__Host-ig_oauth=${cookie}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=600`);
    }
    if (req.method === 'GET' && url.pathname === '/auth/instagram/callback') {
      expire(states);
      const state = url.searchParams.get('state'); const pending = states.get(state);
      const cookie = (req.headers.cookie ?? '').split('; ').find(x => x.startsWith('__Host-ig_oauth='))?.slice(16);
      if (!pending || !equal(cookie, pending.cookie)) return respond(res, 403, '로그인 요청을 확인할 수 없습니다. 로컬 화면에서 다시 시작해 주세요.');
      states.delete(state);
      let stage = '권한 승인';
      try {
        if (url.searchParams.has('error') || !url.searchParams.get('code')) throw new Error('Instagram 권한 승인이 완료되지 않았습니다.');
        stage = '토큰 교환';
        const exchange = new URL(`${GRAPH}/oauth/access_token`);
        exchange.search = new URLSearchParams({ client_id: APP_ID, client_secret: config.appSecret,
          redirect_uri: pending.redirectUri, code: url.searchParams.get('code') }).toString();
        const token = await api(exchange);
        if (!token.access_token) throw new Error('접근 토큰을 받지 못했습니다.');
        stage = 'Instagram 계정 확인';
        const account = await profile(token.access_token);
        stage = '비즈니스 확인';
        const business = await api(`${GRAPH}/me?fields=client_business_id`, { headers: { Authorization: `Bearer ${token.access_token}` } });
        if (!/^\d+$/.test(business.client_business_id ?? '')) throw new Error('비즈니스 ID 확인 실패');
        stage = '암호화 저장';
        save({ accessToken: token.access_token, userId: account.id, businessId: business.client_business_id,
          configId: CONFIG_ID, expiresIn: token.expires_in ?? null, tokenSavedAt: new Date(now()).toISOString() });
        stats.tokenSaved = true; stats.subscription = '미확인'; stats.lastError = null;
      } catch (error) {
        const known = ['Instagram 권한 승인이 완료되지 않았습니다.', '접근 토큰을 받지 못했습니다.',
          '@dimi_in 계정의 토큰인지 확인해 주세요.', '비즈니스 ID 확인 실패', 'Windows credential encryption failed'];
        stats.lastError = `${stage}: ${error.message.startsWith('Meta API') || known.includes(error.message)
          ? error.message : '처리하지 못했습니다. 다시 연결해 주세요.'}`;
      }
      return redirect(res, '/auth/result', '__Host-ig_oauth=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0');
    }
    if (req.method === 'GET' && url.pathname === '/auth/result') return respond(res, 200, '로그인 처리를 마쳤습니다. 이 창을 닫고 로컬 설정 화면에서 결과를 확인해 주세요.');
    return respond(res, 404, 'Not found');
  }));
  const adminServer = http.createServer(protect(async (req, res) => {
    const host = req.headers.host;
    if (!/^127\.0\.0\.1:\d+$/.test(host ?? '') || req.headers['x-forwarded-for']) return respond(res, 403, 'Local access only');
    const url = new URL(req.url, `http://${host}`);
    if (req.method === 'POST') {
      // The in-app browser uses an opaque origin for local forms; the random CSRF token still binds every write.
      if (req.headers.origin !== `http://${host}` && req.headers.origin !== 'null') {
        return respond(res, 403, '저장 요청의 출처를 확인할 수 없습니다. http://127.0.0.1:8788/ 화면을 새로 열어 주세요.');
      }
      if (req.headers['content-type']?.split(';')[0].trim() !== 'application/x-www-form-urlencoded') return respond(res, 415, '지원하지 않는 요청 형식입니다.');
      const form = new URLSearchParams((await body(req, 16384)).toString());
      if (!equal(form.get('csrf'), csrf)) return respond(res, 403, '설정 화면이 만료됐습니다. http://127.0.0.1:8788/ 화면을 새로 열어 다시 저장해 주세요.');
      if (url.pathname === '/config') {
        const appSecret = form.get('appSecret')?.trim();
        if ((!appSecret && !config.appSecret) || (appSecret && !/^[a-f0-9]{32}$/i.test(appSecret))) {
          return respond(res, 400, 'Meta 앱 시크릿을 확인해 주세요. 시크릿은 32자리 16진수입니다.');
        }
        const changed = appSecret && appSecret !== config.appSecret;
        save({ appSecret: appSecret || config.appSecret, webhookSecret: appSecret || config.appSecret,
          ...(changed ? { accessToken: null, userId: null, tokenSavedAt: null } : {}) });
        if (changed) { stats.tokenSaved = false; stats.subscription = '미확인'; launches.clear(); states.clear(); }
        stats.lastError = null;
      } else if (url.pathname === '/cloud-login') {
        if (!config.appSecret) return respond(res, 400, '먼저 앱 설정을 저장해 주세요.');
        return redirect(res, 'https://inthon-pi.vercel.app/auth/start?ticket=' + createLoginTicket(config.appSecret));
      } else if (url.pathname === '/login') {
        if (!config.publicUrl || !config.appSecret) return respond(res, 400, '먼저 앱 설정을 저장해 주세요.');
        expire(launches); const ticket = random(); launches.set(ticket, { expires: now() + 600000 });
        return redirect(res, `${config.publicUrl}/auth/start?ticket=${ticket}`);
      } else if (url.pathname === '/subscribe') {
        if (!config.accessToken) return respond(res, 400, '먼저 Instagram 로그인을 완료해 주세요.');
        try {
          const account = await profile(config.accessToken);
          const endpoint = `${GRAPH}/${account.id}/subscribed_apps`;
          const headers = { Authorization: `Bearer ${config.accessToken}` };
          const result = await api(endpoint, { method: 'POST', headers, body: new URLSearchParams({ subscribed_fields: 'messages' }) });
          if (result.success !== true) throw new Error('메시지 구독 실패');
          const check = await api(endpoint, { headers });
          // Unified Login currently returns subscribed_fields without an app id on this token-scoped edge.
          if (!check.data?.some(app => (app.id === undefined || app.id === APP_ID) && app.subscribed_fields?.includes('messages'))) throw new Error('구독 확인 실패');
          stats.subscription = 'messages 구독 확인 완료'; stats.lastError = null;
        } catch (error) { stats.subscription = '확인 필요'; stats.lastError = error.message; }
      } else return respond(res, 404, 'Not found');
      return redirect(res, '/');
    }
    if (req.method !== 'GET' || url.pathname !== '/') return respond(res, 404, 'Not found');
    const hidden = `<input type="hidden" name="csrf" value="${csrf}">`;
    return respond(res, 200, page(`<h1>디미 DM 테스트</h1>
      <p>Meta 앱: 2418018855613539 · Instagram: @dimi_in</p>
      <p>이 설정 화면은 이 PC에서만 접근할 수 있습니다. 시크릿과 토큰은 Windows DPAPI로 암호화해 저장합니다.</p>
      <h2>Meta에 등록할 주소</h2><p>로그인 콜백<br><code>${escape(callback())}</code></p>
      <p>웹훅 콜백<br><code>${escape(config.publicUrl)}/webhooks/instagram</code></p>
      <details><summary>웹훅 검증 토큰 보기 (Meta의 인증 토큰 칸에만 입력)</summary><code id="verify-token">${escape(config.verifyToken)}</code></details>
      <section><h2>1. 앱 설정</h2><p>Meta 앱 2418018855613539의 앱 설정 → 기본 설정에서 앱 시크릿을 복사해 입력하세요. 통합 로그인 구성: 2085773485459248. 저장된 시크릿은 빈칸으로 두면 유지됩니다.</p>
      <form method="post" action="/config">${hidden}
      <label>Meta 앱 시크릿<input name="appSecret" type="password" autocomplete="off"></label>
      <button>앱 설정 암호화 저장</button></form></section>
      <p>앱 시크릿: ${config.appSecret ? '암호화 저장됨' : '미설정'}</p><section><h2>2. Instagram 로그인</h2><p>통합 로그인 구성에서 요청하도록 설정한 권한: ${SCOPES.map(escape).join(', ')}. 승인 전 대상 계정과 실제 표시되는 권한을 확인하세요.</p>
      <form method="post" action="/login">${hidden}<button>Instagram에서 권한 승인하기</button></form>
      <form method="post" action="/cloud-login">${hidden}<button>운영 서버에서 Instagram 다시 연결하기</button></form>
      <p>접근 토큰: ${stats.tokenSaved ? '암호화 저장됨 (만료 시 다시 로그인)' : '미발급'}</p></section>
      <section><h2>3. 계정의 메시지 웹훅 구독</h2><p>Meta에서 웹훅을 등록하고 messages 필드 구독을 켠 뒤 실행하세요.</p>
      <form method="post" action="/subscribe">${hidden}<button>messages 구독하고 확인하기</button></form><p>${escape(stats.subscription)}</p></section>
      <section><h2>4. DM 수신 확인</h2><p>다른 테스트 계정에서 @dimi_in으로 DM을 보낸 뒤 <a href="/">수신 상태 새로고침</a>을 누르세요. Meta의 샘플 이벤트도 이 횟수에 포함되므로 실제 DM 테스트와 구분해서 확인하세요.</p>
      <p>이번 실행의 검증 요청: ${stats.verifications} · 서명 확인 이벤트: ${stats.signedEvents} · 수신 메시지: ${stats.messages}</p>
      <p>자동 답장: ${config.accessToken && config.userId === IG_ID ? '켜짐 — 안녕, 디미예요!' : '토큰 연결 필요'} · 전송 확인: ${stats.replies} · 실패/결과 미확인: ${stats.replyFailures}</p>
      <p>최근 이벤트: ${escape(stats.lastEventAt ? new Date(stats.lastEventAt).toLocaleString('ko-KR', { timeZone: 'Asia/Seoul' }) + ' (KST)' : '아직 없음')}</p><p>최근 오류: ${escape(stats.lastError || '없음')}</p>
      <p>새 DM에 ‘안녕, 디미예요!’로 답장합니다. 본문·발신자·토큰은 로그에 남기지 않으며, 중복 방지를 위한 메시지 ID의 해시만 보관합니다. 전송 실패나 결과 미확인 건은 자동 재전송하지 않습니다.</p></section>`), true);
  }));
  for (const server of [publicServer, adminServer]) { server.requestTimeout = 30000; server.headersTimeout = 15000; }
  return { publicServer, adminServer, stats };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    const local = join(root, '.local'); mkdirSync(local, { recursive: true });
    const secretFile = join(local, 'credentials.dpapi');
    const runtime = JSON.parse(readFileSync(join(local, 'runtime.json'), 'utf8'));
    const origin = new URL(runtime.publicUrl);
    if (origin.protocol !== 'https:' || origin.origin !== runtime.publicUrl) throw new Error('Invalid HTTPS origin');
    const config = { ...(readSecrets(secretFile) ?? { verifyToken: random() }), publicUrl: runtime.publicUrl };
    writeSecrets(secretFile, config);
    const replyFile = join(local, 'replies.jsonl');
    const servers = createServers({ config, persist: next => writeSecrets(secretFile, next),
      handledReplies: readReplyKeys(replyFile),
      replyRecord: entry => appendFileSync(replyFile, JSON.stringify(entry) + '\n'),
      record: receipt => appendFileSync(join(local, 'receipts.jsonl'), JSON.stringify(receipt) + '\n') });
    for (const [server, port] of [[servers.publicServer, 8787], [servers.adminServer, 8788]]) {
      server.on('error', () => { console.error('Server could not start. Check whether ports 8787/8788 are already in use.'); process.exit(1); });
      server.listen(port, '127.0.0.1');
    }
    writeFileSync(join(local, 'server.pid'), String(process.pid));
    console.log('Instagram test server ready. Local setup: http://127.0.0.1:8788');
  } catch { console.error('Startup failed. Check .local/runtime.json and Windows credential encryption.'); process.exitCode = 1; }
}
