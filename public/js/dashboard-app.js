import { h, render } from './vendor/preact.module.js';
import { watchMaps } from './kakao-map.js';
import DashboardModel from './dashboard-model.js';
import { renderNodes } from './dashboard-runtime.js';
import { createMobileDashboard } from './dashboard-mobile.js';
import { applyIndexValues, matchesIndexedItem } from './dashboard-index.js';
import { applyTasteOrbitValues } from './dashboard-taste.js';
import { createCalendarDashboard } from './dashboard-calendar.js';
import { applyDmPreview } from './dm-preview.js';
import { BOT_DM_URL, ROW_SELECT, rowItems, rowIdOf, displayName, linkState, applyLiveMode } from './dashboard-live.js';
import { createMemberApi, createTasteSync } from './member-sync.js';
import { parseContentId } from './calendar-rules.js';

function routeState(path) {
  const view = { '/': 'home', '/home': 'home', '/dashboard': 'home', '/library': 'library', '/taste': 'taste', '/calendar': 'calendar', '/settings': 'settings' }[path];
  if (view) return { view, cook: null, timer: null, modal: null };
  const item = /^\/items\/([\w-]+)\/?$/.exec(path);
  return item ? { view: 'detail', detailId: item[1], from: 'library', cook: null, timer: null, modal: null } : { view: 'home' };
}

// Real data ("내 실제 데이터") sits on top of the generated demo model: same design, Supabase rows instead of samples.
// Supabase is loaded lazily so the demo keeps working even if the CDN or Supabase is unreachable.
let supabaseModule;
const loadSupabase = () => (supabaseModule ??= import('./supabase.js'));
const MODE_KEY = 'inthon-dashboard-mode';
let localStore = null; try { localStore = localStorage; } catch {}
const store = {
  get(key) { try { return JSON.parse(localStorage.getItem(key)); } catch { return null; } },
  set(key, value) { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} },
};
// Demo values that real-data mode replaces and must restore when switching back.
const DEMO_KEYS = ['connected', 'account', 'connectedAt', 'name', 'nameDraft', 'email', 'dataset', 'extra', 'over', 'deleted',
  'fav', 'taste', 'shares', 'simState', 'flow', 'conds', 'tasteRemoved'];
const LINK_DONE = 'Instagram 계정이 연결됐어요. 전에 보낸 콘텐츠도 함께 보여요.';
const activeOverlay = () => [...document.querySelectorAll('.overlay, .cook, .m .layer, .m .sheet')]
  .filter(element => element.getClientRects().length).at(-1);

class DashboardApp extends DashboardModel {
  constructor(props) {
    super(props);
    this.demoDefaults = Object.fromEntries(DEMO_KEYS.map(key => [key, this.state[key]]));
    this.state = { ...this.state, ...routeState(location.pathname), mode: 'demo', user: null, liveItems: [],
      liveGuide: false, liveLoaded: false };
    this.state.resultPreferences = { delivery: 'full', hidden: [] };
    this.state.privateAuthRequired = /^\/items\/fc[1-9]\d*(-\d+)?\/?$/.test(location.pathname);
    this.state.privateAuthChecking = this.state.privateAuthRequired;
    // Schedules (/api/calendar) and hand-picked taste (/api/taste) live on the server per member.
    this.memberApi = createMemberApi({ token: async () => (await (await loadSupabase()).supabase.auth.getSession()).data.session?.access_token });
    this.calendar = createCalendarDashboard(this, { api: this.memberApi, storage: localStore });
    this.tasteSync = createTasteSync({ api: this.memberApi, app: this, storage: localStore });
    this.referenceRequests = new Set();
    this.mobileMedia = matchMedia('(max-width: 767px)');
    this.state.mobile = this.mobileMedia.matches;
    this.mobileValues = createMobileDashboard(this);
    this.onMobileChange = event => this.setState({ mobile: event.matches });
    if (this.state.detailId === 'r3') this.state.extra = [this.data().R3];
    this.onPop = () => {
      this.popping = true;
      clearInterval(this._ct);
      this.setState(routeState(location.pathname), () => { this.popping = false; });
    };
    this.onKey = event => {
      if (this.state.privateAuthRequired) return;
      const menu = document.activeElement?.closest('.menu[role="menu"]');
      if (menu && ['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
        const items = [...menu.querySelectorAll('[role="menuitem"]')];
        const index = items.indexOf(document.activeElement);
        const next = event.key === 'Home' ? 0 : event.key === 'End' ? items.length - 1 : (index + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length;
        event.preventDefault(); items[next]?.focus(); return;
      }
      if (event.key === 'Escape') {
        if (this.state.view === 'calendar' && (this.calendar.model.state.modal || this.calendar.model.state.viewItem)) this.calendar.close();
        else if (this.state.cook) this.renderVals().closeCook();
        else if (this.state.mobile && ['detail', 'settings'].includes(this.state.view)) this.go(this.state.from || 'library', { liveGuide: false });
        else this.setState({ modal: null, menuId: null, detailMenu: false, demoOpen: false, reportOpen: false });
      }
      const overlay = activeOverlay();
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
    this.onOutsideMenu = event => {
      if ((this.state.menuId || this.state.detailMenu) && !event.target.closest('.menu,[aria-label="더보기"]')) this.setState({ menuId: null, detailMenu: false });
    };
    this.positionMenu = () => {
      const menu = document.querySelector('.app .menu[popover]');
      if (!menu?.showPopover) return;
      const opener = (menu.closest('.row') ?? menu.parentElement).querySelector('button[aria-expanded="true"]');
      if (!opener) return;
      const opened = !menu.matches(':popover-open');
      if (opened) { this.menuOpener = opener; menu.showPopover(); }
      menu.style.inset = 'auto';
      const rect = opener.getBoundingClientRect();
      const top = rect.bottom + menu.offsetHeight + 8 <= innerHeight ? rect.bottom + 4 : rect.top - menu.offsetHeight - 4;
      Object.assign(menu.style, { left: Math.max(8, Math.min(rect.right - menu.offsetWidth, innerWidth - menu.offsetWidth - 8)) + 'px', top: Math.max(8, top) + 'px' });
      if (opened) menu.querySelector('[role="menuitem"]')?.focus();
    };
  }
  componentDidMount() {
    this.mobileMedia.addEventListener('change', this.onMobileChange);
    addEventListener('popstate', this.onPop);
    addEventListener('keydown', this.onKey);
    document.addEventListener('visibilitychange', this.onVisible);
    document.addEventListener('pointerdown', this.onOutsideMenu);
    document.addEventListener('scroll', this.positionMenu, true);
    addEventListener('resize', this.positionMenu);
    this.restoreSession();
  }
  componentDidUpdate(previousProps, previousState) {
    super.componentDidUpdate(previousProps);
    if (previousState.view === 'calendar' && this.state.view !== 'calendar') this.calendar.close();
    this.positionMenu();
    if (this.state.mode === 'live' && previousState.view !== 'taste' && this.state.view === 'taste') this.loadInterests();
    if ((previousState.menuId || previousState.detailMenu) && !this.state.menuId && !this.state.detailMenu) this.menuOpener?.focus();
    if (!this.popping && (previousState.view !== this.state.view || previousState.detailId !== this.state.detailId)) {
      const path = this.state.view === 'detail' ? '/items/' + encodeURIComponent(this.state.detailId)
        : this.state.view === 'home' ? '/dashboard' : '/' + this.state.view;
      if (location.pathname !== path) history.pushState(null, '', path);
    }
    // Favourites have no table yet (kept per user in this browser); taste picks are mirrored to the server card by card.
    if (this.state.mode === 'live' && this.state.user) {
      if (previousState.fav !== this.state.fav) store.set('inthon-fav:' + this.state.user.id, this.state.fav);
      if (previousState.taste !== this.state.taste && previousState.user?.id === this.state.user.id) this.tasteSync.changed(previousState.taste, this.state.taste);
    }
    const overlay = activeOverlay();
    if (overlay && overlay !== this.overlay) {
      this.returnFocus = document.activeElement;
      overlay.querySelector('button:not(:disabled),input:not(:disabled),a[href]')?.focus({ preventScroll: true });
    } else if (!overlay && this.overlay && this.returnFocus?.isConnected) this.returnFocus.focus({ preventScroll: true });
    this.overlay = overlay;
  }
  componentWillUnmount() {
    this.searchController?.abort();
    this.mobileMedia.removeEventListener('change', this.onMobileChange);
    super.componentWillUnmount();
    removeEventListener('popstate', this.onPop);
    removeEventListener('keydown', this.onKey);
    document.removeEventListener('visibilitychange', this.onVisible);
    document.removeEventListener('pointerdown', this.onOutsideMenu);
    document.removeEventListener('scroll', this.positionMenu, true);
    removeEventListener('resize', this.positionMenu);
  }

  // --- real data mode -------------------------------------------------------------------------

  /** Signed-in visitors always land on their own data. */
  async restoreSession() {
    try {
      const user = await (await loadSupabase()).currentUser();
      this.setState({ user });
      if (user) {
        await this.enterLive();
        this.setState({ privateAuthRequired: false });
      }
    } catch {
      if (this.state.privateAuthRequired) this.setState({ privateLoginHint: '로그인 상태를 확인하지 못했어요. 새로고침 후 다시 시도해 주세요.' });
    } finally {
      if (this.state.privateAuthChecking) this.setState({ privateAuthChecking: false });
    }
  }

  async loginForResult() {
    if (this.state.privateLoginBusy || this.state.privateAuthChecking) return;
    this.setState({ privateLoginBusy: true, privateLoginHint: '' });
    try {
      const auth = await loadSupabase();
      const { error } = await auth.signInWithGoogle(location.pathname);
      if (error) throw error;
    } catch { this.setState({ privateLoginBusy: false, privateLoginHint: '로그인을 시작하지 못했어요. 잠시 후 다시 시도해 주세요.' }); }
  }

  render() {
    if (!this.state.privateAuthRequired) return this.state.mobile
      ? renderNodes(this.props.mobileTemplate, this.mobileValues(), this.state) : super.render();
    const busy = this.state.privateAuthChecking || this.state.privateLoginBusy;
    return h('div', { class: 'app result-access-page' },
      h('header', { class: 'result-access-header' },
        h('a', { class: 'result-access-brand', href: '/', 'aria-label': '디미 홈으로' },
          h('img', { src: '/assets/dimi-icon.svg', alt: '', width: 28, height: 28 }), '디미')),
      h('main', { class: 'result-access-main' },
        h('section', { class: 'result-access-content', 'aria-labelledby': 'result-access-title' },
          h('img', { class: 'result-access-orb', src: '/assets/dimi-icon.svg', alt: '', width: 64, height: 64 }),
          h('h1', { id: 'result-access-title' }, '정리한 콘텐츠를 이어서 보세요'),
          h('p', { class: 'result-access-description' }, '콘텐츠를 보낸 계정으로 로그인하면', h('br'), '디미가 정리한 내용을 확인할 수 있어요.'),
          h('button', { type: 'button', class: 'result-access-google', disabled: busy, 'aria-busy': !!busy, onClick: () => this.loginForResult() },
            h('svg', { viewBox: '0 0 24 24', width: 20, height: 20, 'aria-hidden': 'true', focusable: 'false' },
              h('path', { fill: '#4285F4', d: 'M21.6 12.23c0-.71-.06-1.39-.18-2.05H12v3.88h5.38a4.6 4.6 0 0 1-2 3.02v2.51h3.24c1.9-1.75 2.98-4.33 2.98-7.36Z' }),
              h('path', { fill: '#34A853', d: 'M12 22c2.7 0 4.96-.9 6.62-2.41l-3.24-2.51c-.9.6-2.05.97-3.38.97-2.6 0-4.82-1.76-5.62-4.12H3.04v2.59A10 10 0 0 0 12 22Z' }),
              h('path', { fill: '#FBBC05', d: 'M6.38 13.93a6 6 0 0 1 0-3.86V7.48H3.04a10 10 0 0 0 0 9.04l3.34-2.59Z' }),
              h('path', { fill: '#EA4335', d: 'M12 5.95c1.47 0 2.78.5 3.82 1.49l2.86-2.87A9.58 9.58 0 0 0 12 2a10 10 0 0 0-8.96 5.48l3.34 2.59A5.97 5.97 0 0 1 12 5.95Z' })),
            this.state.privateAuthChecking ? '로그인 확인 중…' : this.state.privateLoginBusy ? '로그인 페이지로 이동 중…' : 'Google로 로그인하고 보기'),
          this.state.privateLoginHint && h('p', { class: 'result-access-error', role: 'alert' }, this.state.privateLoginHint),
          h('p', { class: 'result-access-secondary' }, '디미가 처음이신가요?', h('a', { href: '/register' }, '시작하기')),
          h('p', { class: 'result-access-privacy' }, '결과는 로그인한 본인만 볼 수 있어요.'))),
      h('footer', { class: 'result-access-footer' }, '당신의 가장 가까운 비서 디미'));
  }

  async enterLive() {
    let auth;
    try { auth = await loadSupabase(); }
    catch { return this.toast('로그인 기능을 불러오지 못했어요. 새로고침해 주세요.'); }
    const user = this.state.user ?? await auth.currentUser();
    if (!user) {
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
      fav: store.get('inthon-fav:' + user.id) ?? {}, taste: {}, tasteLoaded: false, refItems: [],
      conds: [], tasteRemoved: false, connected: false, account: '', connectedAt: '', libLoading: true, libError: false,
      semanticSearch: null, indexInterests: [], searchNote: '', searchBusy: false });
    this.tasteSync.reset(); this.referenceRequests.clear();
    if (await this.loadLive()) this.loadTaste();
  }

  /** Server taste picks (and a one-time move of this browser's old picks). Old cards outside the latest 200 are fetched. */
  async loadTaste() {
    try {
      const ids = await this.tasteSync.load();
      if (ids) this.ensureReferences(ids);
    } catch (error) {
      if (this.state.mode === 'live') this.toast(error?.status === 401 ? '로그인이 만료됐어요. 다시 로그인해 주세요.' : '내 취향을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
    }
  }

  /**
   * Schedules and taste may point at results older than the latest 200 the list loads. Those rows are read with the
   * member's own permissions (RLS) and converted exactly like the list; inaccessible ones simply never appear.
   */
  async ensureReferences(ids) {
    if (this.state.mode !== 'live') return;
    const known = new Set([...this.state.liveItems, ...(this.state.refItems || [])].map(item => item.id));
    const rows = [...new Set(ids.filter(id => !known.has(id)).map(id => parseContentId(id)?.factcheckId).filter(Boolean))]
      .filter(row => !this.referenceRequests.has(row));
    if (!rows.length) return;
    rows.forEach(row => this.referenceRequests.add(row));
    const uid = this.state.user?.id;
    try {
      const { supabase } = await loadSupabase();
      const now = new Date(); const found = [];
      for (let i = 0; i < rows.length; i += 50) {
        const { data, error } = await supabase.from('factchecks').select(ROW_SELECT).in('id', rows.slice(i, i + 50)).eq('status', 'done');
        if (error) throw error;
        found.push(...data.flatMap(row => rowItems(row, now)));
      }
      if (this.state.mode !== 'live' || this.state.user?.id !== uid) return;
      const have = new Set([...this.state.liveItems, ...this.state.refItems].map(item => item.id));
      this.setState({ refItems: [...this.state.refItems, ...found.filter(item => !have.has(item.id))] });
    } catch { rows.forEach(row => this.referenceRequests.delete(row)); }
  }

  /** Loads the linked account and fact-check history. Resolves to false if Supabase could not be read. */
  async loadLive() {
    const { supabase } = await loadSupabase();
    let results;
    try { results = await Promise.all([
      supabase.from('account_links').select('linked_at, ig_accounts(username)').maybeSingle(),
      supabase.from('factchecks').select(ROW_SELECT)
        .eq('status', 'done').order('created_at', { ascending: false }).limit(200),
      this.resultSettings(),
    ]); } catch {
      this.setState({ libLoading: false, libError: true });
      this.toast('내 기록과 설정을 불러오지 못했어요. 다시 시도해 주세요.');
      return false;
    }
    const [link, rows, preferences] = results;
    if (this.state.mode !== 'live') return false;
    if (link.error || rows.error) {
      this.setState({ libLoading: false, libError: true });
      this.toast('내 기록을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.');
      return false;
    }
    const next = linkState(link.data);
    const newlyLinked = next.connected && next.connectedAt !== this.state.connectedAt && this.state.liveLoaded;
    const now = new Date();
    const liveItems = rows.data.flatMap(row => rowItems(row, now));
    const listed = new Set(liveItems.map(item => item.id));
    this.setState({ ...next, liveItems, refItems: (this.state.refItems || []).filter(item => !listed.has(item.id)), resultPreferences: preferences,
      dmMode: preferences.delivery, libLoading: false, libError: false,
      liveLoaded: true, ...(newlyLinked ? { liveGuide: false } : {}) });
    if (newlyLinked) this.toast(LINK_DONE);
    if (this.state.view === 'taste') this.loadInterests();
    return true;
  }

  async resultSettings(update = {}) {
    const { supabase } = await loadSupabase();
    const { data } = await supabase.auth.getSession();
    const response = await fetch('/api/instagram-link', { method: 'POST', headers: {
      'Content-Type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token ?? ''),
    }, body: JSON.stringify({ action: 'preferences', ...update }) });
    if (!response.ok) throw new Error('Preferences unavailable');
    return response.json();
  }

  matchesContent(item, query) { return matchesIndexedItem(item, query, this.state); }

  async indexRequest(body, signal) {
    const { supabase } = await loadSupabase();
    const { data } = await supabase.auth.getSession();
    const response = await fetch('/api/content-search', { method: 'POST', signal,
      headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + (data.session?.access_token || '') }, body: JSON.stringify(body) });
    if (!response.ok) throw new Error('Index unavailable');
    return response.json();
  }

  async searchContents() {
    const query = this.state.query.trim();
    if (!query || this.state.mode !== 'live' || this.state.searchBusy) return;
    this.searchController?.abort(); this.searchController = new AbortController();
    const uid = this.state.user?.id;
    this.setState({ searchBusy: true, searchNote: '' });
    try {
      const result = await this.indexRequest({ action: 'search', query }, this.searchController.signal);
      if (this.state.mode !== 'live' || this.state.user?.id !== uid || this.state.query.trim() !== query) return;
      this.setState({ semanticSearch: { query, ids: result.ids }, indexInterests: result.interests,
        searchNote: result.rankedBy === 'decisions' ? '콘텐츠의 의미를 살펴 정렬했어요.' : '저장된 색인으로 찾았어요. 의미 검색은 잠시 이용할 수 없어요.' });
    } catch (error) { if (error.name !== 'AbortError') this.setState({ searchNote: '의미 검색을 마치지 못했어요. 저장된 텍스트로 검색하고 있어요.' }); }
    finally { this.setState({ searchBusy: false }); }
  }

  async loadInterests() {
    if (this.loadingInterests || this.state.mode !== 'live') return;
    this.loadingInterests = true; const uid = this.state.user?.id;
    this.setState({ interestState: 'loading' });
    try {
      const result = await this.indexRequest({ action: 'interests' });
      if (this.state.mode === 'live' && this.state.user?.id === uid) this.setState({ indexInterests: result.interests, interestIds: result.ids, interestState: 'ready' });
    } catch { if (this.state.user?.id === uid) this.setState({ interestState: 'error' }); }
    finally { this.loadingInterests = false; }
  }

  async changeDelivery(delivery) {
    if (this.savingDelivery) return;
    this.savingDelivery = true;
    try {
      const resultPreferences = await this.resultSettings({ delivery });
      this.setState({ resultPreferences, dmMode: resultPreferences.delivery });
      this.toast('앞으로 받을 결과에 적용했어요');
    } catch { this.toast('받는 방식을 저장하지 못했어요. 다시 시도해 주세요.'); }
    finally { this.savingDelivery = false; }
  }

  async removeItem(id, hidden = true) {
    // Events from one exhibition post share their stored row, so hiding one hides the post.
    id = rowIdOf(id);
    if (!/^fc[1-9]\d*$/.test(id ?? '') || this.removingItem) return;
    this.removingItem = true;
    try {
      const resultPreferences = await this.resultSettings({ item: id, hidden });
      this.setState({ resultPreferences, modal: null, delTarget: null, ...(hidden && rowIdOf(this.state.detailId) === id ? { view: 'library', detailId: null } : {}) });
      this.toast(hidden ? '내 목록에서 삭제했어요' : '목록에 복원했어요', hidden ? '되돌리기' : null, hidden ? () => this.removeItem(id, false) : null);
      this.loadInterests();
    } catch { this.toast('목록을 변경하지 못했어요. 다시 시도해 주세요.'); }
    finally { this.removingItem = false; }
  }

  leaveLive() {
    this.searchController?.abort();
    this.tasteSync.reset(); this.referenceRequests.clear();
    store.set(MODE_KEY, 'demo');
    this.setState({ mode: 'demo', liveItems: [], refItems: [], tasteLoaded: false, liveLoaded: false, liveGuide: false, libLoading: false, libError: false, semanticSearch: null, indexInterests: [], interestIds: [],
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
  openExternal(url) { open(url, '_blank', 'noopener'); }

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
    if (this.state.mode !== 'live') return super.allItems();
    // Latest 200 first, then older cards that a schedule or taste pick refers to.
    return [...this.state.liveItems, ...(this.state.refItems || [])].filter(item => !this.state.resultPreferences.hidden.includes(item.rowId ?? item.id));
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
    Object.assign(v, this.pageValues());
    return applyDmPreview(applyTasteOrbitValues(live ? applyIndexValues(applyLiveMode(v, s, this), s, this) : v, s, this), s, this);
  }
  pageValues() {
    const isCalendar = this.state.view === 'calendar';
    const active = isCalendar || (this.state.view === 'detail' && this.state.from === 'calendar');
    return { isCalendar, notCalendar: !isCalendar, navCalendar: (this.state.mobile ? 'tab' : 'nav-item') + (active ? ' on' : ''),
      goCalendar: () => this.go('calendar'), calendar: isCalendar ? this.calendar.values(this.state.mobile) : {},
      ...(active ? { navLib: 'nav-item' } : {}),
      ...(isCalendar ? { crumbRoot: '캘린더', hasCrumbLeaf: false, tabTitle: '캘린더' } : {}) };
  }
}

const [response, mobileResponse] = await Promise.all([fetch('/data/dashboard-template.json'), fetch('/data/mobile-template.json')]);
if (!response.ok) throw new Error('Dashboard template unavailable');
if (!mobileResponse.ok) throw new Error('Mobile dashboard template unavailable');
render(h(DashboardApp, { theme: 'light', template: await response.json(), mobileTemplate: await mobileResponse.json() }), document.getElementById('app'));

// Kakao maps for detail pages (desktop and mobile). The SDK loads only when a detail with a place is shown.
watchMaps(document.getElementById('app'));
