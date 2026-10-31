import { DCLogic } from './dashboard-runtime.js';

export default class RegisterModel extends DCLogic {
  constructor(props) {
    super(props);
    this.state = { msgs: [], typing: false, step: 'intro', name: '', age: '', nameDraft: '', ageDraft: '', ageError: false, seq: 0, cheer: false };
    this._timers = [];
  }
  componentDidMount() { this.start(); }
  componentWillUnmount() { this._timers.forEach(t => clearTimeout(t)); }
  componentDidUpdate() { if (this._list) this._list.scrollTop = this._list.scrollHeight; }
  later(fn, ms) { const t = setTimeout(fn, ms); this._timers.push(t); }
  push(from, text) { this.setState(s => ({ msgs: s.msgs.concat([{ id: s.seq + 1, from, text }]), seq: s.seq + 1 })); }
  botSay(texts, next) {
    const run = (i) => {
      if (i >= texts.length) { this.setState(Object.assign({ typing: false }, next || {})); return; }
      this.setState({ typing: true });
      this.later(() => { this.setState({ typing: false }); this.push('bot', texts[i]); this.later(() => run(i + 1), 260); }, 750 + Math.min(texts[i].length * 12, 600));
    };
    this.setState({ step: 'wait' });
    run(0);
  }
  start() {
    this._timers.forEach(t => clearTimeout(t)); this._timers = [];
    this.setState({ msgs: [], typing: false, step: 'intro', name: '', age: '', nameDraft: '', ageDraft: '', ageError: false, cheer: false });
    this.later(() => this.botSay(['안녕하세요! 보낸 콘텐츠를 대신 정리해 드리는 디미예요.', '가입은 세 단계면 끝나요. 먼저 Google 계정으로 로그인해 주세요.'], { step: 'google' }), 450);
  }
  googleLogin() {
    if (this.state.step !== 'google') return;
    this.setState({ step: 'googleBusy' });
    this.later(() => {
      this.push('me', 'Google 계정으로 로그인했어요 · jimin@example.com');
      this.botSay(['로그인 완료! 반가워요.', '뭐라고 불러드리면 될까요?'], { step: 'name' });
    }, 1100);
  }
  submitName() {
    const v = this.state.nameDraft.trim();
    if (!v || this.state.step !== 'name') return;
    this.setState({ name: v, nameDraft: '' });
    this.push('me', v);
    this.botSay([v + '님, 좋은 이름이에요!', '마지막으로 나이를 알려주세요.'], { step: 'age' });
  }
  submitAge() {
    const raw = String(this.state.ageDraft).trim(); const n = parseInt(raw, 10);
    if (this.state.step !== 'age') return;
    if (!raw || isNaN(n) || n < 1 || n > 120) { this.setState({ ageError: true }); return; }
    this.setState({ age: String(n), ageDraft: '', ageError: false });
    this.push('me', n + '살');
    this.finish();
  }
  skipAge() {
    if (this.state.step !== 'age') return;
    this.setState({ ageDraft: '', ageError: false });
    this.push('me', '나이는 건너뛸게요');
    this.finish();
  }
  finish() {
    const nm = this.state.name;
    this.botSay(['완료되었어요!', nm + '님의 공간을 준비했어요. 이제 Instagram에서 보던 게시물을 @dimi_in에 보내보세요. 대시보드로 안내할게요!'], { step: 'done', cheer: true });
  }
  renderVals() {
    const s = this.state;
    const order = ['google', 'name', 'age'];
    const idx = s.step === 'done' ? 3 : (s.step === 'googleBusy' ? 0 : order.indexOf(s.step));
    const cur = idx < 0 ? (s.name ? (s.age || s.step === 'wait' ? 2 : 1) : 0) : idx;
    const msgs = s.msgs.map((m, i) => {
      const next = s.msgs[i + 1];
      const lastOfBot = m.from === 'bot' && (!next || next.from !== 'bot') && !(s.typing && !next);
      return Object.assign({}, m, {
        isBot: m.from === 'bot', rowCls: 'row' + (m.from === 'me' ? ' me' : ''),
        bubCls: 'bub ' + (m.from === 'me' ? 'me' : 'bot'),
        avCls: 'av' + (lastOfBot ? '' : ' ghost')
      });
    });
    return {
      msgs, typing: s.typing,
      listRef: (el) => { this._list = el; },
      mascotCls: 'mascot' + (s.cheer ? ' cheer' : ''),
      stepBars: [0, 1, 2].map(i => ({ cls: i < cur ? 'done' : (i === cur ? 'on' : '') })),
      stepAria: '가입 단계 ' + Math.min(cur + 1, 3) + ' / 3',
      showGoogle: s.step === 'google' || s.step === 'googleBusy', googleIdle: s.step === 'google', googleBusy: s.step === 'googleBusy',
      googleLogin: () => this.googleLogin(),
      showName: s.step === 'name', nameDraft: s.nameDraft, onName: e => this.setState({ nameDraft: e.target.value }),
      onNameKey: e => { if (e.key === 'Enter' && !((e.nativeEvent || e).isComposing)) { e.preventDefault(); this.submitName(); } },
      submitName: () => this.submitName(), nameDisabled: !s.nameDraft.trim(),
      showAge: s.step === 'age', ageDraft: s.ageDraft, onAge: e => this.setState({ ageDraft: e.target.value, ageError: false }),
      onAgeKey: e => { if (e.key === 'Enter') { e.preventDefault(); this.submitAge(); } },
      submitAge: () => this.submitAge(), ageDisabled: !String(s.ageDraft).trim(), skipAge: () => this.skipAge(), ageError: s.ageError,
      showDone: s.step === 'done', restart: () => this.start(),
      waiting: s.step === 'wait' || s.step === 'intro'
    };
  }
}
