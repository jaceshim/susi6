// 대학 / 전형 / 학과 목록을 퍼팩(prft) 공개 API 에서 받아 저장한다.
//
//   node scripts/build-catalog.mjs .            # 대학 목록만 (빠름, 3번 호출)
//   node scripts/build-catalog.mjs . --full     # 전형·학과 트리까지 (대학당 1+N 호출)
//
// 경쟁률 자체는 페이지가 실행 중에 API 로 직접 조회하므로 여기서 받지 않는다.
// 이 파일은 "선택 UI 를 API 응답을 기다리지 않고 바로 띄우기 위한" 스냅샷이다.
import fs from 'node:fs';
import path from 'node:path';

const API = process.env.PRFT_API || 'https://api.prft.co.kr/api/public/hub/competition-rates';
const YEAR = process.env.YEAR || '2027';
const ROOT = path.resolve(process.argv[2] || '.');
const FULL = process.argv.includes('--full');
const GAP = +(process.env.GAP_MS || 120);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const q = (o) => Object.entries(o).map(([k, v]) => k + '=' + encodeURIComponent(v)).join('&');
const writeJSON = (p, o) => { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, JSON.stringify(o)); };

async function get(pathAndQuery, tries = 3) {
  let last;
  for (let a = 0; a < tries; a++) {
    try {
      const r = await fetch(API + pathAndQuery, { headers: { accept: 'application/json' } });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      const b = await r.json();
      if (b && b.success === false) throw new Error(b.message || 'API false');
      return b.data;
    } catch (e) {
      last = e;
      await sleep(1000 * (a + 1));
    }
  }
  throw last;
}

const run = async () => {
  console.log('API ' + API + ' · year ' + YEAR);

  // 1) 실시간 경쟁률을 제공하는 대학 + 마감시각 + 원본 링크
  const meta = await get('/live-meta?' + q({ year: YEAR }));
  const sources = new Map((meta.sources || []).map((s) => [s.university_name, s]));
  const liveNames = meta.universities || [];

  // 2) 연도에 데이터가 있는 전체 대학 (실시간이 아닌 곳도 목록에는 남긴다)
  const allNames = (await get('/universities?' + q({ year: YEAR }))).universities || [];

  const names = [...new Set([...liveNames, ...allNames])].sort((a, b) => a.localeCompare(b, 'ko'));
  const univs = names.map((name, i) => {
    const s = sources.get(name);
    return {
      id: 'u' + String(i + 1).padStart(3, '0'),
      name,
      live: liveNames.includes(name),
      endAt: s ? s.recruitment_end_at : null,   // 정확한 접수 마감 시각
      url: s ? s.ratio_url : null,              // 원본 경쟁률 페이지
    };
  });

  const catalog = {
    built: new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 19),
    year: String(YEAR),
    announcedAt: meta.last_announced_at || null,
    crawledAt: meta.last_crawled_at || null,
    live: univs.filter((u) => u.live).length,
    total: univs.length,
    full: FULL,
    univs,
  };
  writeJSON(path.join(ROOT, 'data/catalog.json'), catalog);
  console.log('data/catalog.json — 대학 ' + catalog.total + '개 (실시간 ' + catalog.live + '개)');

  if (!FULL) {
    console.log('전형·학과 트리는 --full 로 만들 수 있습니다 (없으면 페이지가 API 로 그때그때 불러옵니다).');
    return;
  }

  // 3) 전형 → 학과 트리 (대학별 파일). 대학당 1 + 전형수 만큼 호출한다.
  let done = 0, units = 0, failed = [];
  for (const u of univs.filter((x) => x.live)) {
    try {
      const adms = ((await get('/admissions?' + q({ year: YEAR, university_name: u.name }))).admissions || [])
        .map((a) => (typeof a === 'string' ? { admission_name: a } : a));
      await sleep(GAP);
      const tree = [];
      for (const a of adms) {
        const deps = (await get('/departments?' + q({ year: YEAR, university_name: u.name, admission_name: a.admission_name }))).departments || [];
        tree.push({ j: a.admission_name, t: a.admission_type || null, d: deps });
        units += deps.length;
        await sleep(GAP);
      }
      writeJSON(path.join(ROOT, 'data/cat/' + u.id + '.json'),
        { id: u.id, name: u.name, year: String(YEAR), endAt: u.endAt, url: u.url, adms: tree });
      done++;
      if (done % 10 === 0) console.log('  ' + done + '개 대학 · 모집단위 ' + units + '개');
    } catch (e) {
      failed.push({ name: u.name, err: String(e.message).slice(0, 80) });
      console.log('  실패: ' + u.name + ' — ' + e.message);
    }
  }
  catalog.tree = { univs: done, units, failed };
  writeJSON(path.join(ROOT, 'data/catalog.json'), catalog);
  console.log('완료: 대학 ' + done + '개 · 모집단위 ' + units + '개' + (failed.length ? ' · 실패 ' + failed.length : ''));
};

run().catch((e) => { console.error(e); process.exit(1); });
