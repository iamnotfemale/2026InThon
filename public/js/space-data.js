// 취향공간 (서점·소품샵·편집숍·공방 같은 방문 공간): shared by the server (normalise model output before saving) and the browser
// (stored row → dashboard items). Same place fields as 맛집 without menus and price range. Stored as v1 JSON in
// factchecks.reason (topic 'space') like 전시·공모전, so no table or RPC is needed.
import { mapLinks } from './restaurant-data.js';
export { mapLinks };

export const SPACE_CATEGORIES = ['서점·책방', '소품샵·편집숍', '문구', '빈티지', '음반·LP', '공방·클래스', '갤러리·전시공간',
  '사진관', '꽃·식물', '북카페·라운지', '기타'];
const LIMITS = { name: 120, intro: 400, area: 60, address: 160, phone: 40, hours: 160, closed: 120,
  reservation: 160, waiting: 160, parking: 120 };
const FIELDS = ['intro', 'area', 'address', 'phone', 'hours', 'closed', 'reservation', 'waiting', 'parking'];

const text = (value, max) => (typeof value === 'string' && value.trim() ? value.trim().slice(0, max) : null);
const httpUrl = value => {
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; }
};

/**
 * Model JSON → { version: 1, reference, places } (or { kind: 'none' }). Links must appear in the text we received;
 * categories outside the list become 기타; at most 10 places.
 */
export function normalizeSpace(raw, { reference, sourceText = '' }) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid space result');
  if (raw.is_space !== true) return { kind: 'none' };
  const places = (Array.isArray(raw.places) ? raw.places : []).filter(place => text(place?.name, LIMITS.name)).slice(0, 10).map(place => {
    const links = (Array.isArray(place.links) ? place.links : []).map(link => ({ label: text(link?.label, 30) ?? '링크', url: httpUrl(link?.url) }))
      .filter(link => link.url && sourceText.includes(link.url.replace(/\/$/, ''))).slice(0, 5);
    const checks = (Array.isArray(place.checks) ? place.checks : []).map(check => text(check, 200)).filter(Boolean).slice(0, 6);
    if ((place.links ?? []).length > links.length) checks.push('게시물 이미지 속 링크는 확인하지 못해 넣지 않았어요.');
    const evidence = Object.fromEntries(Object.entries(place.evidence && typeof place.evidence === 'object' ? place.evidence : {})
      .filter(([key, value]) => /^[a-z_]{1,30}$/.test(key) && typeof value === 'string' && value.trim()).slice(0, 30)
      .map(([key, value]) => [key, value.trim().slice(0, 80)]));
    return {
      name: text(place.name, LIMITS.name), category: SPACE_CATEGORIES.includes(place.category) ? place.category : '기타',
      ...Object.fromEntries(FIELDS.map(field => [field, text(place[field], LIMITS[field])])),
      links, evidence, checks: [...new Set(checks)],
    };
  });
  if (!places.length) return { kind: 'none' };
  return { version: 1, reference, places };
}

/** Re-checks a stored or about-to-be-saved result; throws on anything malformed. */
export function validateSpace(value) {
  if (!value || value.version !== 1 || !Array.isArray(value.places) || !value.places.length || value.places.length > 10) {
    throw new Error('Invalid space result');
  }
  for (const place of value.places) {
    if (!text(place?.name, LIMITS.name) || !SPACE_CATEGORIES.includes(place.category)
      || FIELDS.some(field => place[field] !== null && place[field] !== undefined && typeof place[field] !== 'string')
      || !Array.isArray(place.links) || !Array.isArray(place.checks) || place.links.some(link => !httpUrl(link?.url))) {
      throw new Error('Invalid space place');
    }
  }
  return value;
}

/** One-line summary for lists: "서점·책방 · 연남동 · 월 휴무". */
export function spaceKeyLine(place) {
  const where = place.area ?? (place.address ? place.address.split(/\s+/).slice(1, 3).join(' ') : null);
  return [place.category, where, place.closed && place.closed.length <= 20 ? place.closed : null].filter(Boolean).join(' · ');
}
