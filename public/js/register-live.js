// Real Google sign-in for the supplied signup chat (/register). The design's RegisterModel stays untouched:
// this subclass replaces only its simulated Google step and saves the profile answers to the Supabase user.
import { displayName } from './dashboard-live.js';

export const DASHBOARD_MODE_KEY = 'inthon-dashboard-mode';
/** Make /dashboard open on the signed-in user's real data rather than a demo scenario. */
export function preferLiveDashboard(storage = globalThis.localStorage) {
  try { storage?.setItem(DASHBOARD_MODE_KEY, JSON.stringify('live')); } catch {}
}

/**
 * Landing "로그인": signed-in visitors go straight to their dashboard; others sign in with Google first.
 * Inside app webviews (Google blocks sign-in there) or if auth cannot load, the dashboard explains what to do.
 */
export async function loginThenDashboard(loadAuth, location) {
  preferLiveDashboard();
  try {
    const auth = await loadAuth();
    if (!(await auth.currentUser()) && !auth.inAppBrowser()) {
      const { error } = await auth.signInWithGoogle('/dashboard');
      if (!error) return;
    }
  } catch {}
  location.assign('/dashboard');
}

const INTRO = ['안녕하세요! 보낸 콘텐츠를 대신 정리해 드리는 디미예요.', '가입은 세 단계면 끝나요. 먼저 Google 계정으로 로그인해 주세요.'];

/**
 * `loadAuth` resolves to the browser auth helpers in supabase.js
 * ({ currentUser, signInWithGoogle, inAppBrowser, supabase }); injected so tests can run without a browser.
 */
export function withGoogleSignup(RegisterModel, loadAuth) {
  return class RegisterApp extends RegisterModel {
    componentDidMount() {
      // Returning from Google (or already signed in): continue the chat from the name step.
      loadAuth()
        .then(auth => { this.auth = auth; return auth.currentUser(); })
        .then(user => (user ? this.resume(user) : super.componentDidMount()))
        .catch(() => super.componentDidMount());
    }

    start() {
      if (this.user) this.resume(this.user);
      else super.start();
    }

    resume(user) {
      this.user = user;
      this._timers.forEach(t => clearTimeout(t)); this._timers = [];
      const intro = INTRO.map((text, i) => ({ id: i + 1, from: 'bot', text }));
      const me = { id: 3, from: 'me', text: 'Google 계정으로 로그인했어요 · ' + (user.email ?? '') };
      this.setState({ msgs: intro.concat([me]), seq: 3, typing: false, step: 'wait', name: '', age: '', nameDraft: '',
        ageDraft: '', ageError: false, cheer: false });
      // Offer the Google profile name; the person can edit it before submitting.
      this.botSay(['로그인 완료! 반가워요.', '뭐라고 불러드리면 될까요?'], { step: 'name', nameDraft: displayName(user) });
    }

    async googleLogin() {
      if (this.state.step !== 'google') return;
      const auth = this.auth ?? await loadAuth().catch(() => null);
      if (!auth) return this.botSay(['로그인 기능을 불러오지 못했어요. 새로고침한 뒤 다시 시도해 주세요.'], { step: 'google' });
      if (auth.inAppBrowser()) {
        return this.botSay(['Instagram 앱 안에서는 Google 로그인이 막혀 있어요.',
          '오른쪽 위 ⋯ 메뉴에서 외부 브라우저로 연 뒤 다시 눌러 주세요.'], { step: 'google' });
      }
      this.setState({ step: 'googleBusy' });
      // Leaves the page; Google returns to /register and componentDidMount resumes from the name step.
      const { error } = await auth.signInWithGoogle('/register');
      if (error) this.botSay(['로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.'], { step: 'google' });
    }

    finish() {
      // Name (and age, if given) go to the Supabase user profile; the dashboard reads display_name from there.
      const data = { display_name: this.state.name, ...(this.state.age ? { age: Number(this.state.age) } : {}) };
      this.saved = this.auth?.supabase.auth.updateUser({ data })
        .then(({ error }) => { if (error) throw error; })
        .catch(() => this.push('bot', '프로필을 저장하지 못했어요. 대시보드 설정에서 이름을 다시 저장해 주세요.'));
      preferLiveDashboard();
      super.finish();
    }
  };
}
