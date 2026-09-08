/* 대학 목록을 브라우저에서 직접 뽑아내는 스니펫.
 *
 * 사용법
 *  1. 진학사 허브 페이지를 크롬에서 엽니다.
 *     https://www.jinhak.com/jh/high3/univ-entrance-info/ipsi-analysis/ipsi-strategy/100000727
 *  2. 대학 목록이 화면에 다 보이도록 끝까지 스크롤합니다.
 *  3. F12 → Console 에 이 파일 내용을 전부 붙여넣고 Enter.
 *  4. univs.json 이 다운로드됩니다. 그 파일을 리포지토리의 data/univs.json 으로 넣고 push 하세요.
 *
 * 러너에서 허브가 차단돼도 이 목록만 있으면 수집기가 계속 돕니다.
 */
(() => {
  const PERIOD = /(\d{1,2}\.\d{1,2}\s*~\s*\d{1,2}\.\d{1,2})/;
  const TAIL = /([가-힣A-Za-z][가-힣A-Za-z0-9·\s]{0,28}?(?:대학교|대학|대)(?:\s*\([^)]{1,12}\))?)\s*$/;
  const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
  const strip = (s) => clean(s).replace(/\s*(경쟁률\s*보기|경쟁률|보기|준비중|입학처)\s*/g, ' ').trim();

  const anchors = [...document.querySelectorAll('a[href]')]
    .filter((a) => /jinhakapply\.com|uwayapply\.com/.test(a.href));

  const heads = [...document.querySelectorAll('*')]
    .filter((e) => e.children.length === 0 && /지역\s*수시\s*경쟁률/.test(e.textContent || ''))
    .map((e) => ({ el: e, name: clean(e.textContent).split('지역')[0].trim() }));

  const regionOf = (a) => {
    let best = '';
    for (const h of heads) {
      if (h.el.compareDocumentPosition(a) & Node.DOCUMENT_POSITION_FOLLOWING) best = h.name;
    }
    return best;
  };

  const out = [], seen = new Set();
  for (const a of anchors) {
    if (seen.has(a.href)) continue;
    let node = a.parentElement, name = '', period = '';
    for (let up = 0; up < 6 && node; up++, node = node.parentElement) {
      const t = clean(node.textContent);
      if (t.length > 400) break;
      const m = t.match(PERIOD);
      if (!m) continue;
      const tail = strip(t.slice(0, m.index)).match(TAIL);
      if (tail) { name = tail[1].trim(); period = m[1].replace(/\s/g, ''); break; }
    }
    if (!name) {
      let n2 = a.parentElement;
      for (let up = 0; up < 4 && n2; up++, n2 = n2.parentElement) {
        const t = strip(n2.textContent);
        if (!t || t.length > 60) continue;
        const tail = t.match(TAIL);
        if (tail) { name = tail[1].trim(); break; }
      }
    }
    if (!name) continue;
    seen.add(a.href);
    out.push({ name, period, region: regionOf(a), url: a.href });
  }

  console.log('추출한 대학 ' + out.length + '개');
  console.table(out.slice(0, 10));
  if (!out.length) {
    console.warn('경쟁률 링크를 못 찾았습니다. 페이지가 다 로딩됐는지, 끝까지 스크롤했는지 확인하세요.');
    return out;
  }
  try {
    const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'univs.json';
    document.body.appendChild(a);
    a.click();
    a.remove();
    console.log('univs.json 다운로드 완료 → 리포지토리의 data/univs.json 으로 넣어주세요.');
  } catch (e) {
    console.warn('다운로드가 막혔습니다. 아래 JSON 을 직접 복사해 data/univs.json 으로 저장하세요.');
    console.log(JSON.stringify(out));
  }
  return out;
})();
