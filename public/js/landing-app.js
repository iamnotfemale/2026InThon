import { h, render } from './vendor/preact.module.js';
import LandingModel from './landing-model.js';
import { loginThenDashboard } from './register-live.js';
import { mountLandingMotion } from './landing-motion.js';

const response = await fetch('/data/landing-template.json');
if (!response.ok) throw new Error('Landing template unavailable');
render(h(LandingModel, { template: await response.json() }), document.getElementById('app'));
let stopMotion = mountLandingMotion(document.querySelector('.lp'));
addEventListener('pagehide', () => stopMotion());
addEventListener('pageshow', event => {
  if (event.persisted) stopMotion = mountLandingMotion(document.querySelector('.lp'));
});

// The design's "로그인" link points at /dashboard: sign in with Google first, then open the real-data dashboard.
document.addEventListener('click', event => {
  const link = event.target.closest?.('a[href="/dashboard"]');
  if (!link || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey) return;
  event.preventDefault();
  loginThenDashboard(() => import('./supabase.js'), location);
});
