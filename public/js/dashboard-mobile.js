import MobileModel from './mobile-model.js';
import { applyIndexValues, matchesIndexedItem } from './dashboard-index.js';
import { applyTasteOrbitValues } from './dashboard-taste.js';
import { applyDmPreview } from './dm-preview.js';

// The supplied mobile view shares the existing app's data, authentication and actions.
export function createMobileDashboard(app) {
  const mobile = new MobileModel({ theme: 'light' });
  mobile.matchesContent = (item, query) => matchesIndexedItem(item, query, app.state);
  const defaults = mobile.state;
  const sync = () => {
    const s = app.state;
    mobile.state = { ...defaults, ...s, tab: ['home', 'library', 'taste', 'calendar'].includes(s.view) ? s.view : (s.from || 'home'),
      detailId: s.view === 'detail' ? s.detailId : null, settingsOpen: s.view === 'settings', sortNew: s.sort !== 'old' };
    mobile._data = { ITEMS: app.allItems() };
  };
  mobile.setState = update => {
    sync();
    const next = typeof update === 'function' ? update(mobile.state) : update;
    const patch = { ...next };
    if ('sortNew' in patch) { patch.sort = patch.sortNew ? 'new' : 'old'; delete patch.sortNew; }
    if ('tab' in patch) { patch.view = patch.tab; patch.detailId = null; delete patch.tab; }
    if ('settingsOpen' in patch) { patch.view = patch.settingsOpen ? 'settings' : mobile.state.tab; delete patch.settingsOpen; }
    if ('detailId' in next) {
      patch.view = next.detailId ? 'detail' : (app.state.from || 'library');
      if (next.detailId && app.state.view !== 'detail') patch.from = app.state.view;
    }
    app.setState(patch);
  };
  mobile.toast = (...args) => app.toast(...args);
  for (const action of ['cookGo', 'cookNext', 'cookPrev', 'timerToggle', 'secsOf']) mobile[action] = (...args) => app[action](...args);

  return () => {
    sync();
    const s = app.state; const live = s.mode === 'live';
    const v = mobile.renderVals();
    Object.assign(v, app.pageValues?.());
    applyTasteOrbitValues(v, s, app);
    applyDmPreview(v, s, app);
    v.d.hasTips = Array.isArray(v.d.tips) && v.d.tips.length > 0;
    v.d.hasComparisons = Array.isArray(v.d.cmp) && v.d.cmp.length > 0;
    v.d.showExtraTasteAction = v.d.tasteable && (v.d.isContest || v.d.isRestaurant || v.d.isSpace);
    Object.assign(v, {
      isLive: live, modeLabel: live ? '내 데이터' : 'DEMO', modeAction: live ? '내 데이터 새로고침' : '로그인하고 내 기록 보기',
      toggleDataMode: () => live ? app.loadLive() : app.enterLive(),
      profileName: s.name, profileInitial: (s.name || '나').slice(0, 1), profileEmail: live ? s.email + ' · Google' : '데모 계정',
      profileHandle: s.connected ? s.account : 'Instagram 미연결', connectionLabel: s.connected ? '연결됨' : '미연결',
      connectionNote: s.connected ? 'DM으로 확인된 계정 · ' + s.connectedAt + ' 연결' : 'Instagram 계정에서 보낸 콘텐츠를 내 기록에 연결해요.',
      greeting: '안녕하세요, ' + s.name + '님', showConnected: s.connected && !s.liveGuide,
      showLinkGuide: live && (!s.connected || !!s.liveGuide),
      linkGuide: '@dimi_in에 ‘연결’을 보내고 답장 링크에서 이 Google 계정으로 로그인해 주세요.',
      refreshLink: () => app.checkLink(), sendFromIg: () => app.openBotDm(),
      hasSchedule: !live && v.schedule.length > 0, homeEmpty: v.recentItems.length === 0,
      homeEmptyTitle: s.libError ? '내 기록을 불러오지 못했어요' : s.libLoading ? '내 기록을 불러오고 있어요' : '아직 정리한 콘텐츠가 없어요',
      homeEmptyDesc: s.libError ? '잠시 후 다시 불러와 주세요.' : 'Instagram에서 @dimi_in에 콘텐츠를 보내고 정리 방식을 골라 주세요.',
      homeEmptyCta: s.libError ? '다시 불러오기' : 'Instagram에서 보내기',
      homeEmptyAction: () => s.libError ? app.loadLive() : app.openBotDm(),
      resultLinkLabel: live ? '개인 결과 링크 복사' : '공유',
      openShare: () => app.copy(`${globalThis.location?.origin ?? ''}/items/${encodeURIComponent(s.detailId)}`,
        live ? '개인 결과 주소를 복사했어요. 로그인한 본인만 열 수 있어요.' : '데모 결과 주소를 복사했어요.'),
      removeCurrent: () => app.removeItem(s.detailId),
      missingDetail: s.view === 'detail' && !v.hasDetail,
    });
    if (!live) return v;
    if (s.libLoading || s.libError || !v.isFiltered) {
      v.emptyTitle = s.libError ? '내 기록을 불러오지 못했어요' : s.libLoading ? '내 기록을 불러오고 있어요' : '아직 정리한 콘텐츠가 없어요';
      v.emptyDesc = s.libError ? '잠시 후 다시 불러와 주세요.' : 'Instagram에서 @dimi_in에 콘텐츠를 보내고 정리 방식을 골라 주세요.';
    }
    Object.assign(v, {
      schedule: [], tasteShowCard: false,
      dmModes: [['summary', '핵심 안내와 고유 링크', 'DM으로 안내를 받고, 자세한 정리는 개인 결과 페이지에서 봐요.'],
        ['full', 'DM에서 전체 보기', '기본 · 정리한 내용을 DM으로 받아요. 긴 내용은 나눠서 보내요.']].map(([key, label, desc]) => ({
          label, desc, checked: s.dmMode === key ? 'true' : 'false', cls: 'radio-card' + (s.dmMode === key ? ' on' : ''), pick: () => app.changeDelivery(key),
        })),
      changeAccount: () => app.setState({ liveGuide: true }),
      disconnect: () => app.toast('해제하면 이 계정의 기록이 보이지 않아요.', '연결 해제', () => app.unlinkInstagram(), 6000),
      logout: () => app.signOut(),
    });
    for (const action of ['requestProcess', 'editTaste', 'withdraw']) v[action] = () => app.toast('실제 데이터에서는 아직 준비 중인 기능이에요.');
    if (v.d.isNews) {
      v.d.cmpSummary = v.d.sourceCount ? '' : '확보한 근거 자료가 없어요';
      // The real fact-check has one verdict and cited sources, not fabricated per-claim comparisons.
      v.d.cmp = [];
      v.d.hasComparisons = false;
      v.d.oneLine = v.d.reason || v.d.oneLine;
    }
    return applyIndexValues(v, s, app);
  };
}
