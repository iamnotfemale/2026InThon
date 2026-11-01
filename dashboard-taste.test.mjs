import { test } from 'node:test';
import assert from 'node:assert/strict';
import { applyTasteOrbitValues } from './public/js/dashboard-taste.js';

test('taste orbit selections, counts and removals use the same owned saved records on both screens',()=>{
  const items=[{id:'fc1',type:'recipe',status:'done',title:'요리'}, {id:'fc9-2',type:'exhibit',status:'done',title:'전시'},
    {id:'fc3',type:'news',status:'done',title:'뉴스'}, {id:'fc4',type:'recipe',status:'failed',title:'실패'},
    {id:'fc5',type:'contest',status:'done',title:'공모전'}, {id:'fc6',type:'restaurant',status:'done',title:'맛집'},
    {id:'fc7',type:'space',status:'done',title:'취향공간'}, {id:'fc8',type:'beauty',status:'done',title:'미용'}];
  const s={taste:{fc1:true,'fc9-2':true,fc3:true,fc4:true,fc5:true,fc6:true,fc7:true,fc8:true},tasteTab:'all'};
  const opened=[]; const app={allItems:()=>items,setState:patch=>Object.assign(s,patch),toast:()=>{},openDetail:id=>opened.push(id)};
  const values=()=>applyTasteOrbitValues({},s,app);
  assert.equal(values().tasteCount,6); assert.deepEqual(values().tasteTabs.map(tab=>tab.count),[6,1,2,1,1,1]);
  assert.equal(values().tasteOrbits.length,5);
  assert.equal(values().tasteGroups[4].items[0].id,'fc8');
  values().tasteOrbits[1].planets[0].select(); assert.equal(values().tasteGroups[1].items[0].isSel,true);
  assert.equal(values().tasteSelection.id,'fc9-2');assert.equal(values().tasteHasSelection,true);
  values().clearTasteSelection();assert.equal(values().tasteNoSelection,true);
  values().tasteGroups[1].items[0].open(); assert.deepEqual(opened,['fc9-2']);
  values().tasteTabs[1].pick(); assert.match(values().tasteOrbits[1].cls,/dim/); assert.doesNotMatch(values().tasteOrbits[0].cls,/dim/);
  values().tasteGroups[0].items[0].remove(); assert.equal(values().tasteCount,5); assert.equal(values().tasteOrbits[0].planets.length,0);
  assert.equal(items.length,8);
});
