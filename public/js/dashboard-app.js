import { h, render } from './vendor/preact.module.js';
import DashboardModel from './dashboard-model.js';
import { BOT_DM_URL, factcheckToItem, displayName, linkState, applyLiveMode } from './dashboard-live.js';

function routeState(path) {
  const view = { '/': 'home', '/home': 'home', '/dashboard': 'home', '/library': 'library', '/taste': 'taste', '/settings': 'settings' }[path];
  if (view) return { view, cook: null, timer: null, modal: null };
  const item = /^\/items\/([\w-]+)\/?$/.exec(path);
  return item ? { view: 'detail', detailId: item[1], from: 'library', cook: null, timer: null, modal: null } : { view: 'home' };
}

// Real data ("내 실제 데이터") sits on top of the generated demo model: same design, Supabase rows instead of samples.
// Supabase is loaded lazily so the demo keeps working even if the CDN or Supabase is unreachable.
let supabaseModule;
const loadSupabase = () => (supabaseModule ??= import('./supabase.js'));
const MODE_KEY = 'inthon-dashboard-mode';
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};
// Demo values that real-data mode replaces and must restore when switching back.
const DEMO_KEYS = ['connected', 'account', 'connectedAt', 'name', 'nameDraft', 'email', 'dataset', 'extra', 'over', 'deleted',
  'fav', 'taste', 'shares', 'simState', 'flow', 'conds', 'tasteRemoved'];
const LINK_DONE = 'Instagram 계정이 연결됐어요. 전에 보낸 콘텐츠도 함께 보여요.';

class DashboardApp extends DashboardModel {
  constructor(props) {
    super(props);
    this.demoDefaults = Object.fromEntries(DEMO_KEYS.map(key => [key, this.state[key]]));
    this.state = { ...this.state, ...routeState(location.pathname), mode: 'demo', user: null, liveItems: [],
      liveGuide: false, liveLoaded: false };
    if (this.state.detailId === 'r3') this.state.extra = [this.data().R3];
    this.onPop = () => {
      this.popping = true;
      clearInterval(this._ct);
      this.setState(routeState(location.pathname), () => { this.popping = false; });
    };
    this.onKey = event => {
      if (event.key === 'Escape') {
        if (this.state.cook) this.renderVals().closeCook();
        else this.setState({ modal: null, menuId: null, detailMenu: false, demoOpen: false, reportOpen: false });
      }
      const overlay = document.querySelector('.overlay, .cook');
      if (event.key !== 'Tab' || !overlay) return;
      const controls = [...overlay.querySelectorAll('button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),[tabindex="0"]')]
        .filter(element => element.getClientRects().length);
      const first = controls[0]; const last = controls.at(-1);
      if (!first) return;
      if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    // Coming back from Instagram (e.g. after linking on the phone) refreshes the real data.
    this.onVisible = () => { if (document.visibilityState === 'visible' && this.state.mode === 'live') this.loadLive(); };
  }
  componentDidMount() {
    addEventListener('popstate', this.onPop);
    addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisible);
    this.restoreSession();
  }
  componentDidUpdate(previousProps, previousState) {
    super.componentDidUpdate(previousProps);
    if (!this.popping && (previousState.view !== this.state.view || previousState.detailId !== this.state.detailId)) {
      const path = this.state.view === 'detail' ? '/items/' + encodeURIComponent(this.state.detailId)
        : this.state.view === 'home' ? '/dashboard' : '/' + this.state.view;
      if (location.pathname !== path) history.pushState(null, '', path);
    }
    // Favourites and taste picks have no table yet: kept per user in this browser.
    if (this.state.mode === 'live' && this.state.user) {
      if (previousState.fav !== this.state.fav) store.set('inthon-fav:' + this.state.user.id, this.state.fav);
      if (previousState.taste !== this.state.taste) store.set('inthon-taste:' + this.state.user.id, this.state.taste);
    }
    const overlay = document.querySelector('.overlay, .cook');
    if (overlay && overlay !== this.overlay) {
      this.returnFocus = document.activeElement;
      overlay.querySelector('button:not(:disabled),input:not(:disabled),a[href]')?.focus();
    } else if (!overlay && this.overlay && this.returnFocus?.isConnected) this.returnFocus.focus();
    this.overlay = overlay;
  }
  componentWillUnmount() {
    super.componentWillUnmount();
    removeEventListener('popstate', this.onPop);
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisible);
  }

  // --- real data mode -------------------------------------------------------------------------

  /** Signed-in visitors land on their own data unless they last chose a demo scenario. */
  async restoreSession() {
    let user = null;
    try { user = await (await loadSupabase()).currentUser(); } catch { return; }
    this.setState({ user });
    if (user && store.get(MODE_KEY) !== 'demo') this.enterLive();
  }

  async enterLive() {
    let auth;
    try { auth = await loadSupabase(); }
    catch { return this.toast('로그인 기능을 불러오지 못했어요. 새로고침해 주세요.'); }
    const user = this.state.user ?? await auth.currentUser();
    if (!user) {
      if (auth.inAppBrowser()) {
        return this.toast('Instagram 앱 안에서는 구글 로그인이 막혀 있어요. 외부 브라우저로 열어 주세요.', null, null, 6000);
      }
      store.set(MODE_KEY, 'live');
      const { error } = await auth.signInWithGoogle('/dashboard');
      if (error) this.toast('로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    store.set(MODE_KEY, 'live');
    clearTimeout(this._sim); clearInterval(this._ti);
    const name = displayName(user);
    this.setState({ mode: 'live', user, demoOpen: false, name, nameDraft: name, email: user.email ?? '',
      dataset: 'empty', extra: [], over: {}, deleted: {}, shares: {}, simState: 'idle', flow: 'idle', liveGuide: false,
      fav: store.get('inthon-fav:' + user.id) ?? {}, taste: store.get('inthon-taste:' + user.id) ?? {},
      conds: [], tasteRemoved: true, connected: false, account: '', connectedAt: '', libLoading: true, libError: false });
    await this.loadLive();
  }

  /** Loads the linked account and fact-check history. Resolves to false if Supabase could not be read. */
  async loadLive() {
    const { supabase } = await loadSupabase();
    const [link, rows] = await Promise.all([
      supabase.from('account_links').select('linked_at, ig_accounts(username)').maybeSingle(),
      supabase.from('factchecks').select('id, created_at, status, verdict, claim, reason, sources, dm_status, dm_sent_at')
        .order('created_at', { ascending: false }).limit(200),
    ]);
    if (this.state.mode !== 'live') return false;
    if (link.error || rows.error) {
      this.setState({ libLoading: false, libError: true });
      this.toast('내 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return false;
    }
    const next = linkState(link.data);
    const newlyLinked = next.connected && next.connectedAt !== this.state.connectedAt && this.state.liveLoaded;
    const now = new Date();
    this.setState({ ...next, liveItems: rows.data.map(row => factcheckToItem(row, now)), libLoading: false, libError: false,
      liveLoaded: true, ...(newlyLinked ? { liveGuide: false } : {}) });
    if (newlyLinked) this.toast(LINK_DONE);
    return true;
  }

  leaveLive() {
    store.set(MODE_KEY, 'demo');
    this.setState({ mode: 'demo', liveItems: [], liveLoaded: false, liveGuide: false, libLoading: false, libError: false,
      ...this.demoDefaults });
  }

  async unlinkInstagram() {
    const { supabase } = await loadSupabase();
    const { error } = await supabase.from('account_links').delete().eq('user_id', this.state.user.id);
    this.setState({ modal: null });
    if (error) return this.toast('연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.');
    this.toast('연결을 해제했어요. 기록은 지워지지 않았고, @dimi_in에 “연결”을 보내 다시 연결하면 돌아와요.');
    await this.loadLive();
  }

  async saveDisplayName() {
    const name = this.state.nameDraft.trim();
    const { supabase } = await loadSupabase();
    const { error } = await supabase.auth.updateUser({ data: { display_name: name } });
    if (error) return this.toast('이름을 저장하지 못했어요. 잠시 후 다시 시도해 주세요.');
    this.setState({ name });
    this.toast('프로필 이름을 저장했어요');
  }

  async signOut() {
    const { supabase } = await loadSupabase();
    await supabase.auth.signOut();
    this.setState({ user: null });
    this.leaveLive();
    this.go('home');
    this.toast('로그아웃했어요. 데모 화면으로 돌아왔어요.');
  }

  openBotDm() { open(BOT_DM_URL, '_blank', 'noopener'); }

  /** Real linking happens over DM: "연결" → one-time link → Google sign-in on /link. Settings shows those steps. */
  showLinkGuide() { this.go('settings', { liveGuide: true, modal: null }); }

  async checkLink() {
    const before = this.state.connectedAt;
    if (!await this.loadLive()) return;
    if (!this.state.connected) this.toast('아직 연결되지 않았어요. 링크에서 구글 로그인까지 마쳤는지 확인해 주세요.');
    else if (this.state.connectedAt === before) this.toast('연결 상태가 바뀌지 않았어요.');
  }

  // Demo scenarios always leave real-data mode first.
  setScenario(k) {
    if (this.state.mode === 'live') this.leaveLive();
    super.setScenario(k);
  }

  allItems() {
    return this.state.mode === 'live' ? this.state.liveItems : super.allItems();
  }

  renderVals() {
    const v = super.renderVals();
    const s = this.state;
    const live = s.mode === 'live';
    v.scenarios = v.scenarios.map(sc => (live ? { ...sc, dotCls: 'off' } : sc)).concat([{
      label: '내 실제 데이터',
      desc: s.user ? `${s.user.email ?? '구글 계정'} · 연결 계정과 팩트체크 기록` : '구글로 로그인하고 내 기록 보기',
      dotCls: live ? 'live' : 'off',
      pick: () => (live ? this.setState({ demoOpen: false }) : this.enterLive()),
    }]);
    return live ? applyLiveMode(v, s, this) : v;
  }
}

const response = await fetch('/data/dashboard-template.json');
if (!response.ok) throw new Error('Dashboard template unavailable');
render(h(DashboardApp, { theme: 'light', template: await response.json() }), document.getElementById('app'));
