// Instagram 없이 사례 묶음을 돌려 판단·근거·시간·오류를 표로 본다.
// 실행: node scripts/factcheck-eval.mjs cases.json [.env 경로]
// cases.json: [{ "name": "...", "text": "확인할 주장", "image": "captures/card.jpg", "caption": "게시물 캡션" }]
import { readFileSync } from 'node:fs';
import { resolve, extname } from 'node:path';
import { loadEnv } from './env.mjs';
import { factCheckerFromEnv } from '../factcheck.mjs';

const [casesFile, envFile = '.env'] = process.argv.slice(2);
const cases = JSON.parse(readFileSync(casesFile, 'utf8'));
const types = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const checker = factCheckerFromEnv(loadEnv(envFile), {
  fetchMedia: async url => ({ url, contentType: types[extname(url).toLowerCase()] ?? 'application/octet-stream', body: readFileSync(url.slice(7)) }) });
const rows = [];
for (const c of cases) {
  const attachments = c.image || c.caption ? [{ type: c.image ? 'ig_post' : 'share', payload: {
    ...(c.image ? { url: 'file://' + resolve(c.image) } : {}), ...(c.caption ? { title: c.caption } : {}) } }] : undefined;
  const started = Date.now();
  try {
    const r = await checker({ text: c.text, attachments });
    rows.push({ name: c.name, ms: Date.now() - started, status: r.status, verdict: r.verdict ?? '', cited: r.cited?.length ?? 0,
      evidence: r.gathered?.evidence ?? 0, error: '' });
    console.log(`\n=== ${c.name} (${Date.now() - started}ms)\n${r.messages.join('\n---\n')}`);
  } catch (error) { rows.push({ name: c.name, ms: Date.now() - started, status: 'error', verdict: '', cited: 0, evidence: 0, error: error.message }); }
}
console.table(rows);
const times = rows.map(r => r.ms).sort((a, b) => a - b);
console.log(`p50 ${times[Math.floor(times.length / 2)]}ms · max ${times.at(-1)}ms · 오류 ${rows.filter(r => r.status === 'error').length}/${rows.length}`);
