import {test} from 'node:test';
import assert from 'node:assert/strict';
import {applyDmPreview} from './public/js/dm-preview.js';

test('delivery previews switch category and full/link format locally without sending messages',()=>{
  const state={mode:'live',dmType:'recipe',dmMode:'summary'};
  const app={setState:patch=>Object.assign(state,patch)};
  const values=()=>applyDmPreview({},state,app);
  assert.equal(values().dmTypes.length,5); assert.equal(values().dmPreviewLink,true);
  const summary=values().dmBubbles.map(b=>b.text).join('\n');
  state.dmMode='full'; assert.equal(values().dmPreviewLink,false);
  assert.ok(values().dmBubbles.length>2); assert.notEqual(values().dmBubbles.map(b=>b.text).join('\n'),summary);
  for(const tab of values().dmTypes){
    tab.pick();
    assert.ok(values().dmBubbles[1].text.length>0);
    assert.equal(values().dmTypes.filter(t=>t.pressed==='true').length,1);
  }
  assert.match(values().dmSampleTitle,/들기름 국수집/);
  assert.match(values().dmBubbles[0].text,/디미가 금방/);
});
