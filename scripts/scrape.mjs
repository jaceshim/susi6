// 2027 수시 경쟁률 수집기 — GitHub Actions 에서 주기적으로 실행된다.
// 진학사 허브 페이지에서 대학 목록을 읽고, 대학별 경쟁률 페이지를 같은 오리진 안에서 훑어
// data/index.json 과 data/u/<id>.json 을 갱신한다.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { launchBrowser, newContext, resolveUA } from './browser.mjs';

// 기본값은 진학사 허브 페이지. 테스트할 때만 HUB 환경변수로 바꾼다.
const HUB = process.env.HUB || 'https://www.jinhak.com/jh/high3/univ-entrance-info/ipsi-analysis/ipsi-strategy/100000727';
const ROOT = path.resolve(process.argv[2] || '.');
const DATA = path.join(ROOT, 'data');
const UDIR = path.join(DATA, 'u');
const MAX_SNAPS = 160; // 대학별 보관 스냅샷 수 (15분 간격이면 약 40시간)
const inPage = fs.readFileSync(new URL('./parse-in-page.js', import.meta.url), 'utf8');
// 허브에서 어떤 링크를 '대학 경쟁률 링크'로 볼지. 테스트할 때만 환경변수로 바꾼다.
const LINK_RE = process.env.HUB_LINK_RE || 'jinhakapply\\.com|uwayapply\\.com';
const LINK_MIN = +(process.env.HUB_LINK_MIN || 100);

const readJSON = (p, d) => { try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return d; } };
const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };
const nowKST = () => new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19);
const keyOf = (r) => [r.j, r.c, r.l, r.u].join('');

function classify(url) {
  const j = url.match(/addon\.jinhakapply\.com\/RatioV1\/RatioH\/Ratio(\d+)\.html/);
  if (j) return { src: 'jinhak', id: 'J' + j[1] };
  const w = url.match(/ratio\.uwayapply\.com\/(.+)$/);
  if (w) return { src: 'uway', id: 'W' + w[1].replace(/[^A-Za-z0-9]/g, '').slice(0, 24) };
  // HUB 를 바꿔 로컬 목업으로 돌릴 때는 모든 링크를 같은 오리진 수집 대상으로 본다.
  if (process.env.HUB) return { src: 'jinhak', id: 'T' + Buffer.from(url).toString('hex').slice(-10) };
  return { src: 'univ', id: 'X' + Buffer.from(url).toString('hex').slice(0, 16) };
}

// 렌더된 DOM 이 비어 있을 때를 위한 2차 수단.
// 허브는 Next.js 라 HTML 응답 안에 RSC 페이로드가 들어 있고, 거기에 경쟁률 URL 과 대학명이 그대로 담겨 있다.
// 이스케이프(\/, /)와 HTML 엔티티를 풀고 URL 주변 텍스트에서 대학명·접수기간을 집는다.
export function parseHubRaw(raw) {
  const text = String(raw)
    .replace(/\\u002[fF]/g, '/')
    .replace(/\\\//g, '/')
    .replace(/&#x2F;/gi, '/')
    .replace(/&amp;/g, '&')
    .replace(/\\"/g, '"');
  const URL_RE = /https?:\/\/(?:addon\.jinhakapply\.com\/RatioV1\/RatioH\/Ratio\d+\.html|ratio\.uwayapply\.com\/[A-Za-z0-9+/]+={0,2})/g;
  const NAME_RE = /([가-힣][가-힣A-Za-z0-9·]{1,20}(?:대학교|대학교대|대학|대))(\([^)]{1,12}\))?/g;
  const PERIOD_RE = /(\d{1,2}\.\d{1,2}\s*~\s*\d{1,2}\.\d{1,2})/g;
  const out = [], seen = new Set();
  let m;
  while ((m = URL_RE.exec(text))) {
    const url = m[0];
    if (seen.has(url)) continue;
    seen.add(url);
    const back = text.slice(Math.max(0, m.index - 800), m.index);
    const names = [...back.matchAll(NAME_RE)];
    const periods = [...back.matchAll(PERIOD_RE)];
    const last = names[names.length - 1];
    if (!last) continue;
    out.push({
      name: (last[1] + (last[2] || '')).trim(),
      period: periods.length ? periods[periods.length - 1][1].replace(/\s/g, '') : '',
      region: '',
      url,
    });
  }
  return out;
}

// 허브 페이지에서 대학 목록을 뽑는다.
// 클래스 이름(.jh-row) 하나에 의존하면 진학사가 마크업을 바꿀 때 통째로 실패하므로,
// 경쟁률 링크(anchor)를 기준으로 조상 요소를 거슬러 올라가며 대학명·접수기간을 찾는 방식을 기본으로 쓴다.
async function scrapeHub(page) {
  await page.goto(HUB, { waitUntil: 'load', timeout: 90000 });
  // 하이드레이션 + 지연 렌더를 기다린다. 링크가 100개 넘게 붙으면 끝난 것으로 본다.
  try {
    await page.waitForFunction(
      ({ re, min }) => [...document.querySelectorAll('a[href]')].filter((a) => new RegExp(re).test(a.href)).length > min,
      { re: LINK_RE, min: LINK_MIN }, { timeout: 60000 });
  } catch (e) {
    // 지연 로딩이면 끝까지 스크롤해서 한 번 더 기다린다.
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await page.waitForTimeout(4000);
  }

  let list = await page.evaluate(({ re }) => {
    const PERIOD = /(\d{1,2}\.\d{1,2}\s*~\s*\d{1,2}\.\d{1,2})/;
    const clean = (s) => (s || '').replace(/\s+/g, ' ').trim();
    const anchors = [...document.querySelectorAll('a[href]')]
      .filter((a) => new RegExp(re).test(a.href));

    // 지역 제목의 문서 순서를 미리 모아두고, 각 링크보다 앞에 있는 마지막 제목을 지역으로 삼는다.
    const heads = [...document.querySelectorAll('*')]
      .filter((e) => e.children.length === 0 && /지역\s*수시\s*경쟁률/.test(e.textContent || ''))
      .map((e) => ({ el: e, name: clean(e.textContent).split('지역')[0].trim() }));

    const regionOf = (a) => {
      let best = '';
      for (const h of heads) {
        const pos = h.el.compareDocumentPosition(a);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) best = h.name; // 제목이 링크보다 앞
      }
      return best;
    };

    // "…경쟁률 3개교 가톨릭대학교" 처럼 앞에 다른 글자가 붙어 있어도 끝에 붙은 대학명만 집는다.
    // 캠퍼스 괄호(건국대학교(서울))와 중점 표기(고려대학교(안암))를 포함한다.
    const TAIL = /([가-힣A-Za-z][가-힣A-Za-z0-9·\s]{0,28}?(?:대학교|대학|대)(?:\s*\([^)]{1,12}\))?)\s*$/;
    const strip = (s) => clean(s).replace(/\s*(경쟁률\s*보기|경쟁률|보기|준비중|입학처)\s*/g, ' ').trim();

    const out = [];
    for (const a of anchors) {
      // 대학명 + 접수기간이 같이 들어 있는 가장 가까운 조상을 찾는다.
      let node = a.parentElement, name = '', period = '';
      for (let up = 0; up < 6 && node; up++, node = node.parentElement) {
        const t = clean(node.textContent);
        if (t.length > 400) break;                       // 너무 크면 여러 대학이 섞인 컨테이너
        const m = t.match(PERIOD);
        if (!m) continue;
        const tail = strip(t.slice(0, m.index)).match(TAIL);
        if (tail) { name = tail[1].trim(); period = m[1].replace(/\s/g, ''); break; }
      }
      if (!name) {
        // 접수기간이 없는 행(준비중 등)도 대학명만 있으면 담는다.
        let n2 = a.parentElement;
        for (let up = 0; up < 4 && n2; up++, n2 = n2.parentElement) {
          const t = strip(n2.textContent);
          if (!t || t.length > 60) continue;
          const tail = t.match(TAIL);
          if (tail) { name = tail[1].trim(); break; }
        }
      }
      if (!name) continue;
      out.push({ name, period, region: regionOf(a), url: a.href });
    }
    // 같은 대학이 두 번 잡히면 첫 번째만
    const seen = new Set();
    return out.filter((x) => (seen.has(x.url) ? false : (seen.add(x.url), true)));
  }, { re: LINK_RE });

  if (list.length >= LINK_MIN) return { list, how: 'DOM' };

  // 1차(DOM)가 부실하면 렌더된 HTML → 원본 응답 순으로 정규식 파싱을 시도한다.
  console.log('DOM 파싱 결과 ' + list.length + '개 — 원문 파싱으로 재시도');
  const fromDom = parseHubRaw(await page.content());
  if (fromDom.length > list.length) list = fromDom;
  if (list.length < LINK_MIN) {
    try {
      const res = await page.request.get(HUB, { timeout: 60000 });
      const fromRaw = parseHubRaw(await res.text());
      if (fromRaw.length > list.length) return { list: fromRaw, how: 'RAW' };
    } catch (e) { console.log('원본 응답 파싱 실패: ' + e.message); }
  }
  return { list, how: list === fromDom ? 'HTML' : 'DOM' };
}

// 진학사/유웨이 계열이 러너 IP 를 막을 때 내려주는 차단 페이지를 알아본다.
const BLOCK_RE = /안전한 접속 확인|Just a moment|cf-browser-verification|Attention Required|Access Denied/i;

async function collect(ctx, targets) {
  if (!targets.length) return [];
  const page = await ctx.newPage();
  const out = [];
  try {
    const res = await page.goto(targets[0].url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    const status = res ? res.status() : 0;
    const head = (await page.content()).slice(0, 4000);
    if (status >= 400 || BLOCK_RE.test(head)) {
      // 이 호스트는 통째로 막혔다. 85개를 하나씩 실패시키지 말고 한 번에 사유를 붙인다.
      const why = '호스트 차단 (HTTP ' + status + (BLOCK_RE.test(head) ? ', 접속 확인 페이지' : '') + ')';
      console.log('  ' + why + ' — ' + targets.length + '개 건너뜀');
      await page.close();
      return targets.map((t) => ({ id: t.id, ok: false, err: why, blockedHost: true, rows: [] }));
    }
    await page.addScriptTag({ content: inPage });
    // 한 번에 너무 많이 돌리면 evaluate 가 타임아웃되므로 20개씩 끊는다.
    for (let i = 0; i < targets.length; i += 20) {
      const chunk = targets.slice(i, i + 20).map((t) => ({ id: t.id, url: t.url }));
      const res = await page.evaluate((t) => window.__collect(t), chunk);
      out.push(...res);
      console.log('  ' + Math.min(i + 20, targets.length) + '/' + targets.length);
    }
  } finally { if (!page.isClosed()) await page.close(); }
  return out;
}

function mergeUniv(meta, got, stamp) {
  const file = path.join(UDIR, meta.id + '.json');
  const prev = readJSON(file, null);
  const units = prev && Array.isArray(prev.units) ? prev.units.slice() : [];
  const idx = new Map(units.map((u, i) => [keyOf(u), i]));

  for (const r of got.rows) {
    const k = keyOf(r);
    if (!idx.has(k)) { idx.set(k, units.length); units.push({ j: r.j, c: r.c, l: r.l, u: r.u, q: r.q }); }
    else units[idx.get(k)].q = r.q; // 모집인원 정정 반영
  }
  const a = new Array(units.length).fill(null);
  for (const r of got.rows) a[idx.get(keyOf(r))] = r.a;

  const snaps = prev && Array.isArray(prev.snaps) ? prev.snaps.slice() : [];
  const at = got.asof || stamp;
  const last = snaps[snaps.length - 1];
  if (last && last.t === at) snaps[snaps.length - 1] = { t: at, a }; // 같은 기준시각이면 교체
  else snaps.push({ t: at, a });
  while (snaps.length > MAX_SNAPS) snaps.shift();

  const quota = units.reduce((s, u) => s + (u.q || 0), 0);
  const apply = a.reduce((s, v) => s + (v || 0), 0);
  writeJSON(file, {
    id: meta.id, name: meta.name, region: meta.region, period: meta.period,
    url: meta.url, src: meta.src, asof: at, units, snaps,
  });
  return { quota, apply, nunits: units.length, asof: at };
}

const run = async () => {
  const browser = await launchBrowser();
  const CTX = await newContext(browser, ROOT);
  console.log('UA: ' + resolveUA(ROOT));
  const stamp = nowKST();
  let list = [], hubError = null;
  try {
    const page = await CTX.newPage();
    let how = '-';
    try { const r = await scrapeHub(page); list = r.list; how = r.how; }
    catch (e) { hubError = e.message; console.log('허브 수집 실패: ' + e.message); }
    await page.close();

    console.log('허브에서 읽은 대학 ' + list.length + '개 (경로 ' + how + ')');
    if (list.length) console.log('  예: ' + list.slice(0, 3).map((u) => u.name + '/' + u.period + '/' + u.region).join(', '));

    // 허브가 부실하면 지난 성공 결과(대학 목록)를 재사용한다.
    const prevIndex = readJSON(path.join(DATA, 'index.json'), null);
    const prevList = readJSON(path.join(DATA, 'univs.json'), null);
    const fallback = (prevList && prevList.length ? prevList : null)
      || (prevIndex && prevIndex.univs && prevIndex.univs.length
        ? prevIndex.univs.map((u) => ({ name: u.name, region: u.region, period: u.period, url: u.url }))
        : null);
    if (list.length < 100 && fallback) {
      console.log('허브 결과가 부족해 저장된 목록을 사용: ' + fallback.length);
      list = fallback;
    }

    // 목록이 아예 없으면 아무것도 덮어쓰지 않고 실패로 끝낸다.
    // (예전에는 빈 index.json 을 커밋해 화면에서 대학 선택이 불가능해졌다)
    if (!list.length) {
      writeJSON(path.join(DATA, 'status.json'), {
        built: stamp, ok: false,
        reason: '허브에서 대학 목록을 읽지 못했고 재사용할 목록도 없습니다.',
        hubError, hub: HUB, how,
      });
      throw new Error('대학 목록이 비어 있어 중단합니다 (data/index.json 은 그대로 둡니다)');
    }

    const metas = list.map((u) => ({ ...u, ...classify(u.url) }));
    console.log('수집 대상 ' + metas.length + '개');

    const byHost = { jinhak: [], uway: [] };
    for (const m of metas) if (byHost[m.src]) byHost[m.src].push(m);

    // 한 계열이 막혀도 다른 계열은 그대로 모은다. ONLY_SRC 로 한쪽만 돌릴 수도 있다.
    const only = (process.env.ONLY_SRC || '').split(',').filter(Boolean);
    const results = new Map();
    const hostStat = {};
    for (const src of ['jinhak', 'uway']) {
      const tgt = byHost[src];
      if (only.length && !only.includes(src)) {
        console.log(src + ' ' + tgt.length + '개 — ONLY_SRC 로 건너뜀');
        hostStat[src] = { total: tgt.length, skipped: true };
        continue;
      }
      console.log(src + ' ' + tgt.length);
      const rs = await collect(CTX, tgt);
      for (const r of rs) results.set(r.id, r);
      hostStat[src] = {
        total: tgt.length,
        ok: rs.filter((r) => r.rows.length).length,
        blocked: rs.some((r) => r.blockedHost),
        note: rs.length && rs[0].blockedHost ? rs[0].err : undefined,
      };
    }
    console.log('계열별: ' + JSON.stringify(hostStat));

    const univs = metas.map((m) => {
      const got = results.get(m.id);
      const base = { id: m.id, name: m.name, region: m.region, period: m.period, url: m.url, src: m.src };
      if (!got || !got.rows.length) {
        const prev = readJSON(path.join(UDIR, m.id + '.json'), null);
        if (prev) {
          const lastA = prev.snaps && prev.snaps.length ? prev.snaps[prev.snaps.length - 1].a : [];
          return {
            ...base, ok: false, stale: true, asof: prev.asof,
            quota: (prev.units || []).reduce((s, u) => s + (u.q || 0), 0),
            apply: lastA.reduce((s, v) => s + (v || 0), 0),
            units: (prev.units || []).length,
          };
        }
        return { ...base, ok: false, note: m.src === 'univ' ? '대학 자체 페이지' : ((got && got.err) || '수집 실패') };
      }
      const s = mergeUniv(m, got, stamp);
      return { ...base, ok: true, asof: s.asof, quota: s.quota, apply: s.apply, units: s.nunits };
    });

    const okCount = univs.filter((u) => u.ok).length;

    // 한 곳도 못 읽었으면 기존 index.json 을 유지하고 실패로 끝낸다.
    if (!okCount && !univs.some((u) => u.stale)) {
      writeJSON(path.join(DATA, 'status.json'), {
        built: stamp, ok: false,
        reason: '대학 목록은 있었지만 경쟁률 페이지를 한 곳도 읽지 못했습니다.',
        hubError, hostStat, total: univs.length,
        samples: univs.slice(0, 5).map((u) => ({ name: u.name, url: u.url, note: u.note })),
      });
      throw new Error('경쟁률 수집이 모두 실패해 중단합니다 (data/index.json 은 그대로 둡니다)');
    }

    writeJSON(path.join(DATA, 'univs.json'), list);
    writeJSON(path.join(DATA, 'index.json'), { built: stamp, ok: okCount, total: univs.length, univs });
    writeJSON(path.join(DATA, 'status.json'), {
      built: stamp, ok: true, hubError, how, hostStat,
      hubCount: list.length, collected: okCount, total: univs.length,
      failed: univs.filter((u) => !u.ok).map((u) => ({ name: u.name, src: u.src, note: u.note, stale: !!u.stale })),
    });
    console.log('완료: 성공 ' + okCount + ' / ' + univs.length);
  } finally { await browser.close(); }
};

// 이 파일을 직접 실행할 때만 수집을 돌린다 (테스트에서 parseHubRaw 만 import 할 수 있게).
const isMain = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) run().catch((e) => { console.error(e); process.exit(1); });
