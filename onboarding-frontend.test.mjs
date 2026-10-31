import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

function model() {
  const timers = new Map(); let id = 0;
  class Base {
    constructor(props) { this.props = props; }
    setState(update) { this.state = { ...this.state, ...(typeof update === 'function' ? update(this.state) : update) }; }
  }
  const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(readFileSync('frontend/register/Signup.dc.html', 'utf8'))[1];
  const component = runInNewContext(script + '\nnew Component({})', { DCLogic: Base,
    setTimeout: fn => { timers.set(++id, fn); return id; }, clearTimeout: key => timers.delete(key) });
  const flush = () => { let steps = 0; while (timers.size) {
    assert.ok(steps++ < 50, 'Animation timers must settle'); const [key, fn] = timers.entries().next().value; timers.delete(key); fn();
  } };
  component.componentDidMount(); flush();
  return { component, flush };
}

test('supplied signup demo completes Google → name → age, validates age and retains keyboard submission', () => {
  const { component: c, flush } = model();
  assert.ok(c.renderVals().showGoogle);
  c.renderVals().googleLogin(); flush(); assert.ok(c.renderVals().showName);
  assert.ok(c.renderVals().nameDisabled);
  c.renderVals().onName({ target: { value: '테스트' } });
  c.renderVals().onNameKey({ key: 'Enter', isComposing: true, preventDefault: () => assert.fail() });
  assert.equal(c.state.step, 'name');
  c.renderVals().onNameKey({ key: 'Enter', preventDefault() {} }); flush();
  assert.ok(c.renderVals().showAge);
  c.renderVals().onAge({ target: { value: '0' } }); c.renderVals().submitAge(); assert.ok(c.renderVals().ageError);
  c.renderVals().onAge({ target: { value: '23' } }); c.renderVals().onAgeKey({ key: 'Enter', preventDefault() {} }); flush();
  assert.ok(c.renderVals().showDone); assert.equal(c.state.name, '테스트'); assert.equal(c.state.age, '23');
  c.componentWillUnmount();
});
test('age can be skipped and restarting onboarding resets all fields and timers', () => {
  const { component: c, flush } = model(); c.googleLogin(); flush();
  c.renderVals().onName({ target: { value: '테스트' } }); c.submitName(); flush(); c.skipAge(); flush();
  assert.ok(c.renderVals().showDone); assert.equal(c.state.age, '');
  c.renderVals().restart(); flush(); assert.ok(c.renderVals().showGoogle); assert.equal(c.state.name, '');
});
