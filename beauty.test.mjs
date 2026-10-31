import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import DashboardModel from './public/js/dashboard-model.js';
import {createMobileDashboard} from './public/js/dashboard-mobile.js';
import {validateBeauty} from './public/js/beauty-data.js';
import {factcheckToItem} from './public/js/dashboard-live.js';
import {indexFromRow} from './public/js/content-index.js';
import {applyTasteOrbitValues} from './public/js/dashboard-taste.js';

const samples=JSON.parse(readFileSync('frontend/data/sample-data.json','utf8')).ITEMS.filter(i=>i.type==='beauty');
const stored=sample=>({id:31,created_at:'2026-11-01T01:00:00Z',status:'done',topic:'beauty',claim:sample.title,
  reason:JSON.stringify({beauty:{version:1,...sample,sponsored:sample.sub==='product'},sourceUrl:'https://www.instagram.com/p/Example/'})});

test('beauty salon and product details filter and render through both layouts without joining taste or calendar categories',()=>{
  const app=new DashboardModel({theme:'light'});
  app.setState=patch=>Object.assign(app.state,patch); app.toast=()=>{};
  const mobile=createMobileDashboard(app);
  const items=samples.map(sample=>factcheckToItem(stored(sample)));
  for(const sample of samples){
    app.state.view='detail';app.state.detailId=sample.id;
    for(const v of [app.renderVals(),mobile()]){
      assert.equal(v.d.isBeauty,true);assert.equal(v.d.tasteable,false);
      assert.equal(v.d.bFacts.length,4);assert.equal(v.d.points.length,3);assert.equal(v.d.bLinks.length,2);
      assert.equal(v.d.bSectionTitle,sample.sub==='salon'?'장소·예약':'구매처');
    }
  }
  app.state.view='library';app.state.typeF='beauty';
  assert.deepEqual(app.renderVals().libItems.map(i=>i.id).sort(),['b1','b2']);
  assert.equal(mobile().libItems.length,2);
  assert.equal(app.renderVals().sideTypes.find(t=>t.label==='미용').count,2);
  const taste=applyTasteOrbitValues({}, {taste:{fc31:true}}, {allItems:()=>items,setState:()=>{}});
  assert.equal(taste.tasteCount,0);
  assert.equal(items[1].phase,'협찬 표시 있음');assert.equal(items[0].phase,null);
});

test('stored beauty data keeps unrecorded fields unknown, preserves the category and rejects unsafe links or malformed data',()=>{
  const row=stored({...samples[0],address:null,hours:null});
  const item=factcheckToItem(row);
  assert.equal(item.address,'주소 미기재');assert.equal(item.hours,'운영 시간 미기재');
  assert.equal(indexFromRow(row).category,'beauty');
  assert.equal(item.origin,'https://www.instagram.com/p/Example/');
  for(const url of ['javascript:alert(1)','data:text/html,x','https://name:pass@example.test/']){
    const bad={version:1,...samples[0],links:[['링크',url,1]]};
    assert.throws(()=>validateBeauty(bad));
    assert.equal(factcheckToItem({...row,reason:JSON.stringify({beauty:bad})}),null);
  }
  assert.throws(()=>validateBeauty({version:1,...samples[0],bFacts:[['가격',{}]]}));
  assert.equal(factcheckToItem({...row,reason:'{"beauty":{}}'}),null);
});
