export function createRegistrationServices({ supabase, fetchImpl = fetch, origin = location.origin }) {
  const request = async body => {
    const { data } = await supabase.auth.getSession();
    if (!data.session?.access_token) throw new Error('Google로 다시 로그인해 주세요.');
    const response = await fetchImpl(origin + '/api/instagram-link', { method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + data.session.access_token },
      body: JSON.stringify(body) });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || '연결을 확인하지 못했어요. 다시 시도해 주세요.');
    return result;
  };
  return {
    async user() { const { data, error } = await supabase.auth.getUser(); if (error) return null; return data.user; },
    async login() {
      if (/Instagram|FBAN|FBAV|KAKAOTALK|Line\//i.test(navigator.userAgent)) throw new Error('외부 브라우저에서 Google 로그인을 진행해 주세요.');
      const { error } = await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: origin + '/register' } });
      if (error) throw new Error('Google 로그인을 시작하지 못했어요. 다시 시도해 주세요.');
    },
    issue: username => request({ action: 'issue', username }),
    status: () => request({ action: 'status' }),
    async profile(name, age) {
      const { error } = await supabase.auth.updateUser({ data: { display_name: name, age: age ? Number(age) : null } });
      if (error) throw new Error('가입 정보를 저장하지 못했어요. 다시 시도해 주세요.');
    },
    async copy(code) { await navigator.clipboard.writeText(code); },
  };
}
