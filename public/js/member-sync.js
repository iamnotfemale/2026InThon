// Browser side of /api/calendar and /api/taste: requests, taste sync and the one-time move of browser-only records.
// Pure enough for Node tests: fetch, storage and the session token are injected.

export class MemberApiError extends Error {
  constructor(status, message) { super(message || '요청을 처리하지 못했어요.'); this.status = status; }
}

/** Status → what the member should read. Network failures have status 0. */
export function memberErrorText(error, fallback) {
  if (error?.status === 401) return '로그인이 만료됐어요. 다시 로그인해 주세요.';
  if (error?.status === 404 || error?.status === 403) return '이제 볼 수 없는 콘텐츠예요.';
  if (error?.status === 409 || error?.status === 422) return error.message;
  return fallback;
}

export function createMemberApi({ token, fetchImpl = (...args) => fetch(...args) }) {
  async function call(path, { method = 'GET', body, headers = {} } = {}) {
    let response;
    try {
      response = await fetchImpl(path, { method, headers: { Authorization: 'Bearer ' + ((await token()) || ''),
        ...(body === undefined ? {} : { 'Content-Type': 'application/json' }), ...headers },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    } catch { throw new MemberApiError(0, '네트워크에 연결하지 못했어요.'); }
    const text = await response.text().catch(() => '');
    let data = null; try { data = text ? JSON.parse(text) : null; } catch {}
    if (!response.ok) throw new MemberApiError(response.status, data?.error);
    return data;
  }
  const one = id => encodeURIComponent(id);
  return {
    listEvents: (from, to) => call(`/api/calendar?from=${from}&to=${to}`),
    createEvent: (event, key) => call('/api/calendar', { method: 'POST', body: event, headers: { 'Idempotency-Key': key } }),
    updateEvent: (id, event) => call('/api/calendar/' + one(id), { method: 'PATCH', body: event }),
    deleteEvent: id => call('/api/calendar/' + one(id), { method: 'DELETE' }),
    listTaste: () => call('/api/taste'),
    addTaste: id => call('/api/taste/' + one(id), { method: 'PUT' }),
    removeTaste: id => call('/api/taste/' + one(id), { method: 'DELETE' }),
  };
}

/** Requests that can never succeed for this record (bad data or content type): drop the browser copy instead of retrying forever. */
export const permanentFailure = error => error?.status === 400 || error?.status === 422;

/** A stable per-browser ID, so imports from two browsers with the same local event ID 1 never collide. */
export function browserId(storage, random = () => crypto.randomUUID()) {
  try {
    let id = storage?.getItem('dimi-browser-id');
    if (!/^[\w-]{8,64}$/.test(id ?? '')) { id = random(); storage?.setItem('dimi-browser-id', id); }
    return id;
  } catch { return 'unsaved-' + random(); }
}

/**
 * Hand-picked taste cards, kept on the server. `app` is the dashboard: state.taste is { contentId: true } and every
 * change to it (detail button, orbit "빼기", mobile) is mirrored here one card at a time; a failed request restores
 * that card and says so. Server state wins over old browser values; browser-only picks are added, never removed.
 */
export function createTasteSync({ api, app, storage }) {
  const queues = new Map();
  let generation = 0; let applying = false;
  const set = patch => { applying = true; try { app.setState(patch); } finally { applying = false; } };
  const uid = () => app.state.user?.id;

  async function load() {
    const run = ++generation; const user = uid();
    const result = await api.listTaste();
    if (run !== generation || uid() !== user) return null;
    const taste = Object.fromEntries(result.items.map(entry => [entry.content_id, true]));
    set({ taste, tasteLoaded: true });
    await importLocal(run, user, taste);
    return Object.keys(app.state.taste).filter(id => app.state.taste[id]);
  }

  async function importLocal(run, user, server) {
    const key = 'inthon-taste:' + user;
    let local; try { local = JSON.parse(storage?.getItem(key) || 'null'); } catch { local = null; }
    if (!local || typeof local !== 'object') return;
    const keep = {}; let moved = 0;
    for (const [id, picked] of Object.entries(local)) {
      if (picked !== true || server[id]) continue;   // old "false" values never delete newer server picks
      try { await api.addTaste(id); moved++; if (run === generation && uid() === user) set({ taste: { ...app.state.taste, [id]: true } }); }
      catch (error) { if (!permanentFailure(error)) keep[id] = true; }
    }
    try { if (Object.keys(keep).length) storage.setItem(key, JSON.stringify(keep)); else storage.removeItem(key); } catch {}
    if (moved && run === generation && uid() === user) app.toast(`이 브라우저에 있던 취향 ${moved}개를 계정에 저장했어요.`);
  }

  /** Called on every dashboard update with the previous and current taste maps. */
  function changed(before = {}, after = {}) {
    if (applying || app.state.mode !== 'live' || !app.state.tasteLoaded) return;
    const user = uid();
    for (const id of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const was = before[id] === true; const now = after[id] === true;
      if (was === now) continue;
      const previous = queues.get(id) ?? Promise.resolve();
      const next = previous.then(() => (now ? api.addTaste(id) : api.removeTaste(id))).catch(error => {
        if (uid() !== user) return;
        set({ taste: { ...app.state.taste, [id]: was } });
        app.toast(memberErrorText(error, now ? '취향에 담지 못했어요. 다시 시도해 주세요.' : '취향에서 빼지 못했어요. 다시 시도해 주세요.'));
      }).finally(() => { if (queues.get(id) === next) queues.delete(id); });
      queues.set(id, next);
    }
  }

  return { load, changed, reset: () => { generation++; queues.clear(); } };
}

/**
 * Moves this member's browser-only schedules (dimi-calendar:v1:<uid>) to the server once. Each local event keeps its
 * idempotency key (browser + local ID), so a repeated import never duplicates; failures stay in the browser for later.
 * Returns the created server events.
 */
export async function importLocalEvents({ api, storage, uid, browser }) {
  const key = 'dimi-calendar:v1:' + uid;
  let local; try { local = JSON.parse(storage?.getItem(key) || 'null'); } catch { return []; }
  if (!Array.isArray(local) || !local.length) return [];
  const created = []; const keep = [];
  for (const event of local) {
    try {
      created.push(await api.createEvent({ content_id: event.item, kind: event.kind, date: event.date, time: event.time ?? null,
        timezone: 'Asia/Seoul', import: true }, `import:${browser}:${event.id}`));
    } catch (error) { if (!permanentFailure(error)) keep.push(event); }
  }
  try { if (keep.length) storage.setItem(key, JSON.stringify(keep)); else storage.removeItem(key); } catch {}
  return created;
}
