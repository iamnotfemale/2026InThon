import { supabase, currentUser, signInWithGoogle, inAppBrowser, handle, show, setText } from './supabase.js';

// The bot sends /link#token=<64 hex>. The fragment never reaches servers or Referer headers.
const KEY = 'inthon-link-token';
const fail = message => { show('loading', false); setText('error', message); show('failed'); };
const fromUrl = new URLSearchParams(location.hash.slice(1)).get('token');

if (inAppBrowser()) {
  // Keep the token in the URL so "open in external browser" carries it over.
  show('loading', false); show('inapp');
  document.getElementById('copy').addEventListener('click', async () => {
    try { await navigator.clipboard.writeText(location.href); show('copied'); }
    catch { prompt('아래 링크를 복사해 주세요.', location.href); }
  });
} else {
  if (fromUrl) {
    // Survives the Google round trip in this tab; removed from the address bar right away.
    sessionStorage.setItem(KEY, fromUrl);
    history.replaceState(null, '', location.pathname);
  }
  const token = sessionStorage.getItem(KEY);
  const user = await currentUser();
  if (!token || !/^[a-f0-9]{64}$/.test(token)) {
    fail('연결 링크가 올바르지 않아요.');
  } else if (!user) {
    show('loading', false); show('need-login');
    document.getElementById('login').addEventListener('click', async () => {
      const { error } = await signInWithGoogle('/link');
      if (error) fail('로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
    });
  } else {
    const { data, error } = await supabase.rpc('link_instagram', { p_token: token });
    sessionStorage.removeItem(KEY);
    if (error) {
      fail(/invalid_or_expired_token|invalid_token/.test(error.message)
        ? '링크가 만료됐거나 이미 사용됐어요.' : '연결하지 못했어요. 잠시 후 다시 시도해 주세요.');
    } else {
      show('loading', false);
      setText('handle', handle(data?.[0]?.username));
      show('done');
    }
  }
}
