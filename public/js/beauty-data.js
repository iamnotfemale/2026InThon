// Shared result contract; media analysis runs only on the server.
export function validateBeauty(value) {
  const text = (s, max = 1000) => typeof s === 'string' && s.length <= max;
  if (!value || value.version !== 1 || !['salon', 'product'].includes(value.sub)
    || !text(value.title, 300) || !value.title.trim() || !text(value.intro, 2000)
    || !Array.isArray(value.bFacts) || value.bFacts.length > 12
    || value.bFacts.some(pair => !Array.isArray(pair) || pair.length !== 2 || !pair.every(s => text(s)))
    || !Array.isArray(value.points) || value.points.length > 20 || !value.points.every(s => text(s))
    || !Array.isArray(value.links) || value.links.length > 8
    || ['place', 'address', 'hours', 'caution', 'linkNote'].some(k => value[k] != null && !text(value[k], 2000))
    || (value.sponsored != null && typeof value.sponsored !== 'boolean')) throw new Error('Invalid beauty result');
  for (const link of value.links) {
    if (!Array.isArray(link) || link.length !== 3 || !text(link[0], 100) || !text(link[1], 2000)
      || ![true, false, 0, 1].includes(link[2])) throw new Error('Invalid beauty link');
    let url;
    try { url = new URL(link[1]); } catch { throw new Error('Invalid beauty link'); }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid beauty link');
  }
  return { version: 1, title: value.title.trim(), sub: value.sub, intro: value.intro,
    bFacts: value.bFacts.map(([k, v]) => [k, v.trim() || '미기재']), points: value.points,
    place: value.place || '', address: value.address || '주소 미기재', hours: value.hours || '운영 시간 미기재',
    links: value.links, sponsored: value.sponsored === true,
    caution: value.caution || '가격·효과·사용감은 게시물 작성자의 설명이에요.',
    linkNote: value.linkNote || (value.sub === 'salon' ? '예약은 매장 페이지에서 진행돼요.' : '구매는 판매처에서 진행돼요.') };
}
