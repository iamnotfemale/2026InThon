// Browser Supabase client. The publishable key is meant to be public: RLS decides what each signed-in user can read.
import { createClient } from 'https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2/+esm';

import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './supabase-config.js';

export const supabase = createClient(SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY, {
  auth: { flowType: 'pkce', detectSessionInUrl: true, persistSession: true },
});

export const signInWithGoogle = next => supabase.auth.signInWithOAuth({
  provider: 'google', options: { redirectTo: location.origin + next },
});

export async function currentUser() {
  const { data } = await supabase.auth.getSession();
  return data.session?.user ?? null;
}

// Google blocks sign-in inside app webviews (Instagram, Facebook, KakaoTalk...): ask for a real browser first.
export const inAppBrowser = () => /Instagram|FBAN|FBAV|KAKAOTALK|Line\//i.test(navigator.userAgent);

export const handle = username => (username ? '@' + username : 'Instagram 계정 (아이디 확인 전)');

export function show(id, visible = true) { document.getElementById(id).hidden = !visible; }
export function setText(id, text) { document.getElementById(id).textContent = text; }
