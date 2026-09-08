// 브라우저 컨텍스트에서 실행되는 수집 루틴.
// 같은 오리진 안에서 fetch 하므로 CORS 를 타지 않고, 문서 선언 charset(EUC-KR 포함)을 직접 처리한다.
//
// 요청 간격을 넉넉히 두는 이유: 진학사 계열은 짧은 시간에 요청이 몰리면
// "안전한 접속 확인" 페이지를 내려준다. 사람이 브라우저로 훑는 속도에 가깝게 맞춘다.
window.__collect = async function (targets, opts) {
  const o = opts || {};
  const gap = o.gap == null ? 800 : o.gap;      // 기본 요청 간격(ms)
  const jitter = o.jitter == null ? 400 : o.jitter;
  const BLOCK = /안전한 접속 확인|Just a moment|cf-browser-verification|Attention Required|Access Denied/i;

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

  const sleep = (ms) => new Promise(r => setTimeout(r, ms));

  async function getDoc(url) {
    const r = await fetch(url, { cache: 'no-store', credentials: 'include' });
    const buf = await r.arrayBuffer();
    let s = new TextDecoder('utf-8').decode(buf);
    const m = s.match(/charset\s*=\s*["']?([\w-]+)/i);
    if (m && !/utf-?8/i.test(m[1])) {
      try { s = new TextDecoder(m[1]).decode(buf) } catch (e) { s = new TextDecoder('euc-kr').decode(buf) }
    }
    if (!r.ok) { const e = new Error('HTTP ' + r.status); e.status = r.status; e.body = s; throw e }
    if (BLOCK.test(s.slice(0, 4000))) { const e = new Error('BLOCKED'); e.blocked = true; throw e }
    return new DOMParser().parseFromString(s, 'text/html');
  }

  // 한 번 실패하면 조금 쉬고 두 번까지 더 시도한다 (일시적 차단이면 대개 풀린다).
  async function getWithRetry(url) {
    let last = null;
    for (let a = 0; a < 3; a++) {
      try { return await getDoc(url) }
      catch (e) {
        last = e;
        if (!(e.blocked || e.status === 403 || e.status === 429)) break;
        await sleep(4000 * (a + 1));
      }
    }
    throw last;
  }

  const out = [];
  let blockedStreak = 0;
  for (const t of targets) {
    try {
      const doc = await getWithRetry(t.url);
      const rows = parseDoc(doc);
      out.push({ id: t.id, ok: rows.length > 0, asof: asOf(doc), title: (doc.title || '').trim(), rows });
      blockedStreak = 0;
    } catch (e) {
      const blocked = !!(e.blocked || e.status === 403 || e.status === 429);
      out.push({ id: t.id, ok: false, err: String(e && e.message || e), blocked, rows: [] });
      if (blocked) blockedStreak++;
      // 연속으로 막히면 더 두드리지 않고 남은 대상은 미수집으로 남긴다.
      if (blockedStreak >= 3) {
        for (const rest of targets.slice(targets.indexOf(t) + 1)) {
          out.push({ id: rest.id, ok: false, err: '연속 차단으로 중단', blocked: true, rows: [] });
        }
        break;
      }
    }
    await sleep(gap + Math.random() * jitter);
  }
  return out;
};
