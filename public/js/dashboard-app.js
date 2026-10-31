import { h, render } from './vendor/preact.module.js';
import DashboardModel from './dashboard-model.js';
import { BOT_DM_URL, factcheckToItem, displayName, linkState } from './dashboard-live.js';

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
const rememberMode = mode => { try { localStorage.setItem(MODE_KEY, mode); } catch {} };
const storedMode = () => { try { return localStorage.getItem(MODE_KEY); } catch { return null; } };
const DEMO_KEYS = ['connected', 'account', 'connectedAt', 'name', 'nameDraft', 'dataset', 'extra', 'over', 'deleted',
  'fav', 'taste', 'shares', 'simState', 'flow'];
// Demo-only interactions that have no backend yet; in real-data mode they explain that instead of pretending.
const NOT_YET = ['openShare', 'requestProcess', 'sendReport', 'fbUp', 'fbDown', 'askWithdraw', 'saveName', 'confirmDelete'];

class DashboardApp extends DashboardModel {
  constructor(props) {
    super(props);
    this.demoDefaults = Object.fromEntries(DEMO_KEYS.map(key => [key, this.state[key]]));
    this.state = { ...this.state, ...routeState(location.pathname), mode: 'demo', user: null, liveItems: [] };
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
    if (user && storedMode() !== 'demo') this.enterLive();
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
      rememberMode('live');
      const { error } = await auth.signInWithGoogle('/dashboard');
      if (error) this.toast('로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.');
      return;
    }
    rememberMode('live');
    clearTimeout(this._sim); clearInterval(this._ti);
    const name = displayName(user);
    this.setState({ mode: 'live', user, demoOpen: false, name, nameDraft: name, dataset: 'empty', extra: [], over: {},
      deleted: {}, shares: {}, simState: 'idle', flow: 'idle', libLoading: true, libError: false });
    await this.loadLive();
  }

  async loadLive() {
    const { supabase } = await loadSupabase();
    const [link, rows] = await Promise.all([
      supabase.from('account_links').select('linked_at, ig_accounts(username)').maybeSingle(),
      supabase.from('factchecks').select('id, created_at, status, verdict, claim, reason, sources, dm_status, dm_sent_at')
        .order('created_at', { ascending: false }).limit(200),
    ]);
    if (this.state.mode !== 'live') return;
    if (link.error || rows.error) {
      this.setState({ libLoading: false, libError: true });
      return this.toast('내 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
    const now = new Date();
    this.setState({ ...linkState(link.data), liveItems: rows.data.map(row => factcheckToItem(row, now)),
      libLoading: false, libError: false });
  }

  leaveLive() {
    rememberMode('demo');
    this.setState({ mode: 'demo', liveItems: [], libLoading: false, libError: false, ...this.demoDefaults });
  }

  async unlinkInstagram() {
    const { supabase } = await loadSupabase();
    const { error } = await supabase.from('account_links').delete().eq('user_id', this.state.user.id);
    this.setState({ modal: null });
    if (error) return this.toast('연결을 해제하지 못했어요. 잠시 후 다시 시도해 주세요.');
    this.toast('연결을 해제했어요. 다시 연결하려면 @dimi_in에 “연결”을 보내 주세요.');
    await this.loadLive();
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

  linkGuide() {
    this.setState({ modal: null, flow: 'idle' });
    this.toast('Instagram에서 @dimi_in에 “연결”이라고 보내면 연결 링크가 와요.', 'DM 열기', () => this.openBotDm(), 8000);
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
    if (!live) return v;

    v.scenarioLabel = '내 실제 데이터';
    v.simulateDm = () => {}; v.simDisabled = true; v.simHint = '데모 시나리오에서만 쓸 수 있어요';
    v.sendFromIg = () => this.openBotDm();
    v.emptyCta = s.connected ? () => this.openBotDm() : () => this.go('settings');
    v.startCode = () => this.linkGuide();
    v.askChange = () => this.linkGuide();
    v.openIgDm = () => this.openBotDm();
    v.confirmConnModal = () => (s.connModal === 'disconnect' ? this.unlinkInstagram() : this.linkGuide());
    v.logout = () => this.signOut();
    v.reloadLib = () => { this.setState({ libLoading: true, libError: false }); this.loadLive(); };
    v.copyPrivateLink = () => {
      this.setState({ detailMenu: false });
      this.copy(location.origin + '/items/' + encodeURIComponent(s.detailId ?? ''), '개인 결과 주소를 복사했어요. 로그인한 본인만 열 수 있어요.');
    };
    for (const name of NOT_YET) {
      v[name] = () => {
        this.setState({ modal: null, detailMenu: false, reportOpen: false });
        this.toast('실제 데이터에서는 아직 준비 중인 기능이에요.');
      };
    }
    return v;
  }
}

const response = await fetch('/data/dashboard-template.json');
if (!response.ok) throw new Error('Dashboard template unavailable');
render(h(DashboardApp, { theme: 'light', template: await response.json() }), document.getElementById('app'));
