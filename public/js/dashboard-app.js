import { h, render } from './vendor/preact.module.js';
import DashboardModel from './dashboard-model.js';

function routeState(path) {
  const view = { '/': 'home', '/home': 'home', '/dashboard': 'home', '/library': 'library', '/taste': 'taste', '/settings': 'settings' }[path];
  if (view) return { view, cook: null, timer: null, modal: null };
  const item = /^\/items\/([\w-]+)\/?$/.exec(path);
  return item ? { view: 'detail', detailId: item[1], from: 'library', cook: null, timer: null, modal: null } : { view: 'home' };
}

class DashboardApp extends DashboardModel {
  constructor(props) {
    super(props);
    this.state = { ...this.state, ...routeState(location.pathname) };
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
  }
  componentDidMount() {
    addEventListener('popstate', this.onPop);
    addEventListener('keydown', this.onKey);
  }
  componentDidUpdate(previousProps, previousState) {
    super.componentDidUpdate(previousProps);
    if (!this.popping && (previousState.view !== this.state.view || previousState.detailId !== this.state.detailId)) {
      const path = this.state.view === 'detail' ? '/items/' + encodeURIComponent(this.state.detailId) : '/' + this.state.view;
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
  }
}

render(h(DashboardApp, { theme: 'light' }), document.getElementById('app'));
