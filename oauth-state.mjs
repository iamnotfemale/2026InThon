import { createHmac, timingSafeEqual, randomBytes } from 'node:crypto';

export function signState(value, secret) {
  const payload = Buffer.from(JSON.stringify(value)).toString('base64url');
  return payload + '.' + createHmac('sha256', secret).update(payload).digest('hex');
}

export function readState(value, secret, purpose, now = Date.now()) {
  if (typeof value !== 'string' || value.length > 4096) throw new Error('Invalid login state');
  const [payload, signature, extra] = value.split('.');
  const expected = createHmac('sha256', secret).update(payload || '').digest('hex');
  if (extra !== undefined || !/^[a-f0-9]{64}$/.test(signature || '')
    || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error('Invalid login state');
  const data = JSON.parse(Buffer.from(payload, 'base64url').toString());
  if (data.purpose !== purpose || !/^[a-f0-9]{64}$/.test(data.nonce || '')
    || !Number.isFinite(data.expires) || data.expires <= now || data.expires > now + 600000) throw new Error('Expired login state');
  return data;
}

export function createLoginTicket(secret, now = Date.now()) {
  return signState({ purpose: 'ticket', nonce: randomBytes(32).toString('hex'), expires: now + 600000 }, secret);
}
