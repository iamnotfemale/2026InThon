// Schedule rules shared by the dashboard calendar (browser) and /api/calendar (server), so both refuse the same things.
// Pure functions only: no DOM, no network.

export const VALID_TIME = /^(?:[01]\d|2[0-3]):[0-5]\d$/;
/** Allowed schedule kinds per content type (news has none). Mirrors KINDS in frontend/calendar/Calendar.dc.html. */
export const KINDS_BY_TYPE = { recipe: ['cook'], exhibit: ['visit'], contest: ['deadline', 'prep', 'result'], restaurant: ['visit'], space: ['visit'] };
export const SCHEDULE_TYPES = Object.keys(KINDS_BY_TYPE);
/** Types that can be collected into 내 취향 (space is shown with exhibitions but stays 'space'). */
export const TASTE_TYPES = SCHEDULE_TYPES;

export function validCalendarDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const date = new Date(value + 'T12:00:00');
  return Number.isFinite(+date) && date.getFullYear() === Number(value.slice(0, 4))
    && date.getMonth() + 1 === Number(value.slice(5, 7)) && date.getDate() === Number(value.slice(8));
}

/** 'YYYY-MM-DD' of `date` in Korea. */
export function koreaDay(date = new Date()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Seoul', year: 'numeric', month: '2-digit', day: '2-digit' })
    .formatToParts(date).map(part => [part.type, part.value]));
  return `${p.year}-${p.month}-${p.day}`;
}

/**
 * Card IDs: 'fc42' is the first card of result 42, 'fc42-2' its second card (the order inside the analysis result,
 * not an image number). Returns { factcheckId, index } or null; 'fc42-1' and leading zeros are not canonical.
 */
export function parseContentId(id) {
  const match = /^fc([1-9]\d{0,15})(?:-([2-9]|[1-9]\d))?$/.exec(id ?? '');
  return match ? { factcheckId: Number(match[1]), index: match[2] ? Number(match[2]) : 1 } : null;
}
export const contentIdOf = (factcheckId, index) => 'fc' + factcheckId + (index > 1 ? '-' + index : '');

/** A dashboard item → what the calendar shows and checks for it. */
export function calendarContent(item) {
  const event = item.exhibitEvent;
  const facts = item.type === 'recipe' ? []
    : item.type === 'exhibit' ? [['기간', item.period], ['운영', item.hours], ['휴무', item.closed], ['장소', item.place], ['입장료', item.fee]]
      : item.type === 'contest' ? [['주최', item.host], ['마감', item.deadline]]
        : item.type === 'restaurant' ? [['분류', item.category], ['주소', item.address]]
          : [['분류', item.category], ['주소', item.address], ['운영', item.hours], ['휴무', item.closed], ['예약', item.reservation]];
  const fixed = Object.fromEntries((item.contestEvents || []).filter(e => ['deadline', 'announce'].includes(e.type) && validCalendarDate(e.date))
    .map(e => [e.type === 'announce' ? 'result' : 'deadline', [e.date, VALID_TIME.test(e.time) ? e.time : null]]));
  return { type: item.type, title: item.title, sub: item.key || '', summary: item.summary || item.intro || '',
    facts: facts.filter(([, value]) => value), fixed,
    ...(event && validCalendarDate(event.start) && validCalendarDate(event.end) ? { from: event.start, to: event.end, closed: [] } : {}),
    listTitle: item.type === 'recipe' ? '재료' : item.type === 'contest' ? '지원 대상' : '',
    list: item.type === 'recipe' ? (item.ingredients || []).map(g => [g.name, g.qty, g.miss]) : (item.elig || []).map(value => [value, '']),
  };
}

/**
 * Why a schedule for `content` (from calendarContent) cannot be saved, or null if it can.
 * `allowPast` is for importing old browser records and for edits that keep their original date.
 * Only facts the result actually knows are enforced (exhibition period, confirmed contest dates); nothing is guessed.
 */
export function scheduleProblem(content, { kind, date, time }, { today, allowPast = false } = {}) {
  if (!content || !KINDS_BY_TYPE[content.type]) return 'content';
  if (!KINDS_BY_TYPE[content.type].includes(kind)) return 'kind';
  if (!validCalendarDate(date)) return 'date';
  if (time !== null && !VALID_TIME.test(time ?? '')) return 'time';
  if (!allowPast && today && date < today) return 'past';
  if (content.from && (date < content.from || date > content.to)) return 'period';
  const fixed = content.fixed?.[kind];
  if (fixed && (date !== fixed[0] || time !== fixed[1])) return 'fixed';
  return null;
}
