import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';

const source = readFileSync('frontend/design/Main.dc.html', 'utf8');
const script = /<script type="text\/x-dc"[^>]*>([\s\S]*?)<\/script>/.exec(source)[1];
class Base { constructor(props) { this.props = props; } }

test('all supplied sample records and initial derived views still render using the original logic', () => {
  const model = runInNewContext(script + '\nnew Component({theme:"light"})', { DCLogic: Base });
  const sample = JSON.parse(readFileSync('frontend/data/sample-data.json', 'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(model.data().ITEMS)), sample.ITEMS);
  for (const view of ['home', 'library', 'taste', 'settings']) {
    model.state.view = view;
    const values = model.renderVals();
    assert.equal(values.rootCls, 'app');
    assert.equal(values.totalCount, 13); // includes the 맛집 demo item m1 and the 취향공간 demo item sp1
  }
  for (const item of sample.ITEMS) {
    model.state.view = 'detail'; model.state.detailId = item.id;
    assert.ok(model.renderVals().isDetail, item.id);
  }
  model.state.view='settings';
  for(const type of ['recipe','news','exhibit','contest','restaurant','space']){
    model.state.dmType=type;
    assert.doesNotThrow(()=>model.renderVals(),type);
  }
});

test('the template adapter preserves handler functions, CSS strings, control values and loop scope', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => Response.json([]);
  let renderNodes;
  try { ({ renderNodes } = await import('./public/js/dashboard-runtime.js')); }
  finally { globalThis.fetch = originalFetch; }
  const handler = () => {};
  const tree = [{ tag: 'sc-for', attrs: { list: '{{items}}', as: 'item' }, id: 1, children: [
    { tag: 'input', id: 2, attrs: { type: 'text', value: '{{item.label}}', onchange: '{{item.change}}', style: 'padding: 14px; border-radius: 8px', disabled: '{{item.disabled}}' }, children: [] },
    { tag: 'sc-if', id: 3, attrs: { value: '{{item.visible}}' }, children: ['{{item.label}}'] },
    { tag: 'sc-scope', id: 4, attrs: { value: '{{calendar}}' }, children: ['{{title}} {{item.label}}'] },
  ] }];
  const rendered = renderNodes(tree, { calendar: { title: '일정' }, items: [{ id: 'a', label: '<literal text>', change: handler, disabled: false, visible: true }] }, {});
  const input = rendered[0][0][0];
  assert.equal(input.props.onInput, handler); assert.equal(input.props.disabled, false);
  assert.equal(input.props.value, '<literal text>');
  assert.equal(input.props.style, 'padding: 14px; border-radius: 8px');
  assert.deepEqual(rendered[0][0][1], ['<literal text>']);
  assert.deepEqual(rendered[0][0][2], ['일정 <literal text>']);
});
