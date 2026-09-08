// 2027 수시 경쟁률 수집기 — GitHub Actions 에서 주기적으로 실행된다.
// 진학사 허브 페이지에서 대학 목록을 읽고, 대학별 경쟁률 페이지를 같은 오리진 안에서 훑어
// data/index.json 과 data/u/<id>.json 을 갱신한다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// 기본값은 진학사 허브 페이지. 테스트할 때만 HUB 환경변수로 바꾼다.
const HUB = process.env.HUB || 'https://www.jinhak.com/jh/high3/univ-entrance-info/ipsi-analysis/ipsi-strategy/100000727';
const ROOT = path.resolve(process.argv[2] || '.');
const DATA = path.join(ROOT, 'data');
const UDIR = path.join(DATA, 'u');
const MAX_SNAPS = 160; // 대학별 보관 스냅샷 수 (15분 간격이면 약 40시간)
const inPage = fs.readFileSync(new URL('./parse-in-page.js', import.meta.url), 'utf8');

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

async function scrapeHub(page) {
  await page.goto(HUB, { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForSelector('.jh-row', { timeout: 30000 });
  return await page.evaluate(() => [...document.querySelectorAll('.jh-row')].map((r) => {
    const a = r.querySelector('a[href]');
    const grid = r.closest('.jh-grid');
    let region = '';
    if (grid) {
      let s = grid.previousElementSibling;
      while (s && !/지역 수시 경쟁률/.test(s.innerText || '')) s = s.previousElementSibling;
      if (s) region = (s.innerText || '').trim().split(' 지역')[0];
    }
    const t = r.innerText.trim().replace(/\s+/g, ' ');
    const m = t.match(/^(.+?)\s+(\d{1,2}\.\d{1,2}\s*~\s*\d{1,2}\.\d{1,2})/);
    return {
      name: (m ? m[1] : t.replace(/\s*(경쟁률 보기|준비중|입학처)\s*$/g, '')).trim(),
      period: m ? m[2].replace(/\s/g, '') : '',
      region,
      url: a ? a.href : '',
    };
  }).filter((x) => x.name && x.url));
}

async function collect(browser, targets) {
  if (!targets.length) return [];
  const page = await browser.newPage();
  const out = [];
  try {
    await page.goto(targets[0].url, { waitUntil: 'domcontentloaded', timeout: 60000 });
    await page.addScriptTag({ content: inPage });
    // 한 번에 너무 많이 돌리면 evaluate 가 타임아웃되므로 20개씩 끊는다.
    for (let i = 0; i < targets.length; i += 20) {
      const chunk = targets.slice(i, i + 20).map((t) => ({ id: t.id, url: t.url }));
      const res = await page.evaluate((t) => window.__collect(t), chunk);
      out.push(...res);
      console.log('  ' + Math.min(i + 20, targets.length) + '/' + targets.length);
    }
  } finally { await page.close(); }
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
  const launch = { args: ['--no-sandbox'] };
  if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM; // 로컬 테스트용
  const browser = await chromium.launch(launch);
  const stamp = nowKST();
  let list = [];
  try {
    const page = await browser.newPage();
    try { list = await scrapeHub(page); } catch (e) { console.log('허브 수집 실패: ' + e.message); }
    await page.close();

    const prevIndex = readJSON(path.join(DATA, 'index.json'), null);
    if (list.length < 100 && prevIndex && prevIndex.univs) {
      console.log('허브 결과가 부족해 이전 목록을 사용: ' + prevIndex.univs.length);
      list = prevIndex.univs.map((u) => ({ name: u.name, region: u.region, period: u.period, url: u.url }));
    }
    const metas = list.map((u) => ({ ...u, ...classify(u.url) }));
    console.log('대학 ' + metas.length + '개');

    const byHost = { jinhak: [], uway: [] };
    for (const m of metas) if (byHost[m.src]) byHost[m.src].push(m);

    const results = new Map();
    for (const src of ['jinhak', 'uway']) {
      console.log(src + ' ' + byHost[src].length);
      for (const r of await collect(browser, byHost[src])) results.set(r.id, r);
    }

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

    writeJSON(path.join(DATA, 'index.json'), {
      built: stamp,
      ok: univs.filter((u) => u.ok).length,
      total: univs.length,
      univs,
    });
    console.log('완료: 성공 ' + univs.filter((u) => u.ok).length + ' / ' + univs.length);
  } finally { await browser.close(); }
};

run().catch((e) => { console.error(e); process.exit(1); });
