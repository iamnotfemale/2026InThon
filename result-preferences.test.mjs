import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createResultPreferences, resultLinkMessage } from './result-preferences.mjs';
const UID='11111111-1111-4111-8111-111111111111';
const OTHER='22222222-2222-4222-8222-222222222222';
test('link delivery is default; settings and hidden records persist per user with reversible removal', async () => {
  const data=new Map();
  const store=createResultPreferences({secret:'test-secret',
    getBlob:async key=>data.has(key)?{stream:new Response(data.get(key)).body}:null,
    putBlob:async(key,value,options)=>{assert.equal(options.access,'private');data.set(key,value);},
    listBlob:async({prefix})=>({blobs:[...data.keys()].filter(k=>k.startsWith(prefix)).map(pathname=>({pathname})),hasMore:false}),
    deleteBlob:async key=>data.delete(key)});
  assert.deepEqual(await store.read(UID),{delivery:'summary',hidden:[]});
  await store.update(UID,{delivery:'full'}); await store.update(UID,{item:'fc15',hidden:true});
  assert.deepEqual(await store.read(UID),{delivery:'full',hidden:['fc15']});
  assert.deepEqual(await store.read(OTHER),{delivery:'summary',hidden:[]});
  await store.update(UID,{item:'fc15',hidden:false}); assert.deepEqual((await store.read(UID)).hidden,[]);
  for (const bad of [{delivery:'public'},{item:'../other',hidden:true},{item:'fc15',hidden:'yes'}]) await assert.rejects(store.update(UID,bad));
  assert.doesNotMatch([...data.keys()].join(''),new RegExp(UID));
});
test('a result link uses the persisted id and canonical origin, carries no credentials and stays private', () => {
  const message=resultLinkMessage('https://inthon.yeoziphab.com',15,{extracted:{claim:'검증한 주장'}});
  assert.match(message,/https:\/\/inthon.yeoziphab.com\/items\/fc15/);
  assert.match(message,/로그인한 본인만/); assert.match(message,/검증한 주장/);
  assert.throws(()=>resultLinkMessage('http://example.com',15,{}));
  assert.throws(()=>resultLinkMessage('https://example.com','../private',{}));
});
