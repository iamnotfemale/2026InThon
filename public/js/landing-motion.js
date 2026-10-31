const HANDLE = '@dimi_in';
const EASE = 'cubic-bezier(.23,1,.32,1)';

export function mountLandingMotion(root) {
  if (!root) return () => {};
  const view = root.ownerDocument.defaultView;
  const reduce = view.matchMedia('(prefers-reduced-motion: reduce)');
  const name = root.querySelector('.hero-name');
  const handle = root.querySelector('.hero-handle');
  const product = root.querySelector('.hero-product');
  const frame = product?.querySelector('.frame');
  const orbs = [...root.querySelectorAll('.hero-chars .orb')];
  const needle = root.querySelector('.gauge-needle');
  const label = root.querySelector('.gauge-label');
  const chat = root.querySelector('.dm-chat');
  const messages = chat ? [...chat.querySelectorAll('.bub:not(.dm-typing)')] : [];
  const typing = root.querySelector('.dm-typing');
  const replay = root.querySelector('.dm-replay');
  const timers = new Set(); const animations = new Set();
  let observer; let raf = 0; let chatRun = 0;

  const later = (fn, delay) => {
    const id = view.setTimeout(() => { timers.delete(id); fn(); }, delay);
    timers.add(id);
  };
  const animate = (element, frames, duration = 450) => {
    if (!element?.animate) return;
    const animation = element.animate(frames, {duration, easing:EASE});
    animations.add(animation); animation.onfinish = () => animations.delete(animation);
  };
  const finishChat = () => { messages.forEach(message => { message.hidden = false; }); if (typing) typing.hidden = true; };
  const playChat = () => {
    const run = ++chatRun;
    if (reduce.matches) { finishChat(); return; }
    messages.forEach(message => { message.hidden = true; });
    if (typing) typing.hidden = true;
    const show = index => {
      if (run !== chatRun) return;
      const message = messages[index];
      if (!message) return;
      message.hidden = false;
      animate(message, [{opacity:0,transform:'translateY(10px) scale(.97)'},{opacity:1,transform:'none'}], 320);
    };
    show(0);
    [450, 1450].forEach(delay => later(() => { if (run === chatRun && typing) typing.hidden = false; }, delay));
    [1100, 2700, 3600].forEach((delay, i) => later(() => {
      if (run !== chatRun) return;
      if (typing) typing.hidden = true;
      show(i + 1);
    }, delay));
  };
  const morph = () => {
    raf = 0;
    if (!product || reduce.matches) return;
    const rect = product.getBoundingClientRect();
    if (rect.bottom < 0 || rect.top > view.innerHeight) return;
    const progress = Math.max(0, Math.min(1, (view.innerHeight * .88 - rect.top) / (view.innerHeight * .8 + rect.height * .3)));
    if (frame) frame.style.transform = `perspective(1200px) rotateX(${8 * (1 - progress)}deg) translateY(${14 * (1 - progress)}px) scale(${.96 + progress * .04})`;
    orbs.forEach((orb, index) => {
      const direction = index < 2 ? 1 : -1;
      orb.classList.add('scroll-morph');
      orb.style.transform = `translate(${direction * progress * 32}px,${-progress * (24 + index * 8)}px) rotate(${direction * progress * 24}deg) scale(${1 - progress * .12})`;
      // An eight-point circle becomes a soft diamond as the content gathers into the dashboard.
      const inset = 15 + progress * 13;
      orb.style.clipPath = `polygon(50% 0%,${100-inset}% ${inset}%,100% 50%,${100-inset}% ${100-inset}%,50% 100%,${inset}% ${100-inset}%,0% 50%,${inset}% ${inset}%)`;
    });
  };
  const onScroll = () => { if (!raf && !reduce.matches) raf = view.requestAnimationFrame(morph); };
  const reset = () => {
    ++chatRun; observer?.disconnect();
    timers.forEach(id => view.clearTimeout(id)); timers.clear();
    animations.forEach(animation => animation.cancel()); animations.clear();
    if (raf) view.cancelAnimationFrame(raf); raf = 0;
    name?.classList.remove('is-typing', 'is-arriving');
    if (handle) handle.textContent = HANDLE;
    finishChat();
    root.querySelectorAll('.motion-reveal').forEach(element => element.classList.add('is-visible'));
    if (needle) needle.style.transform = 'rotate(-33.75deg)';
    if (label) label.textContent = '오해의 소지';
    if (frame) frame.style.removeProperty('transform');
    orbs.forEach(orb => { orb.classList.remove('scroll-morph'); orb.style.removeProperty('transform'); orb.style.removeProperty('clip-path'); });
  };
  const start = () => {
    reset();
    if (reduce.matches) return;
    if (name && handle) {
      name.classList.add('is-typing'); handle.textContent = '';
      [...HANDLE].forEach((_, index) => later(() => { handle.textContent = HANDLE.slice(0, index + 1); }, 180 + index * 95));
      later(() => {
        animate(handle, [{opacity:1,transform:'none'},{opacity:0,transform:'translateY(-12%) scale(.95)'}], 240);
        later(() => { name.classList.remove('is-typing'); name.classList.add('is-arriving'); }, 220);
      }, 1450);
    }
    morph();
    if (!view.IntersectionObserver) { playChat(); return; }
    observer = new view.IntersectionObserver(entries => {
      entries.filter(entry => entry.isIntersecting).forEach(({target}) => {
        observer.unobserve(target);
        if (target === chat) playChat();
        else if (target === needle) {
          if (label) label.textContent = '근거 확인 중';
          animate(needle, [{transform:'rotate(-125deg)'},{transform:'rotate(80deg)',offset:.52},{transform:'rotate(-45deg)',offset:.82},{transform:'rotate(-33.75deg)'}], 1700);
          later(() => { if (label) label.textContent = '오해의 소지'; }, 1700);
        } else target.classList.add('is-visible');
      });
    }, {threshold:.18});
    root.querySelectorAll('#features .bento, #how .step-card, #trust .trust').forEach(element => {
      element.classList.add('motion-reveal'); element.classList.remove('is-visible'); observer.observe(element);
    });
    if (needle) observer.observe(needle);
    if (chat) { messages.forEach(message => { message.hidden = true; }); observer.observe(chat); }
  };
  start();
  replay?.addEventListener('click', playChat);
  reduce.addEventListener('change', start);
  view.addEventListener('scroll', onScroll, {passive:true});
  view.addEventListener('resize', onScroll);
  return () => {
    reset(); replay?.removeEventListener('click', playChat); reduce.removeEventListener('change', start);
    view.removeEventListener('scroll', onScroll); view.removeEventListener('resize', onScroll);
  };
}
