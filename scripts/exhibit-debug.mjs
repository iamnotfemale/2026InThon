// 전시 "일정 조회" 경로를 로컬에서 단계별로 보여주는 진단 스크립트. 운영과 같은 코드(contest.mjs → exhibit.mjs)를 쓴다.
// 1) python scripts/download-instagram-media.py <인스타 링크> <폴더>   (yt-dlp 필요)
// 2) node scripts/exhibit-debug.mjs <폴더> [.env 경로]   → <폴더>/exhibit-debug.json 에 단계별 기록
// .env: GEMINI_API_KEY (선택 GEMINI_MODEL). 키 값은 출력하지 않는다.
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, extname } from 'node:path';
import { loadEnv } from './env.mjs';
import { createGeminiModel, safeFetch } from '../factcheck.mjs';
import { createExhibitExtractor, createExhibitFiller, createGroundedSearch, fillQuestion } from '../exhibit.mjs';

const dir = process.argv[2];
if (!dir || !existsSync(join(dir, 'metadata.json'))) throw new Error('사용법: node scripts/exhibit-debug.mjs <download-instagram-media.py 결과 폴더> [.env]');
const env = loadEnv(process.argv[3] ?? '.env');
if (!env.GEMINI_API_KEY) throw new Error('.env에 GEMINI_API_KEY가 필요합니다.');

const meta = JSON.parse(readFileSync(join(dir, 'metadata.json'), 'utf8'));
const type = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.webp': 'image/webp', '.mp4': 'video/mp4' };
const files = meta.files.map(f => ({ ...f, mediaType: type[extname(f.file).toLowerCase()] }));
const input = {
  text: '', captions: meta.caption ? [meta.caption] : [], notes: [], transcripts: [],
  scope: [`캡션, 이미지 ${files.filter(f => f.kind === 'image').length}장, 영상 ${files.filter(f => f.kind === 'video').length}개`],
  images: files.filter(f => f.kind === 'image').slice(0, 10).map(f => ({ mediaType: f.mediaType, data: readFileSync(join(dir, f.file)).toString('base64') })),
  videos: files.filter(f => f.kind === 'video').slice(0, 1).map(f => ({ mediaType: 'video/mp4', data: readFileSync(join(dir, f.file)).toString('base64') })),
};

const log = { source: meta.source, scope: input.scope, steps: [] };
const started = Date.now();
const gemini = createGeminiModel({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined, timeout: 180000 });
const model = async args => {
  const t = Date.now();
  const step = args.system.includes('2단계 보충') ? 'fill' : args.system.includes('공모전·대외활동') ? 'classify' : 'extract';
  try {
    const text = await gemini(args);
    log.steps.push({ step, ms: Date.now() - t, gemini: (() => { try { return JSON.parse(text); } catch { return text; } })(),
      ...(step === 'fill' ? { prompt: args.content[0].text } : {}) });
    return text;
  } catch (error) { log.steps.push({ step, ms: Date.now() - t, error: error.message }); throw error; }
};
const grounded = createGroundedSearch({ apiKey: env.GEMINI_API_KEY, model: env.GEMINI_MODEL || undefined });
const search = async event => {
  const query = fillQuestion(event);
  try {
    const results = await grounded(event);
    log.steps.push({ step: 'search', query, results });
    return results;
  } catch (error) { log.steps.push({ step: 'search', query, error: error.message }); throw error; }
};
const fetchPage = async url => {
  try {
    const page = await safeFetch(url, { maxBytes: 3 * 1024 * 1024 });
    log.steps.push({ step: 'open', url, finalUrl: page.url, contentType: page.contentType, bytes: page.body.length });
    return page;
  } catch (error) { log.steps.push({ step: 'open', url, error: error.message }); throw error; }
};
const fill = createExhibitFiller({ model, search, fetchPage });
const loggedFill = async (exhibit, options) => {
  try { const stats = await fill(exhibit, options); log.steps.push({ step: 'fill-result', ...stats }); return stats; }
  catch (error) { log.steps.push({ step: 'fill-result', error: error.message }); throw error; }
};
// The 공모전 classification call is skipped: this script is for posts already known to be exhibitions.
const result = await createExhibitExtractor({ model, fill: loggedFill })(input).catch(error => ({ status: 'error', error: error.message }));
log.result = { status: result.status, error: result.error, exhibit: result.exhibit, messages: result.messages };
log.totalMs = Date.now() - started;
writeFileSync(join(dir, 'exhibit-debug.json'), JSON.stringify(log, null, 2));
console.log(JSON.stringify({ status: result.status, totalMs: log.totalMs, steps: log.steps.map(s => [s.step, s.ms ?? '', s.query ?? s.url ?? '', s.error ?? ''].join(' ')) }, null, 2));
