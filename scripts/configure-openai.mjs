import http from 'node:http';
import { randomBytes } from 'node:crypto';
import { mkdirSync, writeFileSync } from 'node:fs';
import { writeSecrets } from '../secrets.mjs';

const origin = 'http://127.0.0.1:8793';
const nonce = randomBytes(24).toString('hex');
const path = '/openai/' + nonce;
mkdirSync('.local', { recursive: true });
const server = http.createServer(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Content-Security-Policy', "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'");
  if (req.headers.host !== '127.0.0.1:8793' || req.url !== path) { res.statusCode = 404; return res.end('Not found'); }
  if (req.method === 'GET') return res.end(`<!doctype html><html lang="ko"><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>디미 OpenAI 연결</title><style>body{font:17px/1.7 system-ui;max-width:600px;margin:60px auto;padding:24px}input{box-sizing:border-box;width:100%;padding:14px;font:inherit;margin:12px 0}button{padding:12px 24px;font:inherit}</style><h1>OpenAI API 키 연결</h1><p>키는 이 PC에서 암호화해 저장해요. 채팅이나 GitHub에 보내지 마세요.</p><p><a href="https://platform.openai.com/api-keys" target="_blank" rel="noreferrer">OpenAI에서 프로젝트 API 키 만들기</a></p><form method="post"><input type="hidden" name="csrf" value="${nonce}"><label for="key">OpenAI API 키</label><input id="key" name="key" type="password" autocomplete="off" required><button>암호화 저장</button></form></html>`);
  if (req.method !== 'POST' || req.headers.origin !== origin) { res.statusCode = 403; return res.end('Forbidden'); }
  try {
    let raw = ''; for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 4096) throw new Error(); }
    const form = new URLSearchParams(raw); const key = form.get('key')?.trim();
    if (form.get('csrf') !== nonce || !/^sk-[A-Za-z0-9_-]{20,500}$/.test(key ?? '')) throw new Error();
    writeSecrets('.local/openai-credentials.dpapi', { apiKey: key });
    res.end('<p>암호화 저장했어요. 이 화면을 닫고 작업으로 돌아가 주세요.</p>');
  } catch { res.statusCode = 400; res.end('저장하지 못했어요. 키와 입력 화면을 확인해 주세요.'); }
});
server.listen(8793, '127.0.0.1', () => {
  writeFileSync('.local/openai-setup-url.txt', origin + path);
  console.log(origin + path);
});
