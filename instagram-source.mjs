// Graph media IDs are opaque: converting them to a shortcode can identify the wrong post.
export function canonicalInstagramUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' || !['instagram.com', 'www.instagram.com'].includes(url.hostname)
      || url.username || url.password || (url.port && url.port !== '443')
      || !/^\/(p|reel|reels|tv)\/[A-Za-z0-9_-]+\/?$/.test(url.pathname)) return null;
    return `https://www.instagram.com${url.pathname.replace(/\/?$/, '/')}`;
  } catch { return null; }
}

export function isContentMessage(message) {
  return Boolean(message.attachments?.length)
    || /https:\/\/(?:www\.)?instagram\.com(?:[/?#:]|$)/i.test(message.text ?? '');
}

export function createSourceResolver({ loadAccessToken, fetchImpl = fetch, graph = 'https://graph.facebook.com/v26.0' } = {}) {
  return async message => {
    const attachments = message.attachments ?? [];
    const shared = attachments.filter(a => ['ig_post', 'ig_reel', 'share'].includes(a.type));
    const candidates = [...(message.text ?? '').matchAll(/https:\/\/[^\s<>"'\u200b]+/g)].map(m => m[0].replace(/[),.\]}>!?]+$/, ''));
    // Captions can link to unrelated posts; they cannot establish the shared post's identity.
    for (const a of attachments) candidates.push(a.payload?.url, a.payload?.permalink);
    const urls = [...new Set(candidates.map(canonicalInstagramUrl).filter(Boolean))];
    if (urls.length > 1) return { status: 'ambiguous' };
    if (urls.length === 1) return { status: 'resolved', url: urls[0], via: 'message' };
    if (shared.length > 1) return { status: 'ambiguous' };
    if (!shared.length) return { status: 'not_needed' };
    const id = shared[0].payload?.ig_post_media_id ?? shared[0].payload?.reel_video_id;
    if (/^\d{1,30}$/.test(String(id ?? '')) && loadAccessToken) {
      try {
        const token = await loadAccessToken();
        const response = await fetchImpl(`${graph}/${id}?fields=permalink`, { redirect: 'error',
          headers: { authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(8000) });
        if (response.ok) {
          const url = canonicalInstagramUrl((await response.json()).permalink);
          if (url) return { status: 'resolved', url, via: 'graph' };
        }
      } catch { /* Missing ownership or access is a request for the link, not a guessed permalink. */ }
    }
    return { status: 'needs_source_url' };
  };
}
