// 브라우저 컨텍스트에서 실행되는 수집 루틴.
// 같은 오리진 안에서 fetch 하므로 CORS 를 타지 않고, 문서 선언 charset(EUC-KR 포함)을 직접 처리한다.
window.__collect = async function (targets) {
  const toInt = s => { const t = String(s).replace(/[,\s]/g, ''); return /^\d+$/.test(t) ? +t : null };

  function labelOf(t) {
    const pick = el => {
      const tx = (el.textContent || '').trim().replace(/\s+/g, ' ');
      return (tx.length < 160 && /경쟁률\s*현황$/.test(tx)) ? tx.replace(/\s*경쟁률\s*현황$/, '').trim() : null;
    };
    let node = t;
    for (let up = 0; up < 5 && node; up++, node = node.parentElement) {
      let s = node.previousElementSibling;
      for (let k = 0; k < 6 && s; k++, s = s.previousElementSibling) { const v = pick(s); if (v) return v }
    }
    return '';
  }

  function parseDoc(doc) {
    const rows = [];
    for (const t of doc.querySelectorAll('table')) {
      const hdr = [...(t.rows[0] ? t.rows[0].cells : [])].map(c => c.textContent.trim());
      if (!hdr.some(h => /모집단위/.test(h)) || !hdr.some(h => /지원\s*인원/.test(h))) continue;
      const jung = labelOf(t), H = hdr.length, carry = new Array(H).fill('');
      const iU = hdr.findIndex(h => /모집단위/.test(h));
      const iQ = hdr.findIndex(h => /모집\s*인원/.test(h));
      const iA = hdr.findIndex(h => /지원\s*인원/.test(h));
      const iR = hdr.findIndex(h => /경쟁률/.test(h));
      const iC = hdr.findIndex(h => /캠퍼스|계열/.test(h));
      const iL = hdr.findIndex(h => /^대학$/.test(h));
      for (let r = 1; r < t.rows.length; r++) {
        const c = [...t.rows[r].cells].map(x => x.textContent.trim());
        if (c.length < 4) continue;
        const off = Math.max(0, H - c.length), full = carry.slice();
        for (let i = 0; i < c.length; i++) full[off + i] = c[i];
        const quota = toInt(full[iQ]), apply = toInt(full[iA]), unit = full[iU];
        for (let i = 0; i < H; i++) carry[i] = full[i];
        if (quota === null || apply === null || !unit) continue;
        if (/^(합계|소계|계|총계)$/.test(unit)) continue;
        if (iR >= 0 && !/:\s*1/.test(full[iR])) continue;
        const camp = iC >= 0 ? full[iC] : '';
        rows.push({ j: jung, c: (camp === '-' ? '' : camp), l: iL >= 0 && full[iL] !== '-' ? full[iL] : '', u: unit, q: quota, a: apply });
      }
    }
    return rows;
  }

  function asOf(doc) {
    const bt = (doc.body ? doc.body.textContent : '').replace(/\s+/g, ' ');
    const m = bt.match(/(\d{4})[-.년]\s*(\d{1,2})[-.월]\s*(\d{1,2})\s*[일]?\s*(오전|오후)?\s*(\d{1,2})\s*[:시]\s*(\d{1,2})/);
    if (!m) return null;
    let h = +m[5];
    if (m[4] === '오후' && h < 12) h += 12;
    if (m[4] === '오전' && h === 12) h = 0;
    const p = x => String(x).padStart(2, '0');
    return m[1] + '-' + p(m[2]) + '-' + p(m[3]) + 'T' + p(h) + ':' + p(m[6]);
  }

  async function getDoc(url) {
    const r = await fetch(url, { cache: 'no-store' });
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const buf = await r.arrayBuffer();
    let s = new TextDecoder('utf-8').decode(buf);
    const m = s.match(/charset\s*=\s*["']?([\w-]+)/i);
    if (m && !/utf-?8/i.test(m[1])) {
      try { s = new TextDecoder(m[1]).decode(buf) } catch (e) { s = new TextDecoder('euc-kr').decode(buf) }
    }
    return new DOMParser().parseFromString(s, 'text/html');
  }

  const out = [];
  for (const t of targets) {
    try {
      const doc = await getDoc(t.url);
      const rows = parseDoc(doc);
      out.push({ id: t.id, ok: rows.length > 0, asof: asOf(doc), title: (doc.title || '').trim(), rows });
    } catch (e) {
      out.push({ id: t.id, ok: false, err: String(e && e.message || e), rows: [] });
    }
    await new Promise(r => setTimeout(r, 120));
  }
  return out;
};
