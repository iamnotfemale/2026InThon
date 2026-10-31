// 공모전·대외활동 v1: shared by the server (normalise model output, validate before saving) and the browser
// (validate stored rows, compute D-day and recruiting phase at view time). No DOM or network here.

const DAY = 86400000;
const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];
export const SCHEDULE_TYPES = ['start', 'deadline', 'announce', 'activity', 'event', 'other'];
const TYPE_ORDER = { start: 0, deadline: 1, announce: 2, event: 3, activity: 4, other: 5 };

const text = (value, max, nullable = false) => {
  if (nullable && (value === null || value === undefined || (typeof value === 'string' && !value.trim()))) return null;
  if (typeof value !== 'string' || !value.trim()) throw new Error('Invalid contest text');
  return value.trim().slice(0, max);
};
const list = (value, max) => { if (!Array.isArray(value)) throw new Error('Invalid contest list'); return value.slice(0, max); };
// Empty entries are skipped rather than failing the whole result.
const items = (value, max) => list(value, max).filter(item => typeof item?.text === 'string' && item.text.trim())
  .map(item => ({ text: text(item.text, 300), evidence: text(item.evidence, 300, true) }));
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
const httpsUrl = value => {
  if (value === null || value === undefined) return null;
  try { const url = new URL(value); return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null; } catch { return null; }
};

// --- dates ---------------------------------------------------------------------------------------

/** Today's date in Korea as YYYY-MM-DD. */
export function kstDate(now = new Date()) { return new Date(now.getTime() + 9 * 3600000).toISOString().slice(0, 10); }
const toUtc = iso => Date.UTC(+iso.slice(0, 4), +iso.slice(5, 7) - 1, +iso.slice(8, 10));
const isoOf = (y, m, d) => {
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d ? date.toISOString().slice(0, 10) : null;
};

/**
 * Resolves a month/day (and optional year) as written in the post. Without a year, picks the year that puts the date
 * between 2 months before and 10 months after the reference day (when the DM was received). Invalid dates give null.
 */
export function resolveDate({ year, month, day }, reference) {
  const m = Number(month); const d = Number(day);
  if (!Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (year !== null && year !== undefined) {
    const y = Number(year);
    return Number.isInteger(y) && y >= 2000 && y <= 2100 ? (isoOf(y, m, d) && { date: isoOf(y, m, d), yearInferred: false }) : null;
  }
  const ref = toUtc(reference); const base = +reference.slice(0, 4);
  for (const y of [base, base + 1, base - 1]) {
    const iso = isoOf(y, m, d);
    if (iso && toUtc(iso) >= ref - 62 * DAY && toUtc(iso) <= ref + 305 * DAY) return { date: iso, yearInferred: true };
  }
  const iso = isoOf(base, m, d);
  return iso ? { date: iso, yearInferred: true } : null;
}

const addYear = iso => isoOf(+iso.slice(0, 4) + 1, +iso.slice(5, 7), +iso.slice(8, 10)) ?? iso;

/** "2026.11.14 (토)" */
export function formatDate(iso) {
  const day = new Date(toUtc(iso)).getUTCDay();
  return `${iso.slice(0, 4)}.${iso.slice(5, 7)}.${iso.slice(8, 10)} (${WEEKDAYS[day]})`;
}
const shortDate = iso => `${+iso.slice(5, 7)}.${iso.slice(8, 10)} (${WEEKDAYS[new Date(toUtc(iso)).getUTCDay()]})`;

// --- model output → stored v1 --------------------------------------------------------------------

/**
 * Turns the model's JSON into the stored v1 structure. `reference` is the KST day the DM was received (year inference);
 * `sourceText` is every caption/message text we actually received: links not present in it are dropped.
 * Returns { kind: 'exhibit' | 'none' } when the content is not a contest or activity.
 */
export function normalizeContest(raw, { reference, sourceText = '' }) {
  if (!raw || typeof raw !== 'object') throw new Error('Invalid contest');
  if (raw.kind === 'exhibit' || raw.kind === 'none') return { kind: raw.kind };
  if (!['contest', 'activity'].includes(raw.kind)) throw new Error('Invalid contest kind');
  const checks = list(raw.checks ?? [], 20).map(item => text(item, 300));
  let inferredYear = null;
  const schedule = list(raw.schedule ?? [], 12).map(item => {
    const type = SCHEDULE_TYPES.includes(item?.type) ? item.type : 'other';
    const start = resolveDate({ year: item?.year, month: item?.month, day: item?.day }, reference);
    const end = item?.end_month ? resolveDate({ year: item?.end_year ?? (item?.year ?? null), month: item.end_month, day: item.end_day }, reference) : null;
    if ((item?.month || item?.day) && !start) checks.push(`${text(item?.label, 40)}: 날짜 ‘${text(item?.raw, 60, true) ?? '?'}’를 확인하지 못했어요.`);
    if (start?.yearInferred) inferredYear ??= start.date.slice(0, 4);
    return { label: text(item?.label, 40), type, date: start?.date ?? null, end: end?.date ?? null,
      time: TIME.test(item?.time ?? '') ? item.time : null, raw: text(item?.raw, 80, true),
      yearInferred: !!start?.yearInferred, evidence: text(item?.evidence, 300, true) };
  });
  // Keep the order a recruitment runs in: an inferred date that falls before the application start moves a year on.
  const startDate = schedule.find(item => item.type === 'start' && item.date)?.date;
  for (const item of schedule) {
    if (startDate && item.yearInferred && item.type !== 'start' && item.date && item.date < startDate) item.date = addYear(item.date);
    if (item.end && item.date && item.end < item.date) item.end = addYear(item.end);
  }
  if (inferredYear) checks.push(`원본에 연도가 없어 받은 날짜를 기준으로 연도를 추정했어요.`);
  const deadline = schedule.find(item => item.type === 'deadline');
  if (deadline && deadline.date && !deadline.time) checks.push('마감 시간이 원본에 없어요. 공식 공고에서 확인해 주세요.');
  if (!deadline) checks.push('접수 마감일이 원본에 없어요.');
  // Links must come from what we received, never from the model's memory.
  const links = list(raw.links ?? [], 6).map(link => ({ label: link?.label, url: httpsUrl(link?.url) }))
    .filter(link => link.url && sourceText.includes(link.url.replace(/\/$/, '')));
  const notice = links.find(link => link.label === 'notice')?.url ?? null;
  const apply = links.find(link => link.label === 'apply')?.url ?? null;
  return validateContest({ version: 1, kind: raw.kind, title: text(raw.title, 120), summary: text(raw.summary, 400, true),
    host: text(raw.host, 100, true), organizer: text(raw.organizer, 100, true),
    sponsors: list(raw.sponsors ?? [], 6).map(item => text(item, 100)),
    reference, schedule, eligibility: items(raw.eligibility ?? [], 12), submissions: items(raw.submissions ?? [], 12),
    process: items(raw.process ?? [], 12), benefits: items(raw.benefits ?? [], 12), fee: text(raw.fee, 120, true),
    contact: text(raw.contact, 160, true), noticeUrl: notice, applyUrl: apply, checks: [...new Set(checks)].slice(0, 20) });
}

/** Validates a stored v1 contest (server before saving, browser before showing). Throws on anything unexpected. */
export function validateContest(value) {
  if (!value || value.version !== 1 || !['contest', 'activity'].includes(value.kind)) throw new Error('Unsupported contest');
  if (!ISO_DATE.test(value.reference ?? '')) throw new Error('Invalid reference date');
  const schedule = list(value.schedule, 12).map(item => {
    if (!SCHEDULE_TYPES.includes(item.type)) throw new Error('Invalid schedule type');
    for (const key of ['date', 'end']) if (item[key] !== null && !ISO_DATE.test(item[key] ?? '')) throw new Error('Invalid schedule date');
    if (item.time !== null && !TIME.test(item.time ?? '')) throw new Error('Invalid schedule time');
    return { label: text(item.label, 40), type: item.type, date: item.date, end: item.end, time: item.time,
      raw: text(item.raw, 80, true), yearInferred: item.yearInferred === true, evidence: text(item.evidence, 300, true) };
  }).sort((a, b) => (a.date ?? '9999') .localeCompare(b.date ?? '9999') || TYPE_ORDER[a.type] - TYPE_ORDER[b.type]);
  return { version: 1, kind: value.kind, title: text(value.title, 120), summary: text(value.summary, 400, true),
    host: text(value.host, 100, true), organizer: text(value.organizer, 100, true), sponsors: list(value.sponsors, 6).map(item => text(item, 100)),
    reference: value.reference, schedule, eligibility: items(value.eligibility, 12), submissions: items(value.submissions, 12),
    process: items(value.process, 12), benefits: items(value.benefits, 12), fee: text(value.fee, 120, true), contact: text(value.contact, 160, true),
    noticeUrl: httpsUrl(value.noticeUrl), applyUrl: httpsUrl(value.applyUrl), checks: list(value.checks, 20).map(item => text(item, 300)) };
}

// --- view-time values ----------------------------------------------------------------------------

/**
 * Recruiting phase, D-day and timeline as of `now` (KST). Nothing here is stored, so it never goes stale.
 */
export function contestTimeline(contest, now = new Date()) {
  const today = kstDate(now);
  const deadline = contest.schedule.find(item => item.type === 'deadline' && item.date) ?? null;
  const start = contest.schedule.find(item => item.type === 'start' && item.date) ?? null;
  const closesAt = deadline && Date.parse(`${deadline.date}T${deadline.time ?? '23:59'}:59+09:00`);
  const closed = !!deadline && now.getTime() > closesAt;
  const upcoming = !closed && !!start && start.date > today;
  const days = deadline ? Math.round((toUtc(deadline.date) - toUtc(today)) / DAY) : null;
  const dday = deadline && !closed ? (days === 0 ? 'D-DAY' : `D-${days}`) : null;
  const phase = !deadline ? (upcoming ? '모집 예정' : '마감일 미확인') : closed ? '마감' : upcoming ? '모집 예정' : '모집 중';
  const phaseCls = closed ? 'badge s-neutral' : !deadline ? 'badge s-warn' : 'badge s-done';
  const when = item => (item.date ? formatDate(item.date) + (item.end ? ' – ' + formatDate(item.end) : '') : item.raw ?? '날짜 미기재')
    + (item.time ? ' ' + item.time : '') + (item.yearInferred ? ' · 연도 추정' : '');
  const state = item => {
    const last = item.end ?? item.date;
    if (!item.date) return 'wait';
    if (last < today || (item === deadline && closed)) return 'ok';
    return (item.date <= today && last >= today) || (item === deadline && !closed && !upcoming) ? 'run' : 'wait';
  };
  return {
    phase, phaseCls, dday, closed,
    deadlineLabel: deadline ? `${formatDate(deadline.date)} ${deadline.time ? deadline.time + ' KST' : '· 마감 시간 미기재'}` : '마감일이 원본에 없어요',
    keyLine: deadline ? ['마감 ' + shortDate(deadline.date) + (deadline.time ? ' ' + deadline.time : ' · 시간 미기재'), dday].filter(Boolean).join(' · ') : '마감일 미확인',
    schedule: contest.schedule.map(item => ({ label: item.label, date: when(item), st: state(item) })),
    // Upcoming dated events for the dashboard's "다가오는 일정" and calendar links.
    events: contest.schedule.filter(item => item.date && (item.end ?? item.date) >= today)
      .map(item => ({ label: item.label, type: item.type, date: item.date, time: item.time,
        days: Math.round((toUtc(item.date) - toUtc(today)) / DAY) })),
  };
}

/** Google Calendar "add event" link for a dated schedule item (all-day when there is no time). */
export function calendarLink(title, item) {
  if (!item?.date) return null;
  const compact = iso => iso.replaceAll('-', '');
  let dates;
  if (item.time) {
    const start = `${compact(item.date)}T${item.time.replace(':', '')}00`;
    const endTime = new Date(Date.parse(`${item.date}T${item.time}:00Z`) + 3600000).toISOString();
    dates = `${start}/${compact(endTime.slice(0, 10))}T${endTime.slice(11, 16).replace(':', '')}00`;
  } else {
    dates = `${compact(item.date)}/${compact(new Date(toUtc(item.date) + DAY).toISOString().slice(0, 10))}`;
  }
  const params = new URLSearchParams({ action: 'TEMPLATE', text: `${title} · ${item.label}`, dates, ctz: 'Asia/Seoul', details: '디미에서 정리한 일정이에요. 공식 공고에서 다시 확인해 주세요.' });
  return 'https://calendar.google.com/calendar/render?' + params.toString();
}
