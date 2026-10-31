import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findPageToken, authResultText } from './cloud-auth.mjs';

const IG_ID = '17841414630453998';

test('the Page token is taken only from the Facebook Page connected to the bot account', async () => {
  const seen = [];
  const api = async (path, options) => {
    seen.push([path, options.headers.Authorization]);
    return { data: [{ id: '1', access_token: 'other-page', instagram_business_account: { id: '999' } },
      { id: '2', access_token: 'bot-page', instagram_business_account: { id: IG_ID } }] };
  };
  assert.deepEqual(await findPageToken(api, { Authorization: 'Bearer user' }), { pageAccessToken: 'bot-page', pageStatus: 'ok' });
  assert.deepEqual(seen, [['/me/accounts?fields=id,access_token,instagram_business_account&limit=100', 'Bearer user']]);
});

test('a missing Page token is reported with a reason and never throws', async () => {
  assert.deepEqual(await findPageToken(async () => ({ data: [] }), {}), { pageAccessToken: null, pageStatus: 'no-pages' });
  assert.deepEqual(await findPageToken(async () => ({ data: [{ id: '1', access_token: 'x', instagram_business_account: { id: '9' } }] }), {}),
    { pageAccessToken: null, pageStatus: 'other-pages' });
  assert.deepEqual(await findPageToken(async () => { throw new Error('Meta HTTP 400, code 200'); }, {}),
    { pageAccessToken: null, pageStatus: 'error-200' });
});

test('the login result page explains the Page token outcome without echoing arbitrary input', () => {
  assert.match(authResultText('ok'), /페이지 토큰을 확보했어요/);
  assert.match(authResultText('no-pages'), /pages_show_list/);
  assert.match(authResultText('other-pages'), /business_management/);
  assert.match(authResultText('error-200'), /오류 코드 200/);
  for (const text of [authResultText(null), authResultText('<script>'), authResultText('error-abc')]) {
    assert.match(text, /@dimi_in/); assert.doesNotMatch(text, /script|abc|페이지 토큰/);
  }
});
