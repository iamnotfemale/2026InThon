import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTasteOrbitValues } from './public/js/dashboard-taste.js';

test('taste orbit selections, counts and removals use the same owned saved records on both screens',()=>{
  const items=[{id:'fc1',type:'recipe',status:'done',title:'요리'}, {id:'fc9-2',type:'exhibit',status:'done',title:'전시'},
    {id:'fc3',type:'news',status:'done',title:'뉴스'}, {id:'fc4',type:'recipe',status:'failed',title:'실패'}];
  const s={taste:{fc1:true,'fc9-2':true,fc3:true,fc4:true},tasteTab:'all'};
  const opened=[]; const app={allItems:()=>items,setState:patch=>Object.assign(s,patch),toast:()=>{},openDetail:id=>opened.push(id)};
  const values=()=>applyTasteOrbitValues({},s,app);
  assert.equal(values().tasteCount,2); assert.deepEqual(values().tasteTabs.map(tab=>tab.count),[2,1,1]);
  values().orbitB[0].select(); assert.equal(values().tasteGroups[1].items[0].isSel,true);
  values().tasteGroups[1].items[0].open(); assert.deepEqual(opened,['fc9-2']);
  values().tasteTabs[1].pick(); assert.match(values().orbitBCls,/dim/); assert.doesNotMatch(values().orbitACls,/dim/);
  values().tasteGroups[0].items[0].remove(); assert.equal(values().tasteCount,1); assert.equal(values().orbitA.length,0);
  assert.equal(items.length,4);
});
