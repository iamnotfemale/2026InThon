import { createHash } from 'node:crypto';
import { put, get } from '@vercel/blob';
import { sealToken, openToken } from './cloud-auth.mjs';
import { IG_ID } from './server.mjs';

const hash = value => createHash('sha256').update(value).digest('hex');

// Opt-in diagnostic only: one sender, explicit DM code, and a fixed short expiry.
export function createMediaProbe({ code, until, secret, now = Date.now, putBlob = put, getBlob = get } = {}) {
  const expires = Date.parse(until);
  if (!/^[A-Z0-9]{8}$/.test(code || '') || !secret || !Number.isFinite(expires)
    || expires <= now() || expires - now() > 30 * 60000) return undefined;
  const prefix = `dm/media-probes/${code}/`;
  const read = async path => {
    const result = await getBlob(path, { access: 'private', useCache: false });
    if (!result?.stream) return null;
    return openToken(await new Response(result.stream).json(), secret);
  };
  const save = async (path, value) => {
    try {
      await putBlob(path, JSON.stringify(sealToken(value, secret)), {
        access: 'private', allowOverwrite: false, addRandomSuffix: false, contentType: 'application/json',
      });
    } catch (error) {
      if (!await read(path)) throw error;
    }
  };
  return async deliveries => {
    if (now() >= expires) return;
    for (const { accountId, event: m } of deliveries) {
      const msg = m?.message; const age = now() - Number(m?.timestamp);
      if (accountId !== IG_ID || m?.recipient?.id !== IG_ID || m?.sender?.id === IG_ID
        || !/^\d+$/.test(m?.sender?.id || '') || !msg?.mid || typeof msg.mid !== 'string'
        || msg.is_echo || msg.is_self || msg.is_deleted || !Number.isFinite(age) || age < -300000 || age > 300000) continue;
      const senderHash = hash(m.sender.id);
      if (msg.text === `/media-test ${code}`) {
        await save(prefix + 'sender.json', { senderHash, expires });
        continue;
      }
      if (!Array.isArray(msg.attachments) || !msg.attachments.length) continue;
      const sender = await read(prefix + 'sender.json');
      if (!sender || sender.senderHash !== senderHash || now() >= sender.expires) continue;
      await save(prefix + hash(msg.mid) + '.json', {
        receivedAt: new Date(now()).toISOString(), timestamp: m.timestamp,
        eventKeys: Object.keys(m), messageKeys: Object.keys(msg), messageId: msg.mid,
        textPresent: typeof msg.text === 'string', textLength: typeof msg.text === 'string' ? msg.text.length : 0,
        attachments: msg.attachments,
      });
    }
  };
}

export const mediaProbeFromEnv = (env = process.env) => createMediaProbe({
  code: env.MEDIA_PROBE_CODE, until: env.MEDIA_PROBE_UNTIL, secret: env.META_APP_SECRET,
});
