export const isInAppBrowser = (ua = navigator.userAgent) => /Instagram|FBAN|FBAV|KAKAOTALK|Line\//i.test(ua);

export function safeLoginNext(value, origin) {
  try {
    const url = new URL(typeof value === 'string' ? value : '/dashboard', origin);
    if (url.origin === origin && /^(\/(dashboard|home|chat|register|library|taste|calendar|map|settings|link)|\/items\/fc[1-9]\d*(?:-\d+)?)\/?$/.test(url.pathname)) return url.pathname;
  } catch {}
  return '/dashboard';
}

export const browserLoginUrl = (next, origin) => origin + '/login?next=' + encodeURIComponent(safeLoginNext(next, origin));

export function startGoogleLogin(next, { location, oauth, ua = navigator.userAgent }) {
  if (isInAppBrowser(ua)) { location.assign(browserLoginUrl(next, location.origin)); return Promise.resolve({ error: null }); }
  return oauth({ provider: 'google', options: { redirectTo: location.origin + safeLoginNext(next, location.origin) } });
}

export function chromeIntent(url, origin) {
  const target = new URL(url, origin);
  if (target.origin !== origin || target.protocol !== 'https:' || target.hash) throw new Error('Invalid browser destination');
  // Only a user-clicked link launches Chrome. The fallback keeps the same safe destination.
  return `intent://${target.host}${target.pathname}${target.search}#Intent;scheme=https;package=com.android.chrome;S.browser_fallback_url=${encodeURIComponent(target.href)};end`;
}
