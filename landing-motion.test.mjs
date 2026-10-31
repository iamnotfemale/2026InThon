import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { mountLandingMotion } from './public/js/landing-motion.js';

function fixture(reduced = false) {
  let now = 0; let serial = 0; const timers = new Map(); const observed = new Set(); const events = new Map();
  const element = () => ({hidden:false,textContent:'',style:{removeProperty(name){delete this[name];}},
    classList:{items:new Set(),add(...names){names.forEach(n=>this.items.add(n));},remove(...names){names.forEach(n=>this.items.delete(n));}},
    animate(frames, options){ this.motion={frames,options}; return {cancel(){}}; },
    addEventListener(type, fn){this[type]=fn;},removeEventListener(type){delete this[type];}});
  const name=element(), handle=element(), needle=element(), label=element(), typing=element(), replay=element(), frame=element();
  const messages=Array.from({length:4},element); const cards=Array.from({length:3},element); const orbs=Array.from({length:4},element);
  const chat={querySelectorAll:()=>messages};
  const product={querySelector:()=>frame,getBoundingClientRect:()=>({top:200,bottom:600,height:400})};
  const media={matches:reduced,addEventListener(type,fn){this.change=fn;},removeEventListener(){delete this.change;}};
  const view={innerHeight:800,matchMedia:()=>media,
    setTimeout(fn, delay){timers.set(++serial,{fn,at:now+delay});return serial;},clearTimeout:id=>timers.delete(id),
    requestAnimationFrame:fn=>view.setTimeout(fn,16),cancelAnimationFrame:id=>timers.delete(id),
    addEventListener(type,fn){events.set(type,fn);},removeEventListener:type=>events.delete(type),
    IntersectionObserver:class {constructor(fn){this.fn=fn;view.observer=this;}observe(target){observed.add(target);}unobserve(target){observed.delete(target);}disconnect(){observed.clear();}},
  };
  const nodes={'.hero-name':name,'.hero-handle':handle,'.hero-product':product,'.gauge-needle':needle,'.gauge-label':label,'.dm-chat':chat,'.dm-typing':typing,'.dm-replay':replay};
  const root={ownerDocument:{defaultView:view},querySelector:selector=>nodes[selector],querySelectorAll:selector=>selector.includes('.hero-chars')?orbs:cards};
  const advance=ms=>{const end=now+ms;while(true){const next=[...timers].sort((a,b)=>a[1].at-b[1].at)[0];if(!next||next[1].at>end)break;timers.delete(next[0]);now=next[1].at;next[1].fn();}now=end;};
  const enter=target=>view.observer.fn([{target,isIntersecting:true}]);
  return {root,view,media,name,handle,needle,label,typing,replay,messages,chat,observed,events,timers,advance,enter};
}

test('hero types the actual bot handle, then reveals the stable accessible Dimi title', () => {
  const f=fixture();const stop=mountLandingMotion(f.root);
  assert.equal(f.handle.textContent,'');f.advance(600);assert.match(f.handle.textContent,/^@dimi/);
  f.advance(500);assert.equal(f.handle.textContent,'@dimi_in');
  f.advance(1000);assert.ok(f.name.classList.items.has('is-arriving'));assert.ok(!f.name.classList.items.has('is-typing'));
  const source=readFileSync('frontend/landing/Landing.dc.html','utf8');
  assert.match(source,/aria-label="당신의 가장 가까운 비서 디미"/);assert.doesNotMatch(source,/화면 속 콘텐츠는 예시예요/);
  stop();assert.equal(f.timers.size,0);assert.equal(f.events.size,0);
});

test('DM waits until visible, then stages typing and replies; replay cannot resurrect an earlier run', () => {
  const f=fixture();const stop=mountLandingMotion(f.root);
  assert.ok(f.messages.every(m=>m.hidden));f.enter(f.chat);
  assert.deepEqual(f.messages.map(m=>m.hidden),[false,true,true,true]);
  f.advance(500);assert.equal(f.typing.hidden,false);
  f.advance(700);assert.equal(f.messages[1].hidden,false);
  f.replay.click();f.advance(1600);assert.equal(f.messages[2].hidden,true);
  f.advance(2100);assert.ok(f.messages.every(m=>!m.hidden));assert.equal(f.typing.hidden,true);
  assert.ok(!f.observed.has(f.chat));stop();
});

test('gauge settles to its existing verdict and reduced motion reveals all content immediately', () => {
  const f=fixture();const stop=mountLandingMotion(f.root);f.enter(f.needle);
  assert.equal(f.label.textContent,'근거 확인 중');f.advance(1700);assert.equal(f.label.textContent,'오해의 소지');
  f.media.matches=true;f.media.change();assert.equal(f.timers.size,0);assert.ok(f.messages.every(m=>!m.hidden));
  assert.ok(!f.name.classList.items.has('is-typing'));assert.equal(f.observed.size,0);stop();
  const reduced=fixture(true);mountLandingMotion(reduced.root);assert.equal(reduced.timers.size,0);assert.ok(reduced.messages.every(m=>!m.hidden));
});
