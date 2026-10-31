import { waitUntil } from '@vercel/functions';
import { createServers } from '../server.mjs';
import { createCloudState } from '../cloud-state.mjs';
import { handleCloudAuth, loadAccessToken } from '../cloud-auth.mjs';

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
    return res.end('Instagram 연결 처리가 완료되었습니다. 다른 계정에서 @inthon2team으로 새 DM을 보내 답장을 확인해 주세요.');
  }
  if (path.startsWith('/auth/')) return handleCloudAuth(req, res);
  publicHandler ??= createServers({
    config: { publicUrl: process.env.PUBLIC_URL, appSecret: process.env.META_APP_SECRET,
      webhookSecret: process.env.META_APP_SECRET, accessToken: process.env.META_ACCESS_TOKEN,
      verifyToken: process.env.META_VERIFY_TOKEN, userId: '17841414630453998' },
    persist: () => { throw new Error('Cloud credentials are managed in Vercel'); },
    ...createCloudState(), loadAccessToken, background: task => waitUntil(task),
  }).publicServer.listeners('request')[0];
  return publicHandler(req, res);
}
