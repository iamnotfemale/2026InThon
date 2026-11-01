// Calendar DM reminder worker (docs/dm-reminders-backend-handoff.md). Server only: uses the Supabase secret key.
// Each run claims due jobs atomically, re-checks everything just before sending, and records only what is known:
//   sent    — Meta answered with a message ID (accepted for delivery, not "read")
//   unknown — the request started but the answer was lost; never re-sent automatically
//   failed / skipped / cancelled — with a short reason code; Meta's error text is never stored (it can hold IDs)
import { GRAPH, IG_ID } from './server.mjs';
import { ROW_SELECT, rowItems } from './public/js/dashboard-live.js';
import { contentIdOf } from './public/js/calendar-rules.js';
import { DM_WINDOW_MS, STALE_MS, reminderText } from './public/js/reminder-rules.js';

const SEND_MARGIN_MS = 60 * 1000;   // do not start a send that would land right at the window's edge
const EVENT_SELECT = 'id,user_id,factcheck_id,item_index,kind,date,time,revision,reminders';

class Retry extends Error {}

/** Supabase REST with the secret key. */
export function createReminderStore({ url, key, fetchImpl = fetch }) {
  if (!url || !key) throw new Error('Supabase URL and secret key are required');
  const base = url.replace(/\/+$/, '') + '/rest/v1';
  const headers = { apikey: key, 'Content-Type': 'application/json' };
  if (!key.startsWith('sb_')) headers.Authorization = `Bearer ${key}`;
  const request = async (method, path, body, prefer = 'return=representation') => {
    const res = await fetchImpl(base + path, { method, headers: { ...headers, Prefer: prefer }, signal: AbortSignal.timeout(10000),
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    if (!res.ok) throw new Error(`Supabase ${method} ${path.split('?')[0]} failed (${res.status})`);
    const text = await res.text();
    return text ? JSON.parse(text) : null;
  };
  const one = async path => (await request('GET', path))?.[0] ?? null;
  const lease = job => `id=eq.${job.id}&status=eq.sending&claimed_at=eq.${encodeURIComponent(job.claimed_at)}`;
  return {
    claim: limit => request('POST', '/rpc/claim_reminder_jobs', { p_limit: limit }),
    event: id => one(`/calendar_events?id=eq.${id}&select=${EVENT_SELECT}`),
    link: userId => one(`/account_links?user_id=eq.${userId}&select=igsid`),
    result: id => one(`/factchecks?id=eq.${id}&select=${encodeURIComponent('igsid,' + ROW_SELECT)}`),
    inbound: igsid => one(`/dm_inbound?igsid=eq.${igsid}&select=last_message_at`),
    /** Marks the Meta request as started. False when this run no longer holds the job (lease lost). */
    async begin(job, at) { return (await request('PATCH', `/calendar_reminder_jobs?${lease(job)}`, { request_started_at: at, updated_at: at }))?.length > 0; },
    finish: (job, fields) => request('PATCH', `/calendar_reminder_jobs?${lease(job)}`, fields, 'return=minimal'),
  };
}

/** Meta's answer → final state. Only a definite refusal is "failed"; anything ambiguous is "unknown". */
export function classifySendError(error) {
  if (!error?.metaResponse) return { status: 'unknown', reason: error?.name === 'TimeoutError' ? 'timeout' : 'no_response' };
  const { httpStatus, code, subcode } = error.metaResponse;
  if (httpStatus >= 500) return { status: 'unknown', reason: 'meta_' + httpStatus };
  // 10 / 2534022: outside the allowed messaging window.
  if (code === 10 && (subcode === 2534022 || !subcode)) return { status: 'skipped', reason: 'window_closed' };
  if (code === 551 || subcode === 2534014) return { status: 'skipped', reason: 'recipient_unavailable' };
  return { status: 'failed', reason: 'meta_' + (code || httpStatus) };
}

export function createReminderWorker({ store, loadAccessToken, fetchImpl = fetch, publicUrl, now = () => new Date(),
  budgetMs = 40000, batch = 10, log = (...args) => console.info('DM_REMINDER', ...args) }) {

  async function send(token, recipient, text) {
    let response;
    try {
      response = await fetchImpl(`${GRAPH}/${IG_ID}/messages`, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(15000),
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ recipient: { id: recipient }, message: { text } }) });
    } catch (error) { throw Object.assign(new Error('Send not confirmed'), { name: error?.name }); }
    let data = null;
    try { data = await response.json(); } catch {}
    if (response.ok && typeof data?.message_id === 'string' && data.message_id) return data.message_id;
    const code = Number(data?.error?.code) || 0; const subcode = Number(data?.error?.error_subcode) || 0;
    // A 2xx without a message ID, or an unreadable body, is not a confirmed refusal.
    if (response.ok || !data?.error) throw new Error('Send not confirmed');
    throw Object.assign(new Error('Meta refused'), { metaResponse: { httpStatus: response.status, code, subcode } });
  }

  async function processJob(job, getToken, deadline) {
    const at = () => now().toISOString();
    const end = (status, reason) => store.finish(job, { status, reason, updated_at: at() }).then(() => ({ status, reason }));
    let started = false;
    try {
      if (now().getTime() - Date.parse(job.scheduled_at) > STALE_MS) return end('skipped', 'stale');
      const event = await store.event(job.event_id);
      if (!event) return { status: 'gone' };   // deleted: its jobs went with it
      if (event.revision !== job.event_revision) return end('cancelled', 'changed');
      if (!event.reminders?.includes(job.reminder_key)) return end('cancelled', 'off');
      const link = await store.link(job.user_id);
      if (!link || !job.igsid || link.igsid !== job.igsid) return end('cancelled', 'unlinked');
      const row = await store.result(event.factcheck_id);
      const contentId = contentIdOf(event.factcheck_id, event.item_index);
      const card = row?.igsid === link.igsid ? rowItems(row, now()).find(item => item.id === contentId) : null;
      if (!card) return end('cancelled', 'content_unavailable');
      const inbound = await store.inbound(link.igsid);
      const windowEnds = inbound ? Date.parse(inbound.last_message_at) + DM_WINDOW_MS : 0;
      if (!(windowEnds - SEND_MARGIN_MS > now().getTime())) return end('skipped', 'window_closed');
      if (deadline - now().getTime() < 20000) throw new Retry('out of time');
      const token = await getToken();
      const text = reminderText({ kind: event.kind, date: event.date, time: event.time, title: card.title, contentId, publicUrl, now: now() });
      if (!await store.begin(job, at())) return { status: 'lease_lost' };
      started = true;
      let messageId;
      try { messageId = await send(token, link.igsid, text); }
      catch (error) { const outcome = classifySendError(error); return end(outcome.status, outcome.reason); }
      const sentAt = at();
      await store.finish(job, { status: 'sent', reason: null, sent_at: sentAt, meta_message_id: messageId.slice(0, 300), updated_at: sentAt });
      return { status: 'sent' };
    } catch (error) {
      // After the Meta request started, a storage error must never make the job sendable again: the lease expires
      // and the next run records it as unknown.
      if (started) return { status: 'stuck' };
      // Nothing was sent (the request had not started): give the job back for the next run, up to 3 attempts.
      if (job.attempts >= 3) return end('failed', 'retry_limit').catch(() => ({ status: 'stuck' }));
      return store.finish(job, { status: 'scheduled', claimed_at: null, updated_at: at() })
        .then(() => ({ status: 'retry', reason: error instanceof Retry ? 'out_of_time' : 'temporary' }), () => ({ status: 'stuck' }));
    }
  }

  return async function run() {
    const started = now().getTime(); const deadline = started + budgetMs + 20000;
    let token; const getToken = async () => (token ??= await loadAccessToken());
    const counts = {};
    while (now().getTime() - started < budgetMs) {
      const jobs = await store.claim(batch);
      if (!jobs?.length) break;
      for (const raw of jobs) {
        const job = { ...raw, attempts: Number(raw.attempts) || 1 };
        const outcome = await processJob(job, getToken, deadline);
        counts[outcome.status] = (counts[outcome.status] ?? 0) + 1;
        log(JSON.stringify({ job: job.id, key: job.reminder_key, status: outcome.status, reason: outcome.reason ?? null }));
      }
      if (jobs.length < batch) break;
    }
    return counts;
  };
}
