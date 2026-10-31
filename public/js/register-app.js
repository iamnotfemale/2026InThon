import { h, render } from './vendor/preact.module.js';
import RegisterModel from './register-model.js';
import { withGoogleSignup } from './register-live.js';

// Supabase loads lazily so the signup chat still renders if the CDN is slow or unreachable.
const RegisterApp = withGoogleSignup(RegisterModel, () => import('./supabase.js'));

const response = await fetch('/data/register-template.json');
if (!response.ok) throw new Error('Registration template unavailable');
render(h(RegisterApp, { template: await response.json() }), document.getElementById('app'));
