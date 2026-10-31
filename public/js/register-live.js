// Real sign-in and server-verified Instagram linking for the supplied signup chat.
import { createRegistrationServices } from './registration.js';

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

// Keep auth loading lazy so the chat can render while the SDK is loading.
export function withGoogleSignup(RegisterModel, loadAuth, fetchImpl = fetch) {
  return class RegisterApp extends RegisterModel {
    constructor(props) {
      super({ ...props, services: createRegistrationServices({ loadAuth, fetchImpl }) });
    }
  };
}
