// 전시·팝업 v1: shared by the server (normalise model output, validate before saving) and the browser
// (validate stored rows, compute phase, period and visit dates at view time). No DOM or network here.

const DAY = 86400000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const EXHIBIT_KINDS = ['전시', '팝업', '공연', '축제', '박람회', '체험', '기타'];
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const MAX_EVENTS = 15;

const text = (value, max, nullable = false) => {
  if (nullable && (value === null || value === undefined || (typeof value === 'string' && !value.trim()))) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid exhibit text');
  return value.trim().slice(0, max);
};
const strings = (value, max, length = 300) => (Array.isArray(value) ? value : [])
  .filter(item => typeof item === 'string' && item.trim()).slice(0, max).map(item => item.trim().slice(0, length));
const httpUrl = value => {
  if (value === null || value === undefined) return null;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; }
};
const toUtc = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const validIso = value => {
  if (typeof value !== 'string' || !ISO_DATE.test(value)) return null;
  const date = new Date(toUtc(value));
  return date.toISOString().slice(0, 10) === value ? value : null;
};
const addYear = iso => validIso(`${+iso.slice(0, 4) + 1}${iso.slice(4)}`) ?? iso;
const isoAdd = (iso, days) => new Date(toUtc(iso) + days * DAY).toISOString().slice(0, 10);
const weekday = iso => WEEKDAYS[new Date(toUtc(iso)).getUTCDay()];

/** Today's date in Korea as YYYY-MM-DD. */
export function kstDate(now = new Date()) { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
/** "2026.11.14" */
export const dotDate = iso => iso.replaceAll('-', '.');
const shortDate = iso => `${+iso.slice(5, 7)}.${iso.slice(8, 10)}`;

/**
 * Weekdays written in the post's own date text, e.g. "26.10.29(목)~11.14(토)" → ['목', '토'].
 * Used only to flag a mismatch for the member; the model never judges dates itself.
 */
export function rawWeekdays(raw) {
  return [...String(raw ?? '').matchAll(/\(\s*([일월화수목금토])\s*\)/g)].map(match => match[1]);
}

/**
 * Weekly closing days from the post's own wording ("매주 월요일", "월·화 휴관"). Anything irregular (holidays,
 * alternate weeks, specific dates) gives null so no visit date is suggested from a guess.
 */
export function closedWeekdays(closed) {
  if (typeof closed !== 'string' || !closed.trim()) return [];
  if (/연중무휴/.test(closed)) return [];
  if (/공휴일|명절|격주|첫째|둘째|셋째|넷째|마지막|\d+\s*[월일]\s*\d*|\d+\./.test(closed)) return null;
  // "월요일" or a lone day name between separators ("월·화 휴관"); the 일 in "휴관일" is not Sunday.
  const days = [...closed.matchAll(/(?<![가-힣])([일월화수목금토])(?=요일|\s*[·,/]|\s+휴|\s*$)/g)].map(match => match[1]);
  return days.length ? [...new Set(days)] : null;
}

/** External map search for a place; never coordinates we did not receive. */
export function mapLink(event) {
  const query = event.address || event.web?.address?.value || [event.place, event.area].filter(Boolean).join(' ');
  return query ? 'https://map.naver.com/p/search/' + encodeURIComponent(query) : null;
}

// --- model output → stored v1 --------------------------------------------------------------------

function normalizeEvent(raw, { sourceText }) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid exhibit event');
  const checks = strings(raw.checks, 5);
  let start = validIso(raw.start_date); let end = validIso(raw.end_date);
  const inferred = raw.year_inferred === true;
  if (start && end && end < start) {
    if (inferred) end = addYear(end);
    else checks.push('종료일이 시작일보다 앞서 있어요. 원본 날짜를 확인해 주세요.');
  }
  const dateRaw = text(raw.date_raw, 80, true);
  const written = rawWeekdays(dateRaw);
  const dated = [start, end].filter(Boolean);
  if (written.length === dated.length && written.some((day, i) => day !== weekday(dated[i]))) {
    checks.push(`원본에 적힌 요일(${written.join('·')})과 날짜가 맞지 않아요. 공식 안내에서 날짜를 확인해 주세요.`);
  }
  if (inferred && dated.length) checks.push('원본에 연도가 없어 받은 날짜를 기준으로 연도를 정했어요.');
  // Links must come from text we received, never from the model's memory or an unverifiable image.
  const link = value => {
    const url = httpUrl(value);
    return url && sourceText.includes(url.replace(/\/$/, '').replace(/^https?:\/\//, '')) ? url : null;
  };
  const reserveUrl = link(raw.reserve_url); const officialUrl = link(raw.official_url);
  if ((raw.reserve_url && !reserveUrl) || (raw.official_url && !officialUrl)) {
    checks.push('이미지 속 링크는 확인하지 못해 넣지 않았어요. Instagram 원본에서 링크를 확인해 주세요.');
  }
  const evidence = Object.fromEntries(Object.entries(raw.evidence && typeof raw.evidence === 'object' ? raw.evidence : {})
    .filter(([key, value]) => /^[a-z_]{1,30}$/.test(key) && typeof value === 'string' && value.trim())
    .slice(0, 30).map(([key, value]) => [key, value.trim().slice(0, 80)]));
  return {
    title: text(raw.title, 120), titleGenerated: raw.title_is_generated === true,
    name: text(raw.name, 120, true), hostOrArtist: text(raw.host_or_artist, 120, true),
    kind: EXHIBIT_KINDS.includes(raw.kind) ? raw.kind : '기타',
    media: typeof raw.media === 'string' && /^(이미지|영상)\d{1,2}$/.test(raw.media) ? raw.media : null,
    intro: text(raw.intro, 400, true), dateRaw, start, end, periodText: text(raw.period_text, 80, true), yearInferred: inferred,
    hours: text(raw.hours, 160, true), closed: text(raw.closed, 120, true),
    place: text(raw.place, 120, true), address: text(raw.address, 160, true), area: text(raw.area, 60, true),
    fee: text(raw.fee, 200, true), isFree: typeof raw.is_free === 'boolean' ? raw.is_free : null,
    booking: text(raw.booking, 160, true), conditions: text(raw.conditions, 200, true),
    reserveUrl, officialUrl, evidence,
    conflicts: strings(raw.conflicts, 5), notices: strings(raw.notices, 5), checks: [...new Set(checks)].slice(0, 8), web: {},
  };
}

/**
 * Turns the model's JSON into the stored v1 structure. `reference` is the KST day the DM was received;
 * `sourceText` is every caption/message text we actually received: links not present in it are dropped.
 * Returns { kind: 'none' } when the content has no visitable event.
 */
export function normalizeExhibit(raw, { reference, sourceText = '' }) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid exhibit');
  if (raw.is_event === false || !Array.isArray(raw.events) || !raw.events.length) return { kind: 'none' };
  const events = raw.events.slice(0, MAX_EVENTS).flatMap(event => {
    try { return [normalizeEvent(event, { sourceText })]; } catch { return []; } // One unreadable entry must not drop the rest.
  });
  if (!events.length) return { kind: 'none' };
  const shared = raw.shared && typeof raw.shared === 'object' ? raw.shared : {};
  return validateExhibit({ version: 1, reference,
    contentType: ['reel', 'carousel', 'single_image'].includes(raw.content_type) ? raw.content_type : null,
    shared: { fee: text(shared.fee, 120, true), area: text(shared.area, 60, true), booking: text(shared.booking, 160, true), notes: text(shared.notes, 300, true) },
    events });
}

/** Validates a stored v1 exhibit (server before saving, browser before showing). Throws on anything unexpected. */
export function validateExhibit(value) {
  if (!value || value.version !== 1 || !ISO_DATE.test(value.reference ?? '')) throw new Error('Unsupported exhibit');
  if (!Array.isArray(value.events) || !value.events.length || value.events.length > MAX_EVENTS) throw new Error('Invalid exhibit events');
  const shared = value.shared ?? {};
  return {
    version: 1, reference: value.reference, contentType: ['reel', 'carousel', 'single_image'].includes(value.contentType) ? value.contentType : null,
    shared: { fee: text(shared.fee, 120, true), area: text(shared.area, 60, true), booking: text(shared.booking, 160, true), notes: text(shared.notes, 300, true) },
    events: value.events.map(event => {
      for (const key of ['start', 'end']) if (event[key] !== null && !validIso(event[key])) throw new Error('Invalid exhibit date');
      if (!EXHIBIT_KINDS.includes(event.kind)) throw new Error('Invalid exhibit kind');
      return {
        title: text(event.title, 120), titleGenerated: event.titleGenerated === true,
        name: text(event.name, 120, true), hostOrArtist: text(event.hostOrArtist, 120, true), kind: event.kind,
        media: typeof event.media === 'string' && /^(이미지|영상)\d{1,2}$/.test(event.media) ? event.media : null,
        intro: text(event.intro, 400, true), dateRaw: text(event.dateRaw, 80, true), start: event.start, end: event.end,
        periodText: text(event.periodText, 80, true), yearInferred: event.yearInferred === true,
        hours: text(event.hours, 160, true), closed: text(event.closed, 120, true),
        place: text(event.place, 120, true), address: text(event.address, 160, true), area: text(event.area, 60, true),
        fee: text(event.fee, 200, true), isFree: typeof event.isFree === 'boolean' ? event.isFree : null,
        booking: text(event.booking, 160, true), conditions: text(event.conditions, 200, true),
        reserveUrl: httpUrl(event.reserveUrl), officialUrl: httpUrl(event.officialUrl),
        evidence: Object.fromEntries(Object.entries(event.evidence ?? {}).filter(([k, v]) => /^[a-z_]{1,30}$/.test(k) && typeof v === 'string').slice(0, 30)),
        conflicts: strings(event.conflicts, 8), notices: strings(event.notices, 5), checks: strings(event.checks, 8),
        web: validateWeb(event.web),
      };
    }),
  };
}

// --- web fills (step 2) ---------------------------------------------------------------------------

/** Fields the web step may fill, as the model names them, and the event key each one lands in. */
export const FILL_FIELDS = { hours: 'hours', closed: 'closed', address: 'address', fee: 'fee', booking: 'booking',
  conditions: 'conditions', official_url: 'officialUrl', reserve_url: 'reserveUrl' };
const VENUE_FIELDS = new Set(['hours', 'closed', 'address']);
const squash = value => String(value ?? '').replace(/\s+/g, '');

/** Fields the post left empty and the web step has not filled yet. */
export function missingFields(event) {
  return Object.entries(FILL_FIELDS).filter(([field, key]) => !event[key] && !event.web?.[field]).map(([field]) => field);
}

function validateWeb(web) {
  if (!web || typeof web !== 'object') return {};
  return Object.fromEntries(Object.entries(web).filter(([field]) => Object.hasOwn(FILL_FIELDS, field)).map(([field, fill]) => {
    const url = httpUrl(fill?.url);
    if (!url) throw new Error('Invalid web fill');
    return [field, { value: text(fill.value, 200), url, title: text(fill.title, 200, true), quote: text(fill.quote, 200),
      basis: fill.basis === 'venue' ? 'venue' : 'event' }];
  }));
}

/**
 * Applies the model's fills for one event. Each fill must name a page we opened for this event, quote that page
 * verbatim, and fill a field that is still empty; venue pages may only give hours, closing days and address.
 * Returns how many fields were filled.
 */
export function applyWebFills(event, answer, pages) {
  event.web ??= {};
  let count = 0;
  for (const fill of Array.isArray(answer?.fills) ? answer.fills : []) {
    const key = FILL_FIELDS[fill?.field];
    const page = pages.find(p => p.id === fill?.source);
    if (!key || !page || event[key] || event.web[fill.field]) continue;
    if (typeof fill.value !== 'string' || !fill.value.trim() || typeof fill.quote !== 'string' || squash(fill.quote).length < 4) continue;
    if (!squash(page.text).includes(squash(fill.quote))) continue; // A quote the page does not contain was made up.
    const basis = fill.basis === 'venue' ? 'venue' : 'event';
    if (basis === 'venue' && !VENUE_FIELDS.has(fill.field)) continue;
    let value = fill.value.trim().slice(0, 200);
    if (key.endsWith('Url')) {
      const url = httpUrl(value);
      if (!url || (url !== page.url && !page.text.includes(url.replace(/^https?:\/\//, '').replace(/\/$/, '')))) continue;
      if (fill.field === 'official_url' && basis !== 'event') continue;
      value = url;
    }
    event.web[fill.field] = { value, url: page.url, title: page.title?.slice(0, 200) || null, quote: fill.quote.trim().slice(0, 200), basis };
    count++;
  }
  for (const conflict of strings(answer?.conflicts, 3)) event.conflicts = [...new Set([...event.conflicts, '웹 안내와 다름: ' + conflict])].slice(0, 8);
  return count;
}

/**
 * The value to show for a field: the post's own, else the web fill marked as such. `web` is the source page or null.
 */
export function shownValue(event, field) {
  const key = FILL_FIELDS[field] ?? field;
  if (event[key]) return { value: event[key], web: null };
  const fill = event.web?.[field];
  return fill ? { value: fill.value, web: fill } : { value: null, web: null };
}

/** "운영 시간 · 휴무일 → 서울시립미술관 (sema.seoul.go.kr)" lines for every page a fill came from. */
export function webSources(event) {
  const label = { hours: '운영 시간', closed: '휴무일', address: '주소', fee: '입장료', booking: '예약', conditions: '관람 조건',
    official_url: '공식 안내', reserve_url: '예약 링크' };
  const byUrl = new Map();
  for (const [field, fill] of Object.entries(event.web ?? {})) {
    const entry = byUrl.get(fill.url) ?? { url: fill.url, title: fill.title, basis: fill.basis, fields: [] };
    entry.fields.push(label[field]); byUrl.set(fill.url, entry);
  }
  return [...byUrl.values()];
}

// --- view-time values ----------------------------------------------------------------------------

/**
 * Phase, period line and suggested visit dates as of `now` (KST). Nothing here is stored, so it never goes stale.
 */
export function exhibitView(event, now = new Date(), { visitCount = 5 } = {}) {
  const today = kstDate(now);
  const ended = !!event.end && event.end < today;
  const upcoming = !!event.start && event.start > today;
  const phase = ended ? '종료' : upcoming ? '예정' : event.start || event.end ? '진행 중' : '기간 미확인';
  const phaseCls = ended ? 'badge s-neutral' : phase === '기간 미확인' ? 'badge s-warn' : 'badge s-done';
  const period = event.start || event.end
    ? `${event.start ? dotDate(event.start) : ''} – ${event.end ? dotDate(event.end) : ''}`.trim()
    : event.periodText ?? '기간 미기재';
  const shortPeriod = event.start || event.end
    ? `${event.start ? shortDate(event.start) : ''} – ${event.end ? shortDate(event.end) : ''}`.trim() : event.periodText ?? '기간 미기재';
  const where = event.place ?? event.area;
  const keyLine = [ended ? '종료' : upcoming ? '예정' : null, shortPeriod, where].filter(Boolean).join(' · ');
  // Visit dates only when the open days are known: a dated end, and closing days that are absent or weekly.
  const closedDays = closedWeekdays(event.closed ?? event.web?.closed?.value ?? null);
  const visits = [];
  if (!ended && event.end && closedDays) {
    for (let day = event.start && event.start > today ? event.start : today; day <= event.end && visits.length < visitCount; day = isoAdd(day, 1)) {
      if (!closedDays.includes(weekday(day))) visits.push({ date: day, label: `${+day.slice(5, 7)}월 ${+day.slice(8, 10)}일 (${weekday(day)})` });
    }
  }
  const daysLeft = event.end && !ended ? Math.round((toUtc(event.end) - toUtc(today)) / DAY) : null;
  return { phase, phaseCls, ended, upcoming, period, keyLine, visits, daysLeft, mapUrl: mapLink(event) };
}

/** Google Calendar "add event" link for one visit day (all day, Seoul). */
export function visitCalendarLink(event, date) {
  if (!validIso(date)) return null;
  const compact = iso => iso.replaceAll('-', '');
  const address = shownValue(event, 'address').value; const hours = shownValue(event, 'hours').value;
  const details = [event.place, address, hours && '운영 ' + hours, '디미에서 정리한 일정이에요. 방문 전에 공식 안내를 확인해 주세요.']
    .filter(Boolean).join('\n');
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `${event.title} 관람`, dates: `${compact(date)}/${compact(isoAdd(date, 1))}`,
    ctz: 'Asia/Seoul', details, ...(address || event.place ? { location: address || event.place } : {}) });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}
