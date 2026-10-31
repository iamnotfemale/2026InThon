import { waitUntil } from '@vercel/functions';
import { createServers } from '../server.mjs';
import { createCloudState } from '../cloud-state.mjs';
import { createSupabaseState } from '../supabase-state.mjs';

// Supabase is used once both variables are set; until then the existing Blob store keeps working.
const useSupabase = () => Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SECRET_KEY);
const stateStore = () => useSupabase()
  ? createSupabaseState({ url: process.env.SUPABASE_URL, key: process.env.SUPABASE_SECRET_KEY })
  : createCloudState();

let publicHandler;
export default function handler(req, res) {
  const path = new URL(req.url, 'https://localhost').pathname;
  res.setHeader('Cache-Control', 'no-store');
  if (!['/health', '/webhooks/instagram'].includes(path)) {
    res.statusCode = 404;
    return res.end('Not found');
  }
  if (!process.env.META_APP_SECRET || !process.env.META_ACCESS_TOKEN
    || !process.env.META_VERIFY_TOKEN || !(useSupabase() || process.env.BLOB_READ_WRITE_TOKEN)) {
    res.statusCode = 503;
    return res.end('Server configuration is incomplete');
  }
  publicHandler ??= createServers({
    config: { publicUrl: process.env.PUBLIC_URL, appSecret: process.env.META_APP_SECRET,
      webhookSecret: process.env.META_APP_SECRET, accessToken: process.env.META_ACCESS_TOKEN,
      verifyToken: process.env.META_VERIFY_TOKEN, userId: '17841414630453998' },
    persist: () => { throw new Error('Cloud credentials are managed in Vercel'); },
    ...stateStore(), background: task => waitUntil(task),
  }).publicServer.listeners('request')[0];
  return publicHandler(req, res);
}
