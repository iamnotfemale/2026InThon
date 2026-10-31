import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createLoginTicket, readState, signState } from './oauth-state.mjs';
import { sealToken, openToken } from './cloud-auth.mjs';

test('cloud login tickets reject tampering, expiry, wrong purpose and wrong secrets', () => {
  const now = 1000000; const secret = 'test-secret';
  const ticket = createLoginTicket(secret, now);
  assert.equal(readState(ticket, secret, 'ticket', now).purpose, 'ticket');
  assert.throws(() => readState(ticket, secret, 'state', now));
  assert.throws(() => readState(ticket, 'different', 'ticket', now));
  assert.throws(() => readState(ticket, secret, 'ticket', now + 600000));
  assert.throws(() => readState(ticket.slice(0, -1) + (ticket.endsWith('0') ? '1' : '0'), secret, 'ticket', now));
  assert.throws(() => readState(signState({ purpose: 'ticket', nonce: '../bad', expires: now + 1 }, secret), secret, 'ticket', now));
});

test('cloud token encryption authenticates ciphertext and its key', () => {
  const value = { accessToken: 'dummy-private-token', userId: 'test-account' };
  const sealed = sealToken(value, 'test-secret');
  assert.deepEqual(openToken(sealed, 'test-secret'), value);
  assert.doesNotMatch(JSON.stringify(sealed), /dummy-private-token|test-account/);
  assert.throws(() => openToken(sealed, 'wrong-secret'));
  const bytes = Buffer.from(sealed.data, 'base64'); bytes[0] ^= 1;
  assert.throws(() => openToken({ ...sealed, data: bytes.toString('base64') }, 'test-secret'));
});
