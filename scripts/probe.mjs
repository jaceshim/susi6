// 러너에서 각 호스트에 실제로 닿는지 확인한다. 수집이 0개로 끝날 때 원인을 가르는 용도.
// 헤드리스 브라우저로 열어 상태코드·본문 크기·제목·차단 흔적을 남긴다.
import fs from 'node:fs';
import path from 'node:path';
import { launchBrowser, newContext, resolveUA } from './browser.mjs';

const TARGETS = [
  ['허브(jinhak.com)', 'https://www.jinhak.com/jh/high3/univ-entrance-info/ipsi-analysis/ipsi-strategy/100000727'],
  ['진학사 경쟁률(addon.jinhakapply.com)', 'https://addon.jinhakapply.com/RatioV1/RatioH/Ratio10030381.html'],
  ['유웨이 경쟁률(ratio.uwayapply.com)', 'https://ratio.uwayapply.com/Sl5KOnw5SmYlJjomSjdmVGY='],
];
const BLOCK = /안전한 접속 확인|Just a moment|cf-browser-verification|Attention Required|접속이 차단|Access Denied|error code: \d+/i;

const ROOT = process.argv[2] || '.';
const browser = await launchBrowser();
const ctx = await newContext(browser, ROOT);
console.log('UA: ' + resolveUA(ROOT));
const out = [];
for (const [label, url] of TARGETS) {
  const page = await ctx.newPage();
  const row = { label, url };
  try {
    const res = await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 45000 });
    const html = await page.content();
    row.status = res ? res.status() : null;
    row.bytes = html.length;
    row.title = (await page.title()).slice(0, 60);
    row.blocked = BLOCK.test(html);
    row.ratioLinks = (html.match(/jinhakapply\.com|uwayapply\.com/g) || []).length;
    row.hasTable = /모집단위/.test(html);
  } catch (e) {
    row.error = String(e.message).split('\n')[0].slice(0, 160);
  }
  await page.close();
  out.push(row);
  console.log(JSON.stringify(row));
}
await browser.close();

const dir = path.resolve(ROOT, 'data');
fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(path.join(dir, 'probe.json'),
  JSON.stringify({ at: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19), ua: resolveUA(ROOT), targets: out }, null, 1));
console.log('data/probe.json 저장');
