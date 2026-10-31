import { isInAppBrowser, safeLoginNext, browserLoginUrl, chromeIntent } from './browser-auth.js';

const next = safeLoginNext(new URLSearchParams(location.search).get('next'), location.origin);
const target = browserLoginUrl(next, location.origin);
const show = (id, visible = true) => { document.getElementById(id).hidden = !visible; };
async function login() {
  show('login-error', false); show('retry-login', false);
  if (isInAppBrowser()) {
    show('login-progress', false); show('browser-handoff');
    if (/Android/i.test(navigator.userAgent)) {
      document.getElementById('open-chrome').href = chromeIntent(target, location.origin); show('open-chrome');
      document.getElementById('browser-steps').textContent = '열리지 않으면 ⋯ 메뉴에서 외부 브라우저로 열거나, 아래 링크를 복사해 Chrome에 붙여 넣어 주세요.';
    }
    return;
  }
  try {
    localStorage.setItem('inthon-dashboard-mode', JSON.stringify('live'));
    const auth = await import('./supabase.js');
    if (await auth.currentUser()) return location.replace(next);
    const { error } = await auth.signInWithGoogle(next);
    if (error) throw error;
  } catch {
    show('login-progress', false); show('login-error'); show('retry-login');
    document.getElementById('login-error').textContent = '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.';
  }
}
document.getElementById('copy-login').addEventListener('click', async () => {
  try { await navigator.clipboard.writeText(target); document.getElementById('copy-status').textContent = '복사했어요. Chrome이나 Safari 주소창에 붙여 넣어 주세요.'; }
  catch { const input = document.getElementById('login-url'); input.value = target; input.hidden = false; input.focus(); input.select(); document.getElementById('copy-status').textContent = '아래 주소를 길게 눌러 복사해 주세요.'; }
});
document.getElementById('retry-login').addEventListener('click', login);
await login();
