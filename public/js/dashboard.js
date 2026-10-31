import { supabase, currentUser, signInWithGoogle, inAppBrowser, handle, show, setText } from './supabase.js';

const fail = message => { setText('error', message); show('error'); };

async function loadLink() {
  const { data, error } = await supabase.from('account_links')
    .select('igsid, linked_at, ig_accounts(username)').maybeSingle();
  if (error) return fail('연결 정보를 불러오지 못했어요. 새로고침해 주세요.');
  show('linked', Boolean(data)); show('unlinked', !data);
  if (data) {
    setText('handle', handle(data.ig_accounts?.username));
    setText('linked-at', new Date(data.linked_at).toLocaleString('ko-KR'));
  }
}

const user = await currentUser();
show('loading', false);
if (!user) {
  show('signed-out');
  show('inapp', inAppBrowser());
  document.getElementById('login').addEventListener('click', async () => {
    const { error } = await signInWithGoogle('/dashboard');
    if (error) fail('로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
  });
} else {
  show('signed-in');
  setText('email', user.email ?? '');
  await loadLink();

  document.getElementById('unlink').addEventListener('click', async event => {
    if (!confirm('Instagram 계정 연결을 해제할까요? 다시 연결하려면 봇에 "연결"을 보내면 돼요.')) return;
    event.target.disabled = true;
    const { error } = await supabase.from('account_links').delete().eq('user_id', user.id);
    event.target.disabled = false;
    if (error) return fail('연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.');
    await loadLink();
  });
  document.getElementById('logout').addEventListener('click', async () => {
    await supabase.auth.signOut();
    location.replace('/');
  });
}
