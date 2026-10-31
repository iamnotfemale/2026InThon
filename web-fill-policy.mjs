// When the "일정 조회" processors look things up on the web, and how long they may spend doing it.
// The post-only result is always ready first; the web step can only add to it, and gives up quietly when time runs out.

export const FILL_BUDGET = {
  totalMs: 20000,   // whole web step: search + page fetches + one model call
  gatherMs: 8000,   // search and page fetches; slower ones are abandoned
  pageMs: 5000,     // one page fetch
  maxTargets: 3,    // events (or contests) searched per post
  pagesPerTarget: 3,
};

/** Resolves to `fallback` if `promise` has not settled within `ms` (the slow work is abandoned, not awaited). */
export function withinTime(promise, ms, fallback) {
  let timer;
  return Promise.race([promise, new Promise(resolve => { timer = setTimeout(() => resolve(fallback), ms); })])
    .finally(() => clearTimeout(timer));
}

/** Abort signal for the web step: the caller's own deadline or the step budget, whichever comes first. */
export function budgetSignal(outer, ms = FILL_BUDGET.totalMs) {
  return outer ? AbortSignal.any([outer, AbortSignal.timeout(ms)]) : AbortSignal.timeout(ms);
}

// --- 전시·팝업 -----------------------------------------------------------------------------------

/**
 * Searching is worth it only for what a visitor needs before going: where (address), when it is open (hours),
 * what it costs (fee), and how to book when booking is required. Closing days, conditions and official links are
 * filled too, but only if one of these already justified the search.
 */
export function exhibitWorthSearching(event, missing, today) {
  if (event.end && event.end < today) return false;          // already over
  if (event.titleGenerated && !event.place) return false;    // nothing specific enough to search for
  const needsBooking = !!event.booking && /예약|예매/.test(event.booking) && !/없이|불필요|필요 없/.test(event.booking);
  return missing.some(field => field === 'hours' || field === 'fee'
    || (field === 'address' && !!event.place)
    || (field === 'reserve_url' && needsBooking));
}

// --- 공모전·대외활동 ------------------------------------------------------------------------------

/** The fields a contest result is not usable without; their absence justifies a search. */
export function contestImportantMissing(contest, today) {
  const deadline = contest.schedule.find(item => item.type === 'deadline' && item.date);
  if (deadline && (deadline.end ?? deadline.date) < today) return [];  // recruitment over: nothing to act on
  const missing = [];
  if (!deadline) missing.push('deadline');
  if (!contest.noticeUrl && !contest.applyUrl) missing.push('links');
  if (!contest.eligibility.length) missing.push('eligibility');
  return missing;
}
