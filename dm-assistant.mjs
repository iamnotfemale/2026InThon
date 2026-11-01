import { DIMI_SYSTEM as SYSTEM, dimiChatModelFromEnv } from './dimi-persona.mjs';
import { createHash } from 'node:crypto';
import { get, put, del } from '@vercel/blob';
import { sealToken, openToken } from './cloud-auth.mjs';
import { factCheckerFromEnv, splitBytes } from './factcheck.mjs';
import { mediaFactCheckerFromEnv } from './media-pipeline.mjs';
import { isContentMessage } from './instagram-source.mjs';
import { createContentChoices } from './content-choices.mjs';
import { recipeProcessorFromEnv } from './recipe.mjs';
import { contestProcessorFromEnv } from './contest.mjs';
import { restaurantProcessorFromEnv } from './restaurant.mjs';
import { spaceProcessorFromEnv } from './space.mjs';
import { beautyProcessorFromEnv } from './beauty.mjs';
import { storedContent } from './public/js/content-index.js';
import { rowItems } from './public/js/dashboard-live.js';
import { placesFromRows } from './public/js/restaurant-data.js';
import { resultUrl } from './result-preferences.mjs';

const TTL = 30 * 60000;
const MAX_MESSAGES = 12;
const RESET = new Set(['대화 초기화', '/초기화', '새 대화']);

export function createChatHistory({ secret, getBlob = get, putBlob = put, deleteBlob = del, now = Date.now }) {
  const path = sender => {
    if (!/^\d{1,32}$/.test(sender ?? '')) throw new Error('Invalid chat sender');
    return `dm/chat/${createHash('sha256').update('inthon-chat:' + sender).digest('hex')}.json`;
  };
  return {
    async read(sender) {
      const key = path(sender);
      const result = await getBlob(key, { access: 'private', useCache: false });
      if (!result?.stream) return [];
      const stored = openToken(await new Response(result.stream).json(), secret);
      if (!Number.isFinite(stored.expires)) throw new Error('Invalid chat expiry');
      if (stored.expires <= now()) { await deleteBlob(key); return []; }
      if (!Array.isArray(stored.messages) || stored.messages.length > MAX_MESSAGES || stored.messages.some(m =>
        !['user', 'model'].includes(m.role) || m.parts?.length !== 1 || typeof m.parts[0].text !== 'string' || m.parts[0].text.length > 4000)) {
        throw new Error('Invalid chat history');
      }
      return stored.messages;
    },
    async write(sender, messages) {
      // shortcut: simultaneous DMs across server instances can race; add a per-sender queue for sustained traffic.
      await putBlob(path(sender), JSON.stringify(sealToken({ expires: now() + TTL, messages: messages.slice(-MAX_MESSAGES) }, secret)),
        { access: 'private', contentType: 'application/json', addRandomSuffix: false, allowOverwrite: true });
    },
    async clear(sender) { await deleteBlob(path(sender)); },
  };
}

export function savedContentContext(rows, publicUrl) {
  return rows.slice(0, 3).flatMap(row => {
    if (!Number.isSafeInteger(row.id) || row.id <= 0 || row.status !== 'done') return [];
    const items = rowItems(row);
    if (!items.length) return [];
    const stored = storedContent(row);
    const { recipe, contest, exhibit, space, beauty } = stored;
    const url = publicUrl ? resultUrl(publicUrl, row.id) : null;
    return [{ title: row.claim, type: row.topic, created_at: row.created_at, result_url: url, source_url: stored.sourceUrl ?? null,
      items: items.map(item => ({ title: item.title, result_url: url ? url.replace(/fc\d+$/, item.id) : null })),
      analysis: { recipe, contest, exhibit, space, beauty, ...(row.topic === 'restaurant' ? { restaurants: placesFromRows(row.restaurants) } : {}),
        reason: typeof stored.reason === 'string' ? stored.reason : Object.keys(stored).length ? undefined : row.reason,
        verdict: row.verdict, sources: row.sources } }];
  });
}

export function createDmAssistant({ model, processContent, history, choices, recentResults, publicUrl,
  warn = () => console.warn('Chat context unavailable') }) {
  return async (message, { senderId, acknowledge = async () => {}, defer = task => task() } = {}) => {
    // Quick replies carry the original content ticket, not a request for ordinary chat.
    let result;
    if (message.quick_reply) {
      result = await choices.select(message, senderId, processContent, acknowledge);
      if (result.kind !== 'content') return result;
    } else if (isContentMessage(message)) return choices.offer(message, senderId);
    let previous = [];
    const text = typeof message.text === 'string' ? message.text.trim().slice(0, 4000) : '';
    if (!result && RESET.has(text)) {
      try { await history.clear(senderId); }
      catch { return { kind: 'chat', status: 'failed', messages: ['대화 기록을 지우지 못했어요. 잠시 후 다시 “대화 초기화”라고 보내주세요.'] }; }
      return { kind: 'chat', status: 'done', messages: ['대화 맥락을 초기화했어요. 새로 이야기해 주세요.'] };
    }
    if (!result) {
      if (!text) return { kind: 'chat', status: 'no_input', messages: ['질문을 적거나 릴스·게시물을 공유해 주세요.'] };
      const [messages, saved] = await Promise.all([
        history.read(senderId).catch(() => { warn(); return []; }),
        recentResults ? recentResults(senderId).then(rows => savedContentContext(rows, publicUrl)).catch(() => { warn(); return []; }) : [],
      ]);
      previous = messages;
      const content = [...(saved.length ? [{ type: 'text', text: '<saved_content>\n' + JSON.stringify(saved) + '\n</saved_content>' }] : []),
        { type: 'text', text }];
      const reply = await model({ system: SYSTEM, content, history: previous,
        json: false, maxTokens: 1200, signal: AbortSignal.timeout(60000) });
      result = { kind: 'chat', status: 'done', messages: splitBytes(reply.slice(0, 4000)) };
    }
    const summary = result.messages.join('\n').slice(0, 4000);
    const turn = [
      { role: 'user', parts: [{ text: text || '[릴스·게시물·이미지 공유]' }] },
      { role: 'model', parts: [{ text: summary }] },
    ];
    await defer(async () => {
      try {
        // Content analysis does not need chat history; read it only when appending after the reply.
        if (result.kind === 'content') previous = await history.read(senderId);
        await history.write(senderId, [...previous, ...turn]);
      } catch { warn(); }
    });
    return result;
  };
}

export function dmAssistantFromEnv({ loadAccessToken, recentResults, env = process.env } = {}) {
  if (!env.GEMINI_API_KEY) return undefined;
  const factcheck = mediaFactCheckerFromEnv(factCheckerFromEnv(env), { loadAccessToken, env });
  const recipe = mediaFactCheckerFromEnv(recipeProcessorFromEnv(env), { loadAccessToken, env });
  const contest = mediaFactCheckerFromEnv(contestProcessorFromEnv(env), { loadAccessToken, env });
  const restaurant = mediaFactCheckerFromEnv(restaurantProcessorFromEnv(env), { loadAccessToken, env });
  const space = mediaFactCheckerFromEnv(spaceProcessorFromEnv(env), { loadAccessToken, env });
  const beauty = mediaFactCheckerFromEnv(beautyProcessorFromEnv(env), { loadAccessToken, env });
  return createDmAssistant({ model: dimiChatModelFromEnv(env),
    processContent: (message, action) => (action === 'recipe' ? recipe : action === 'schedule' ? contest : action === 'restaurant' ? restaurant : action === 'space' ? space : action === 'beauty' ? beauty : factcheck)(message),
    history: createChatHistory({ secret: env.META_APP_SECRET }),
    recentResults, publicUrl: env.PUBLIC_URL,
    choices: createContentChoices({ secret: env.META_APP_SECRET }) });
}
