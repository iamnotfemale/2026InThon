// 이 PC에서 ngrok으로 띄우는 팩트체크 DM 테스트 서버. 운영(Vercel)과 별개다.
// 실행: node scripts/factcheck-local.mjs [.env 경로]   → 포트 3000, 웹훅 경로 /webhook 또는 /webhooks/instagram
// .env: IG_ACCESS_TOKEN, CONTINUUM_API_KEY(또는 ANTHROPIC_AUTH_TOKEN), VERIFY_TOKEN, 선택 META_APP_SECRET·GEMINI_API_KEY
import http from 'node:http';
import { createHmac, timingSafeEqual } from 'node:crypto';
import { appendFileSync } from 'node:fs';
import { loadEnv } from './env.mjs';
import { factCheckerFromEnv } from '../factcheck.mjs';
import { FACTCHECK_ACK, FACTCHECK_FAILED, GRAPH, IG_ID } from '../server.mjs';

const env = loadEnv(process.argv[2] ?? '.env');
const PORT = Number(env.PORT || 3000);
const runs = 'factcheck-runs.jsonl';
const events = 'webhook-events.log';
const checker = factCheckerFromEnv(env);
if (!checker || !env.IG_ACCESS_TOKEN) throw new Error('.env에 CONTINUUM_API_KEY(또는 ANTHROPIC_AUTH_TOKEN)와 IG_ACCESS_TOKEN이 필요합니다.');
const handled = new Set();

async function send(recipient, text) {
  const response = await fetch(`${GRAPH}/${IG_ID}/messages`, { method: 'POST', signal: AbortSignal.timeout(15000),
    headers: { Authorization: `Bearer ${env.IG_ACCESS_TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipient }, message: { text } }) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok || !data.message_id) throw new Error(`DM 전송 실패 (HTTP ${response.status}, code ${Number(data.error?.code) || 0})`);
}

async function handle(m) {
  const started = Date.now(); const entry = { at: new Date().toISOString(), mid: m.message.mid.slice(-12),
    types: (m.message.attachments ?? []).map(a => a.type), hasText: Boolean(m.message.text) };
  try {
    await send(m.sender.id, FACTCHECK_ACK);
    entry.ackMs = Date.now() - started;
    let result;
    try { result = await checker(m.message); }
    catch (error) { result = { status: 'error', error: error.message, messages: [FACTCHECK_FAILED] }; }
    for (const text of result.messages) await send(m.sender.id, text);
    Object.assign(entry, { status: result.status, verdict: result.verdict, claim: result.extracted?.claim, cited: result.cited,
      gathered: result.gathered, notes: result.notes, error: result.error, timings: result.timings, replyMs: Date.now() - started });
  } catch (error) { Object.assign(entry, { status: 'send_failed', error: error.message, replyMs: Date.now() - started }); }
  appendFileSync(runs, JSON.stringify(entry) + '\n');
  console.log(`[run] ${entry.status} ${entry.verdict ?? ''} ${entry.replyMs}ms ${entry.error ?? ''}`);
}

const signed = (raw, signature) => {
  if (!env.META_APP_SECRET) return true;
  const expected = 'sha256=' + createHmac('sha256', env.META_APP_SECRET).update(raw).digest('hex');
  return typeof signature === 'string' && signature.length === expected.length && timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
};

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost');
  if (!['/webhook', '/webhooks/instagram'].includes(url.pathname)) { res.writeHead(404); return res.end(); }
  if (req.method === 'GET') {
    const ok = url.searchParams.get('hub.mode') === 'subscribe' && url.searchParams.get('hub.verify_token') === (env.VERIFY_TOKEN || 'inton-verify');
    res.writeHead(ok ? 200 : 403, { 'Content-Type': 'text/plain' });
    return res.end(ok ? url.searchParams.get('hub.challenge') : '');
  }
  const chunks = []; for await (const chunk of req) chunks.push(chunk);
  const raw = Buffer.concat(chunks);
  if (!signed(raw, req.headers['x-hub-signature-256'])) { res.writeHead(403); return res.end(); }
  appendFileSync(events, `${new Date().toISOString()} [event] ${raw}\n`); // 로컬 수신 구조 확인용. 커밋 금지.
  res.writeHead(200); res.end('EVENT_RECEIVED');
  let body; try { body = JSON.parse(raw); } catch { return; }
  for (const entry of body.entry ?? []) {
    for (const m of entry.messaging ?? []) {
      if (!m.message || m.message.is_echo || m.sender?.id === IG_ID || handled.has(m.message.mid)) continue;
      handled.add(m.message.mid);
      handle(m);
    }
  }
}).listen(PORT, () => console.log(`factcheck test server on :${PORT}${env.META_APP_SECRET ? '' : ' (서명 검사 꺼짐: META_APP_SECRET 미설정)'}`
  + `${env.GEMINI_API_KEY ? ', Gemini 영상 분석 켜짐' : ''}`));
