import { waitUntil } from '@vercel/functions';
import { createServers } from '../server.mjs';
import { createCloudState } from '../cloud-state.mjs';
import { createSupabaseState } from '../supabase-state.mjs';
import { handleCloudAuth, loadAccessToken, loadProfileToken, authResultText } from '../cloud-auth.mjs';
import { factCheckerFromEnv } from '../factcheck.mjs';
import { mediaProbeFromEnv } from '../media-probe.mjs';
import { mediaFactCheckerFromEnv } from '../media-pipeline.mjs';
import { dmAssistantFromEnv } from '../dm-assistant.mjs';
import { createInstagramLink, createSenderHandleLookup } from '../instagram-link.mjs';
import { createResultPreferences } from '../result-preferences.mjs';
import { createOpenAIDecisions } from '../openai-decisions.mjs';

// DM receipts and reply reservations go to Supabase once both variables are set; until then Blob keeps working.
// Blob stays required either way: cloud OAuth tickets and the renewed access token are stored there.
const useSupabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const stateStore = () => useSupabase()
  ? createSupabaseState({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY,
    embedIndex: createOpenAIDecisions({ apiKey: process.env.OPENAI_API_KEY })?.embed })
  : createCloudState();

let publicHandler;
export default function handler(req, res) {
  const path = new URL(req.url, 'https://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (!['/health', '/webhooks/instagram', '/auth/start', '/auth/instagram/callback', '/auth/result'].includes(path)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  if (!process.env.META_APP_SECRET || !process.env.META_ACCESS_TOKEN
    || !process.env.META_VERIFY_TOKEN || !process.env.BLOB_READ_WRITE_TOKEN) {
    res.statusCode = 503;
    return res.end('Server configuration is incomplete');
  }
  if (path === '/auth/result') {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.end(authResultText(new URL(req.url, 'https://localhost').searchParams.get('page')));
  }
  if (path.startsWith('/auth/')) return handleCloudAuth(req, res);
  const state = stateStore();
  publicHandler ??= createServers({
    config: { publicUrl: process.env.PUBLIC_URL, appSecret: process.env.META_APP_SECRET,
      webhookSecret: process.env.META_APP_SECRET, accessToken: process.env.META_ACCESS_TOKEN,
      verifyToken: process.env.META_VERIFY_TOKEN, userId: '17841414630453998' },
    persist: () => { throw new Error('Cloud credentials are managed in Vercel'); },
    // Gemini 일반 대화와 콘텐츠 처리를 분기하며, Continuum-only 구성도 유지한다.
    ...state, loadAccessToken, loadProfileToken, background: task => waitUntil(task),
    getDeliveryMode: async sender => {
      const uid = await state.linkedUser?.(sender);
      return uid ? createResultPreferences({ secret: process.env.META_APP_SECRET }).delivery(uid) : 'summary';
    },
    verifyInstagramCode: state.issueLinkToken ? (code, sender) => createInstagramLink({
      secret: process.env.META_APP_SECRET, issueLinkToken: state.issueLinkToken,
    }).verify(code, sender, createSenderHandleLookup({ loadAccessToken, loadProfileToken })) : undefined,
    respondToMessage: dmAssistantFromEnv({ loadAccessToken }),
    factCheck: process.env.GEMINI_API_KEY ? undefined : mediaFactCheckerFromEnv(factCheckerFromEnv(), { loadAccessToken }),
    observeMessages: mediaProbeFromEnv(),
  }).publicServer.listeners('request')[0];
  return publicHandler(req, res);
}
