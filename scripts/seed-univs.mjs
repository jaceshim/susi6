// 허브 페이지를 Actions 에서 못 읽을 때 쓰는 비상 수단.
// 브라우저에서 진학사 허브 페이지를 열고 "다른 이름으로 저장"(또는 Ctrl+U 로 소스 복사) 한 뒤:
//
//   node scripts/seed-univs.mjs 저장한파일.html
//
// data/univs.json 을 만들어 준다. 이후 수집기는 허브가 실패해도 이 목록으로 계속 수집한다.
import fs from 'node:fs';
import path from 'node:path';
import { parseHubRaw } from './scrape.mjs';

const src = process.argv[2];
if (!src) {
  console.error('사용법: node scripts/seed-univs.mjs <저장한 허브 HTML 파일>');
  process.exit(2);
}
const raw = fs.readFileSync(src, 'utf8');
const list = parseHubRaw(raw);
if (!list.length) {
  console.error('경쟁률 링크를 찾지 못했습니다. 저장한 파일이 허브 페이지인지 확인하세요.');
  process.exit(1);
}
const out = path.resolve('data/univs.json');
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify(list));
console.log('data/univs.json 저장: 대학 ' + list.length + '개');
console.log(list.slice(0, 5).map((u) => '  ' + u.name + ' ' + u.period).join('\n'));
