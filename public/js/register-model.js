import { DCLogic } from './dashboard-runtime.js';

export default class RegisterModel extends DCLogic {
  constructor(props) {
    super(props); this.services = props.services; this._timers = []; this._run = 0;
    this.state = this.initialState();
  }
  errorText(error) { return /[가-힣]/.test(error?.message || '') ? error.message : '연결을 확인하지 못했어요. 잠시 후 다시 시도해 주세요.'; }
  initialState() { return { msgs: [], typing: false, step: 'intro', stage: 0, name: '', age: '', nameDraft: '', ageDraft: '', ageError: false, seq: 0, cheer: false, handleDraft: '', linkCode: '', linkBusy: false, error: '', linkNotice: '', copied: false }; }
  componentDidMount() { this.onFocus = () => this.checkLink(false); addEventListener('focus', this.onFocus); this.start(); }
  componentWillUnmount() { this._run++; this.stopPoll(); this._timers.forEach(clearTimeout); removeEventListener('focus', this.onFocus); }
  componentDidUpdate() { if (this._list) this._list.scrollTop = this._list.scrollHeight; }
  later(fn, ms) { const t = setTimeout(fn, ms); this._timers.push(t); }
  push(from, text) { this.setState(s => ({ msgs: s.msgs.concat([{ id: s.seq + 1, from, text }]), seq: s.seq + 1 })); }
  botSay(texts, next) {
    const run = i => {
      if (i >= texts.length) { this.setState(Object.assign({ typing: false }, next || {})); return; }
      this.setState({ typing: true });
      this.later(() => { this.setState({ typing: false }); this.push('bot', texts[i]); this.later(() => run(i + 1), 260); }, 750 + Math.min(texts[i].length * 12, 600));
    };
    this.setState({ step: 'wait' }); run(0);
  }
  async start() {
    const run = ++this._run; this.stopPoll(); this._timers.forEach(clearTimeout); this._timers = [];
    this.setState(this.initialState());
    try {
      const user = await this.services.user(); if (run !== this._run) return;
      if (!user) return this.botSay(['안녕하세요! 당신의 가장 가까운 비서, 디미예요.', '먼저 Google 계정으로 로그인해 주세요.'], { step: 'google' });
      this.push('me', 'Google 계정으로 로그인했어요' + (user.email ? ' · ' + user.email : ''));
      this.setState({ stage: 1, nameDraft: [user.user_metadata?.display_name, user.user_metadata?.full_name, user.user_metadata?.name].find(v => typeof v === 'string' && v.trim()) || '' });
      const status = await this.services.status(); if (run !== this._run) return;
      if (status.status === 'linked') return this.linked(status.username);
      if (status.status === 'pending') this.setState({ handleDraft: status.username, linkCode: status.code });
      this.botSay(['Instagram 아이디를 입력해 주세요.', '발급받은 인증번호를 그 계정에서 @dimi_in에게 DM으로 보내면 연결돼요.'], { step: 'instagram' });
      if (status.status === 'pending') this.startPoll();
    } catch (e) { if (run === this._run) this.setState({ step: 'google', error: this.errorText(e) }); }
  }
  async googleLogin() {
    if (this.state.step !== 'google') return;
    this.setState({ step: 'googleBusy', error: '' });
    try { await this.services.login(); }
    catch (e) { this.setState({ step: 'google', error: this.errorText(e) }); }
  }
  async issueCode() {
    if (this.state.linkBusy || this.state.step !== 'instagram') return;
    this.setState({ linkBusy: true, error: '' }); const run = this._run;
    try {
      const result = await this.services.issue(this.state.handleDraft);
      if (run !== this._run) return;
      this.setState({ handleDraft: result.username, linkCode: result.code, copied: false, linkNotice: 'DM 인증을 기다리고 있어요.' });
      this.startPoll();
    } catch (e) { if (run === this._run) this.setState({ error: this.errorText(e) }); }
    finally { if (run === this._run) this.setState({ linkBusy: false }); }
  }
  startPoll() { this.stopPoll(); this._poll = setInterval(() => this.checkLink(false), 5000); }
  stopPoll() { clearInterval(this._poll); }
  async checkLink(manual = true) {
    if (this._checking || this.state.step !== 'instagram' || !this.state.linkCode) return;
    this._checking = true; const run = this._run;
    try {
      const result = await this.services.status(); if (run !== this._run) return;
      if (result.status === 'linked') this.linked(result.username);
      else if (result.status === 'expired' || result.status === 'none') {
        this.stopPoll(); this.setState({ linkCode: '', error: '인증번호가 만료됐어요. 새 번호를 받아 주세요.', linkNotice: '' });
      } else if (manual) this.setState({ linkNotice: '아직 DM이 확인되지 않았어요. 입력한 계정에서 인증번호만 보내 주세요.' });
    } catch (e) { if (run === this._run && manual) this.setState({ error: this.errorText(e) }); }
    finally { this._checking = false; }
  }
  linked(username) {
    this.stopPoll(); this.setState({ stage: 2, error: '', linkNotice: '' });
    this.botSay(['@' + username + ' 계정이 연결됐어요!', '뭐라고 불러드리면 될까요?'], { step: 'name' });
  }
  async copyCode() {
    try { await this.services.copy(this.state.linkCode); this.setState({ copied: true, error: '' }); }
    catch { this.setState({ error: '자동 복사를 못했어요. 인증번호를 직접 선택해 복사해 주세요.' }); }
  }
  changeHandle() { this._run++; this.stopPoll(); this.setState({ linkCode: '', error: '', linkNotice: '', copied: false, linkBusy: false }); }
  submitName() {
    const v = this.state.nameDraft.trim(); if (!v || this.state.step !== 'name') return;
    this.setState({ name: v, nameDraft: '', stage: 3 }); this.push('me', v);
    this.botSay([v + '님, 반가워요!', '마지막으로 나이를 알려주세요. 건너뛰어도 괜찮아요.'], { step: 'age' });
  }
  submitAge() {
    const raw = String(this.state.ageDraft).trim(); const n = Number(raw);
    if (this.state.step !== 'age') return;
    if (!raw || !Number.isInteger(n) || n < 1 || n > 120) return this.setState({ ageError: true });
    this.push('me', n + '살');
    if (n < 14) return this.blockMinor();
    this.setState({ age: String(n), ageDraft: '', ageError: false }); this.finish(String(n));
  }
  // Under 14: no signup. The account and everything linked so far are deleted, as the privacy policy promises.
  async blockMinor() {
    const run = this._run; this.stopPoll(); this.setState({ step: 'saving', ageDraft: '', ageError: false, error: '' });
    let deleted = true;
    try { await this.services.deleteAccount(); } catch (e) { deleted = false; }
    if (run !== this._run) return;
    this.botSay(['만 14세 미만은 디미에 가입할 수 없어요.', deleted
      ? 'Google 계정 정보와 연결한 Instagram 계정 정보를 모두 삭제했어요.'
      : '정보를 삭제하지 못했어요. contact@yeoziphab.com으로 알려 주시면 바로 삭제할게요.'], { step: 'blocked' });
  }
  skipAge() { if (this.state.step !== 'age') return; this.setState({ age: '', ageDraft: '', ageError: false }); this.push('me', '나이는 건너뛸게요'); this.finish(''); }
  async finish(age) {
    this.setState({ step: 'saving', error: '' }); const run = this._run;
    try {
      await this.services.profile(this.state.name, age); if (run !== this._run) return;
      try { localStorage.setItem('inthon-dashboard-mode', JSON.stringify('live')); } catch {}
      this.setState({ stage: 4 });
      this.botSay(['가입이 완료됐어요!', this.state.name + '님, 이제 @dimi_in에 콘텐츠를 보내 주세요. 내 대시보드에서 다시 볼 수 있어요.'], { step: 'done', cheer: true });
    } catch (e) { if (run === this._run) this.setState({ step: 'age', error: this.errorText(e) }); }
  }
  renderVals() {
    const s = this.state;
    const msgs = s.msgs.map((m, i) => {
      const next = s.msgs[i + 1];
      const lastOfBot = m.from === 'bot' && (!next || next.from !== 'bot') && !(s.typing && !next);
      return Object.assign({}, m, { isBot: m.from === 'bot', rowCls: 'row' + (m.from === 'me' ? ' me' : ''), bubCls: 'bub ' + (m.from === 'me' ? 'me' : 'bot'), avCls: 'av' + (lastOfBot ? '' : ' ghost') });
    });
    return {
      msgs, typing: s.typing, error: s.error, listRef: el => { this._list = el; }, mascotCls: 'mascot' + (s.cheer ? ' cheer' : ''),
      stepBars: [0, 1, 2, 3].map(i => ({ cls: i < s.stage ? 'done' : i === s.stage ? 'on' : '' })), stepAria: '가입 단계 ' + Math.min(s.stage + 1, 4) + ' / 4',
      showGoogle: s.step === 'google' || s.step === 'googleBusy', googleIdle: s.step === 'google', googleBusy: s.step === 'googleBusy', googleLogin: () => this.googleLogin(),
      showInstagram: s.step === 'instagram', showHandle: !s.linkCode, showCode: !!s.linkCode, linkCode: s.linkCode, linkBusy: s.linkBusy,
      handleDraft: s.handleDraft, onHandle: e => this.setState({ handleDraft: e.target.value, error: '' }),
      onHandleKey: e => { if (e.key === 'Enter' && !((e.nativeEvent || e).isComposing)) { e.preventDefault(); this.issueCode(); } },
      issueCode: () => this.issueCode(), copyCode: () => this.copyCode(), copyLabel: s.copied ? '복사했어요' : '복사',
      linkInstruction: '@' + s.handleDraft.replace(/^@/, '') + ' 계정에서 @dimi_in에게 인증번호를 DM으로 보내 주세요.',
      linkNotice: s.linkNotice, checkLink: () => this.checkLink(true), changeHandle: () => this.changeHandle(),
      showName: s.step === 'name', nameDraft: s.nameDraft, onName: e => this.setState({ nameDraft: e.target.value }),
      onNameKey: e => { if (e.key === 'Enter' && !((e.nativeEvent || e).isComposing)) { e.preventDefault(); this.submitName(); } }, submitName: () => this.submitName(), nameDisabled: !s.nameDraft.trim(),
      showAge: s.step === 'age', ageDraft: s.ageDraft, onAge: e => this.setState({ ageDraft: e.target.value, ageError: false }),
      onAgeKey: e => { if (e.key === 'Enter') { e.preventDefault(); this.submitAge(); } }, submitAge: () => this.submitAge(), ageDisabled: !String(s.ageDraft).trim(), skipAge: () => this.skipAge(), ageError: s.ageError,
      showDone: s.step === 'done', showBlocked: s.step === 'blocked', restart: () => this.start(), waiting: ['intro', 'wait', 'saving'].includes(s.step),
    };
  }
}
