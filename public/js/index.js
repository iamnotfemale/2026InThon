import { currentUser, signInWithGoogle, inAppBrowser, show, setText } from './supabase.js';

const user = await currentUser();
if (user) show('dashboard');
else {
  show('login');
  show('inapp', inAppBrowser());
  document.getElementById('login').addEventListener('click', async () => {
    const { error } = await signInWithGoogle('/dashboard');
    if (error) { setText('error', '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.'); show('error'); }
  });
}
