// /api/calendar and /api/taste: a member's own schedules and hand-picked taste cards (docs/calendar-taste-backend-handoff.md).
// The caller's Supabase JWT is forwarded to PostgREST, so database RLS decides ownership and visibility; no secret key here.
// The server re-derives every card from the stored result with the dashboard's own converters and never trusts a
// title, type or user id sent by the browser.
import { SUPABASE_URL, SUPABASE_PUBLISHABLE_KEY } from './public/js/supabase-config.js';
import { ROW_SELECT, rowItems } from './public/js/dashboard-live.js';
import { calendarContent, contentIdOf, koreaDay, parseContentId, scheduleProblem, validCalendarDate, TASTE_TYPES } from './public/js/calendar-rules.js';
import { normalizeReminders } from './public/js/reminder-rules.js';
import { remindersConfigured } from './reminder-config.mjs';

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const IDEMPOTENCY_KEY = /^[\w:.-]{8,120}$/;
const MAX_RANGE_DAYS = 1100;
const PAGE = 1000;
// Jobs are created by the database (trigger) and their status is changed only by the server worker; members read them.
const EVENT_SELECT = 'id,factcheck_id,item_index,kind,date,time,timezone,revision,reminders,'
  + 'calendar_reminder_jobs(reminder_key,scheduled_at,status,reason,sent_at,event_revision)';
const PROBLEM_TEXT = {
  content: '일정을 등록할 수 없는 콘텐츠예요.', kind: '이 콘텐츠에 맞지 않는 일정 종류예요.', date: '날짜를 확인해 주세요.',
  time: '시간을 확인해 주세요.', past: '지난 날짜에는 새 일정을 등록할 수 없어요.', period: '확인된 전시 기간 밖의 날짜예요.',
  fixed: '공고에 확정된 날짜·시간과 달라요.',
};

class HttpError extends Error {
  constructor(status, message) { super(message); this.status = status; }
}

export const eventView = row => ({ id: row.id, content_id: contentIdOf(row.factcheck_id, row.item_index), kind: row.kind,
  date: row.date, time: row.time ?? null, timezone: row.timezone, revision: row.revision, reminders: row.reminders ?? [],
  // Only the current revision's jobs: older ones were cancelled when the schedule changed.
  reminder_jobs: (row.calendar_reminder_jobs ?? []).filter(job => job.event_revision === row.revision)
    .sort((a, b) => a.scheduled_at.localeCompare(b.scheduled_at))
    .map(job => ({ key: job.reminder_key, scheduled_at: job.scheduled_at, status: job.status, reason: job.reason ?? null, sent_at: job.sent_at ?? null })) });

const dayDiff = (from, to) => (Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86400000;

export function createMemberDataHandlers({ fetchImpl = fetch, origin = 'https://inthon.yeoziphab.com', now = () => new Date(),
  supabaseUrl = SUPABASE_URL, publishableKey = SUPABASE_PUBLISHABLE_KEY, remindersAvailable = false } = {}) {
  const reply = (res, status, value) => {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff' });
    res.end(value === undefined ? '' : JSON.stringify(value));
  };

  /** Validates the request envelope and returns { method, query, body, db, uid }. */
  async function open(req, methods) {
    if (!methods.includes(req.method)) throw new HttpError(405, '지원하지 않는 요청이에요.');
    // Same-origin GETs carry no Origin header; every writing request must come from the dashboard.
    if (req.method !== 'GET' && req.headers.origin !== origin) throw new HttpError(403, '요청한 화면을 확인할 수 없어요.');
    const authorization = req.headers.authorization;
    if (!/^Bearer [A-Za-z0-9._-]{20,8000}$/.test(authorization ?? '')) throw new HttpError(401, '먼저 로그인해 주세요.');
    let body = null;
    if (['POST', 'PATCH', 'PUT'].includes(req.method)) {
      let raw = '';
      for await (const chunk of req) { raw += chunk; if (Buffer.byteLength(raw) > 2000) throw new HttpError(413, '요청이 너무 커요.'); }
      if (raw) { try { body = JSON.parse(raw); } catch { throw new HttpError(400, '요청 형식이 올바르지 않아요.'); } }
      if (req.method !== 'PUT' && (!body || typeof body !== 'object' || Array.isArray(body))) throw new HttpError(400, '요청 형식이 올바르지 않아요.');
    }
    const db = async (path, { method = 'GET', payload, prefer } = {}) => {
      const response = await fetchImpl(supabaseUrl + path, { method, signal: AbortSignal.timeout(10000),
        headers: { apikey: publishableKey, Authorization: authorization, 'Content-Type': 'application/json', ...(prefer ? { Prefer: prefer } : {}) },
        ...(payload === undefined ? {} : { body: JSON.stringify(payload) }) });
      if (response.status === 401 || (path.startsWith('/auth') && !response.ok)) throw new HttpError(401, '로그인을 다시 확인해 주세요.');
      // RLS refusing a write (42501) means the content is not (or no longer) the member's.
      if (response.status === 403) throw new HttpError(404, '볼 수 있는 콘텐츠가 아니에요.');
      if (response.status === 409) return { conflict: true };
      if (!response.ok) throw new HttpError(503, '지금은 저장소에 연결하지 못했어요.');
      const text = await response.text();
      return text ? JSON.parse(text) : null;
    };
    const user = await db('/auth/v1/user');
    if (!UUID.test(user?.id ?? '')) throw new HttpError(401, '로그인을 확인하지 못했어요.');
    return { method: req.method, query: new URL(req.url, 'http://local').searchParams, body, db, uid: user.id };
  }

  /** The exact card behind a content ID, read with the member's own permissions. 404 if missing or not theirs. */
  async function loadCard(db, contentId) {
    const ref = parseContentId(contentId);
    if (!ref) throw new HttpError(400, '콘텐츠 ID가 올바르지 않아요.');
    const rows = await db(`/rest/v1/factchecks?select=${encodeURIComponent(ROW_SELECT)}&id=eq.${ref.factcheckId}&status=eq.done&limit=1`);
    const item = rowItems(rows?.[0], now()).find(card => card.id === contentIdOf(ref.factcheckId, ref.index));
    if (!item) throw new HttpError(404, '볼 수 있는 콘텐츠가 아니에요.');
    return { ref, item };
  }

  function scheduleFields(body) {
    const time = body.time ?? null;
    if (typeof body.kind !== 'string' || typeof body.date !== 'string' || (time !== null && typeof time !== 'string')) {
      throw new HttpError(422, '일정 종류와 날짜를 확인해 주세요.');
    }
    if (body.timezone !== undefined && body.timezone !== 'Asia/Seoul') throw new HttpError(422, '한국 시간(Asia/Seoul) 일정만 등록할 수 있어요.');
    return { kind: body.kind, date: body.date, time };
  }
  /** The member's reminder options: undefined when not sent (PATCH keeps the current ones). */
  function reminderField(value, time) {
    if (value === undefined) return undefined;
    let list;
    try { list = normalizeReminders(value, time); }
    catch (error) {
      throw new HttpError(422, error.message === 'h1' ? '종일 일정에는 1시간 전 알림을 쓸 수 없어요.' : 'DM 알림 옵션을 확인해 주세요.');
    }
    if (list.length && !remindersAvailable) throw new HttpError(422, 'DM 리마인드는 아직 준비 중이에요. 일정만 저장할 수 있어요.');
    return list;
  }
  /** Whether the bot may message this member right now (last real DM within 24 hours). Never fails the request. */
  async function dmEligibility(db) {
    try {
      const [window] = await db('/rest/v1/rpc/my_dm_window', { method: 'POST', payload: {} }) ?? [];
      if (!window?.linked) return { eligible_now: false, reason: 'not_linked', window_ends_at: null };
      const ends = window.window_ends_at;
      const open = Boolean(ends) && Date.parse(ends) > now().getTime();
      return { eligible_now: open, reason: open ? null : 'window_closed', window_ends_at: open ? ends : null };
    } catch { return null; }
  }
  function checkSchedule(item, fields, options) {
    const problem = scheduleProblem(calendarContent(item), fields, { today: koreaDay(now()), ...options });
    if (problem) throw new HttpError(422, PROBLEM_TEXT[problem]);
  }

  async function calendar(req, res) {
    try {
      const { method, query, body, db } = await open(req, ['GET', 'POST', 'PATCH', 'DELETE']);
      const id = query.get('id');
      if (method === 'GET') {
        const from = query.get('from'); const to = query.get('to');
        if (!validCalendarDate(from) || !validCalendarDate(to) || from > to || dayDiff(from, to) > MAX_RANGE_DAYS) {
          throw new HttpError(400, `조회 기간(from, to)을 ${MAX_RANGE_DAYS}일 이내로 지정해 주세요.`);
        }
        const events = [];
        for (let offset = 0; ; offset += PAGE) {
          const page = await db(`/rest/v1/calendar_events?select=${EVENT_SELECT}&date=gte.${from}&date=lte.${to}`
            + `&order=date.asc,time.asc.nullsfirst,created_at.asc&limit=${PAGE}&offset=${offset}`);
          events.push(...page.map(eventView));
          if (page.length < PAGE) break;
        }
        return reply(res, 200, { events, reminders_available: remindersAvailable,
          dm_eligibility: remindersAvailable ? await dmEligibility(db) : null });
      }
      if (method === 'POST') {
        if (id) throw new HttpError(405, '지원하지 않는 요청이에요.');
        const key = req.headers['idempotency-key'];
        if (!IDEMPOTENCY_KEY.test(key ?? '')) throw new HttpError(400, 'Idempotency-Key가 필요해요.');
        const fields = scheduleFields(body);
        const { ref, item } = await loadCard(db, body.content_id);
        // Imported browser records keep their original (possibly past) dates; new schedules may not start in the past.
        checkSchedule(item, fields, { allowPast: body.import === true });
        const reminders = reminderField(body.reminders, fields.time) ?? [];
        const payload = { factcheck_id: ref.factcheckId, item_index: ref.index, ...fields, reminders, timezone: 'Asia/Seoul', idempotency_key: key };
        const created = await db(`/rest/v1/calendar_events?on_conflict=user_id,idempotency_key&select=${EVENT_SELECT}`,
          { method: 'POST', payload, prefer: 'return=representation,resolution=ignore-duplicates' });
        if (created?.length) return reply(res, 201, eventView(created[0]));
        // A retry of a request that already succeeded: answer with the stored schedule, not a second one.
        const existing = await db(`/rest/v1/calendar_events?select=${EVENT_SELECT}&idempotency_key=eq.${encodeURIComponent(key)}&limit=1`);
        if (!existing?.length) throw new HttpError(404, '볼 수 있는 콘텐츠가 아니에요.');
        return reply(res, 200, eventView(existing[0]));
      }
      if (!UUID.test(id ?? '')) throw new HttpError(400, '일정 ID가 올바르지 않아요.');
      if (method === 'DELETE') {
        await db(`/rest/v1/calendar_events?id=eq.${id}`, { method: 'DELETE' });
        return reply(res, 204);
      }
      // PATCH: optimistic concurrency on revision.
      if (!Number.isSafeInteger(body.revision) || body.revision < 1) throw new HttpError(422, '수정할 일정의 revision이 필요해요.');
      const [current] = await db(`/rest/v1/calendar_events?select=${EVENT_SELECT}&id=eq.${id}&limit=1`) ?? [];
      if (!current) throw new HttpError(404, '일정을 찾을 수 없어요.');
      if (current.revision !== body.revision) throw new HttpError(409, '다른 화면에서 이 일정이 바뀌었어요. 새로고침한 뒤 다시 수정해 주세요.');
      const fields = scheduleFields(body);
      const contentId = body.content_id ?? contentIdOf(current.factcheck_id, current.item_index);
      const { ref, item } = await loadCard(db, contentId);
      const sameDay = fields.date === current.date && ref.factcheckId === current.factcheck_id && ref.index === current.item_index;
      checkSchedule(item, fields, { allowPast: sameDay });
      // Omitted: keep the current options (an all-day schedule simply loses "1시간 전").
      const reminders = reminderField(body.reminders, fields.time)
        ?? (current.reminders ?? []).filter(key => !(key === 'h1' && fields.time === null));
      const updated = await db(`/rest/v1/calendar_events?id=eq.${id}&revision=eq.${body.revision}&select=${EVENT_SELECT}`, { method: 'PATCH',
        payload: { factcheck_id: ref.factcheckId, item_index: ref.index, ...fields, reminders, revision: body.revision + 1, updated_at: now().toISOString() },
        prefer: 'return=representation' });
      if (!updated?.length) throw new HttpError(409, '다른 화면에서 이 일정이 바뀌었어요. 새로고침한 뒤 다시 수정해 주세요.');
      return reply(res, 200, eventView(updated[0]));
    } catch (error) { return fail(res, error); }
  }

  async function taste(req, res) {
    try {
      const { method, query, db } = await open(req, ['GET', 'PUT', 'DELETE']);
      if (method === 'GET') {
        const items = [];
        for (let offset = 0; ; offset += PAGE) {
          const page = await db(`/rest/v1/taste_collections?select=factcheck_id,item_index,created_at&order=created_at.desc,factcheck_id.desc,item_index.asc&limit=${PAGE}&offset=${offset}`);
          items.push(...page.map(row => ({ content_id: contentIdOf(row.factcheck_id, row.item_index), collected_at: row.created_at })));
          if (page.length < PAGE) break;
        }
        return reply(res, 200, { items });
      }
      const contentId = query.get('id');
      const ref = parseContentId(contentId);
      if (!ref) throw new HttpError(400, '콘텐츠 ID가 올바르지 않아요.');
      if (method === 'DELETE') {
        // Only the collection entry goes; the analysis, schedules and favourites stay.
        await db(`/rest/v1/taste_collections?factcheck_id=eq.${ref.factcheckId}&item_index=eq.${ref.index}`, { method: 'DELETE' });
        return reply(res, 204);
      }
      const { item } = await loadCard(db, contentId);
      if (!TASTE_TYPES.includes(item.type)) throw new HttpError(422, '취향에 모을 수 없는 콘텐츠예요.');
      await db('/rest/v1/taste_collections?on_conflict=user_id,factcheck_id,item_index', { method: 'POST',
        payload: { factcheck_id: ref.factcheckId, item_index: ref.index }, prefer: 'return=minimal,resolution=ignore-duplicates' });
      return reply(res, 200, { content_id: contentId });
    } catch (error) { return fail(res, error); }
  }

  function fail(res, error) {
    if (error instanceof HttpError) return reply(res, error.status, { error: error.message });
    return reply(res, 503, { error: '지금은 처리하지 못했어요. 잠시 후 다시 시도해 주세요.' });
  }

  return { calendar, taste };
}

let handlers;
export const memberDataHandlers = () => (handlers ??= createMemberDataHandlers({ origin: process.env.PUBLIC_URL || 'https://inthon.yeoziphab.com',
  remindersAvailable: remindersConfigured() }));
