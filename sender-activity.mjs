// One indicator per conversation; overlapping replies share its lifetime.
export function createSenderActivities({ sendAction, onFailure = () => {}, setTimer = setTimeout, clearTimer = clearTimeout }) {
  const conversations = new Map();
  const send = async (state, action) => {
    try { await sendAction(state.recipient, action, state.token); return true; }
    catch { onFailure(action); return false; }
  };
  return (recipient, token) => {
    let state = conversations.get(recipient);
    if (!state) {
      state = { recipient, token, pending: 0, queue: Promise.resolve(), timer: null, active: false, enabled: true };
      conversations.set(recipient, state);
    }
    state.token = token;
    state.pending++;
    const seen = send(state, 'mark_seen');
    const typing = () => {
      if (!state.pending || !state.enabled) return state.queue;
      clearTimer(state.timer);
      state.queue = state.queue.then(async () => {
        if (!state.pending || !state.enabled) return;
        state.enabled = await send(state, 'typing_on');
        if (state.enabled) state.active = true;
        if (state.pending && state.enabled) {
          clearTimer(state.timer);
          state.timer = setTimer(typing, 15000);
          state.timer?.unref?.();
        }
      });
      return state.queue;
    };
    if (state.pending === 1) typing();
    let finished = false;
    return {
      // Acknowledgement messages clear typing on Meta, so turn it back on for the remaining work.
      typing,
      async finish() {
        if (finished) return;
        finished = true;
        state.pending--;
        if (!state.pending) {
          clearTimer(state.timer);
          state.queue = state.queue.then(async () => {
            if (state.pending) return;
            if (state.active) { await send(state, 'typing_off'); state.active = false; }
            if (!state.pending) conversations.delete(recipient);
          });
        }
        await Promise.all([seen, state.queue]);
      },
    };
  };
}
