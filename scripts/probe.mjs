// 러너에서 각 호스트에 실제로 닿는지, 그리고 막혔다면 어떤 종류인지 가른다.
//
// "안전한 접속 확인" 은 두 가지일 수 있다.
//   (1) JS 챌린지 인터스티셜 — 잠깐 기다리면 쿠키가 발급되고 본문이 나온다 (해결 가능)
//   (2) IP 기반 하드 차단 — 아무리 기다려도 그대로다 (실행 위치를 옮겨야 한다)
// 그래서 한 번 열어보고 끝내지 않고, 기다렸다가 다시 열어보고, 쿠키·스크립트·헤더까지 남긴다.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newContext, resolveUA, saveState } from './browser.mjs';

const TARGETS = [
  ['허브(jinhak.com)', 'https://www.jinhak.com/jh/high3/univ-entrance-info/ipsi-analysis/ipsi-strategy/100000727'],
  ['진학사 경쟁률(addon.jinhakapply.com)', 'https://addon.jinhakapply.com/RatioV1/RatioH/Ratio10030381.html'],
  ['유웨이 경쟁률(ratio.uwayapply.com)', 'https://ratio.uwayapply.com/Sl5KOnw5SmYlJjomSjdmVGY='],
];
const BLOCK = /안전한 접속 확인|Just a moment|cf-browser-verification|Attention Required|접속이 차단|Access Denied|error code: \d+/i;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const ROOT = process.argv[2] || '.';
const browser = await launchBrowser();
const ctx = await newContext(browser, ROOT);
console.log('UA: ' + resolveUA(ROOT));

async function look(page, url) {
  const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
  const html = await page.content();
  return {
    status: res ? res.status() : null,
    headers: res ? pick(res.headers()) : null,
    bytes: html.length,
    title: (await page.title()).slice(0, 60),
    blocked: BLOCK.test(html.slice(0, 4000)),
    hasTable: /모집단위/.test(html),
    ratioLinks: (html.match(/jinhakapply\.com|uwayapply\.com/g) || []).length,
  };
}

// 차단 페이지가 무엇으로 판정하는지 단서가 되는 헤더만 남긴다.
function pick(h) {
  const keep = ['server', 'x-powered-by', 'cf-ray', 'cf-mitigated', 'retry-after',
    'x-cache', 'via', 'set-cookie', 'content-type'];
  const o = {};
  for (const k of keep) if (h[k]) o[k] = String(h[k]).slice(0, 120);
  return o;
}

const out = [];
for (const [label, url] of TARGETS) {
  const page = await ctx.newPage();
  const row = { label, url };
  try {
    const a = await look(page, url);
    Object.assign(row, a);

    if (a.blocked || (a.status && a.status >= 400)) {
      // 챌린지가 스스로 걷히는지 본다 (최대 25초).
      let cleared = false;
      try {
        await page.waitForFunction(
          (re) => !new RegExp(re, 'i').test(document.documentElement.innerHTML.slice(0, 4000)),
          BLOCK.source, { timeout: 25000 });
        cleared = true;
      } catch (e) { /* 안 걷힘 */ }
      row.selfCleared = cleared;

      // 챌린지 페이지의 성격을 남긴다: 스크립트·메타 리프레시·쿠키
      row.challenge = await page.evaluate(() => ({
        scripts: [...document.querySelectorAll('script[src]')].map((s) => s.src).slice(0, 6),
        inlineScripts: document.querySelectorAll('script:not([src])').length,
        metaRefresh: (document.querySelector('meta[http-equiv="refresh"]') || {}).content || null,
        forms: document.querySelectorAll('form').length,
        text: (document.body ? document.body.innerText : '').replace(/\s+/g, ' ').slice(0, 240),
      }));
      row.cookies = (await ctx.cookies(url)).map((c) => c.name).slice(0, 12);

      // 20초 쉬고 완전히 새로 한 번 더 (일시적 속도 제한이면 이때 풀린다)
      await sleep(20000);
      const b = await look(page, url);
      row.retryAfterWait = { status: b.status, blocked: b.blocked, hasTable: b.hasTable, bytes: b.bytes };
      row.verdict = (!b.blocked && b.status < 400)
        ? '일시적 차단 — 간격을 늘리면 수집 가능'
        : (cleared ? '챌린지는 걷히지만 본문 접근은 거부' : 'IP 기반 하드 차단으로 보임');
    } else {
      row.verdict = '정상';
    }
  } catch (e) {
    row.error = String(e.message).split('\n')[0].slice(0, 160);
    row.verdict = '접속 실패';
  }
  await page.close();
  out.push(row);
  console.log(row.label + ' → ' + row.verdict + ' (status ' + row.status + ', blocked ' + row.blocked + ')');
}
await saveState(ctx, ROOT);
await browser.close();

const dir = path.resolve(ROOT, 'data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'probe.json'),
  JSON.stringify({ at: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19), ua: resolveUA(ROOT), targets: out }, null, 1));
console.log('data/probe.json 저장');
