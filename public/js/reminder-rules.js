// Calendar DM reminder rules shared by /api/calendar, the reminder worker and the dashboard preview
// (docs/dm-reminders-backend-handoff.md). Pure functions only. All times are Korea time (UTC+9, no daylight saving).

/** Option keys in display order, with the design's labels. */
export const REMINDER_OPTIONS = [['day9', '당일 오전 9시'], ['h1', '1시간 전'], ['eve', '전날 오후 8시'], ['d3', '3일 전 오전 9시']];
export const REMINDER_KEYS = REMINDER_OPTIONS.map(([key]) => key);
/** Instagram allows automated replies only within 24 hours of the person's last message. */
export const DM_WINDOW_MS = 24 * 60 * 60 * 1000;
/** A due reminder that the worker reaches later than this is skipped instead of sent late. */
export const STALE_MS = 5 * 60 * 1000;

const KST_MS = 9 * 60 * 60 * 1000;
const kstToUtc = (date, hours, minutes, dayOffset = 0) => {
  const [y, m, d] = date.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + dayOffset, hours, minutes) - KST_MS);
};

/**
 * When a reminder goes out, as a UTC Date; null when the option does not apply (h1 on an all-day schedule).
 * Same rules as public.reminder_at() in the database, which is what actually schedules the jobs.
 */
export function reminderAt(key, date, time) {
  if (key === 'day9') return kstToUtc(date, 9, 0);
  if (key === 'h1') {
    if (!time) return null;
    const [h, m] = time.split(':').map(Number);
    return new Date(kstToUtc(date, h, m).getTime() - 60 * 60 * 1000);
  }
  if (key === 'eve') return kstToUtc(date, 20, 0, -1);
  if (key === 'd3') return kstToUtc(date, 9, 0, -3);
  return null;
}

/** Canonical option list: known keys only, no duplicates, display order; h1 needs a time. Throws on bad input. */
export function normalizeReminders(value, time) {
  if (!Array.isArray(value) || value.length > 8 || value.some(key => !REMINDER_KEYS.includes(key))) throw new Error('reminders');
  const list = REMINDER_KEYS.filter(key => value.includes(key));
  if (time === null && list.includes('h1')) throw new Error('h1');
  return list;
}

const kstParts = at => { const d = new Date(at.getTime() + KST_MS);
  return { date: d.toISOString().slice(0, 10), h: d.getUTCHours(), m: d.getUTCMinutes(), wd: d.getUTCDay() }; };
const WD = ['일', '월', '화', '수', '목', '금', '토'];
const dayDiff = (from, to) => Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000);
export function spokenTime(time) {
  const [h, m] = time.split(':').map(Number);
  const half = h < 12 ? '오전' : '오후'; const hour = h % 12 || 12;
  return `${half} ${hour}시${m ? ` ${m}분` : ''}`;
}
/** Short Korea-time label for lists: "오늘 09:00" or "11/7 (금) 09:00". */
export function kstLabel(at, now = new Date()) {
  const p = kstParts(at); const today = kstParts(now).date;
  const hm = String(p.h).padStart(2, '0') + ':' + String(p.m).padStart(2, '0');
  return (p.date === today ? '오늘' : `${Number(p.date.slice(5, 7))}/${Number(p.date.slice(8))} (${WD[p.wd]})`) + ' ' + hm;
}
function spokenDay(date, now) {
  const diff = dayDiff(kstParts(now).date, date);
  if (diff === 0) return '오늘';
  if (diff === 1) return '내일';
  if (diff === 2) return '모레';
  const d = new Date(date + 'T12:00:00Z');
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일(${WD[d.getUTCDay()]})`;
}
const quote = title => '‘' + String(title || '저장한 콘텐츠').replace(/\s+/g, ' ').trim().slice(0, 80) + '’';
const PHRASE = {
  cook: title => `${quote(title)} 요리하기로 하셨어요.`,
  visit: title => `${quote(title)}에 방문하기로 하셨어요.`,
  deadline: title => `${quote(title)} 마감이에요.`,
  prep: title => `${quote(title)} 준비를 시작하기로 하셨어요.`,
  result: title => `${quote(title)} 결과 발표 예정이에요.`,
};

/**
 * The reminder DM, built only from the stored schedule and card. `now` is the moment it is sent (or previewed),
 * so "오늘/내일" is right for that moment. The link is the member's own result page (login and ownership checked there).
 */
export function reminderText({ kind, date, time, title, contentId, publicUrl, now = new Date() }) {
  const when = spokenDay(date, now) + (time ? ' ' + spokenTime(time) : '');
  return ['디미가 일정 알려드려요!', `${when}, ${(PHRASE[kind] ?? PHRASE.visit)(title)}`,
    ...(publicUrl && contentId ? [`정리한 내용: ${publicUrl}/items/${contentId}`] : [])].join('\n');
}

/** What the member reads for a job's state. Wording for window/unknown follows the handoff document. */
export function reminderStatus(job) {
  if (!job) return { short: '예약 확인 중', long: '알림 예약을 확인하고 있어요.', tone: 'off' };
  if (job.status === 'scheduled') return { short: '예약됨', long: '알림 시각에 DM으로 보내요.', tone: 'sched' };
  if (job.status === 'sending') return { short: '보내는 중', long: 'DM을 보내고 있어요.', tone: 'sched' };
  if (job.status === 'sent') return { short: '보냄', long: 'DM을 보냈어요.', tone: 'sent' };
  if (job.status === 'unknown') return { short: '확인 중', long: '전송 여부를 확인하고 있어요.', tone: 'off' };
  if (job.status === 'failed') return { short: '보내지 못함', long: 'DM 알림을 보내지 못했어요.', tone: 'off' };
  if (job.status === 'cancelled') return { short: '취소됨', long: '알림이 취소됐어요.', tone: 'off' };
  const long = {
    window_closed: '메시지를 보낼 수 있는 시간이 지나 DM 알림을 보내지 못했어요.',
    past: '이미 지난 알림 시각이라 보내지 않았어요.',
    stale: '알림 시각을 놓쳐 늦게 보내지 않았어요.',
    not_linked: 'Instagram 계정을 연결해야 DM 알림을 받을 수 있어요.',
  }[job.reason] ?? 'DM 알림을 보내지 않았어요.';
  return { short: job.reason === 'window_closed' ? '보낼 수 없음' : '보내지 않음', long, tone: 'off' };
}
