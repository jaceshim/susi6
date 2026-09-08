/* 2027 수시 경쟁률 현황 — 정적 페이지. data/ 아래 JSON 만 읽는다. */
'use strict';

const $ = (id) => document.getElementById(id);
const MAXW = 20, DEFW = 6;
const PERIODS = { 60: '1분', 180: '3분', 300: '5분', 600: '10분', 1800: '30분' };
const KEY = 'ratio2027:v1';

/* ---------- 상태 ---------- */
let S = { watch: [], auto: true, period: 300, sort: 'add' };
let IDX = null;                 // data/index.json
let ST = null;                  // data/status.json (수집 진단)
const CACHE = new Map();        // univId -> data/u/<id>.json
let timer = null, tick = null, nextAt = 0, loading = false;

function load() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const o = JSON.parse(raw);
      if (o && typeof o === 'object') S = Object.assign(S, o);
    }
  } catch (e) {}
  if (!Array.isArray(S.watch)) S.watch = [];
  S.watch = S.watch.slice(0, MAXW);
}
function save() { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} }

function toast(msg, ms) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._h);
  t._h = setTimeout(() => t.classList.remove('show'), ms || 2600);
}

/* ---------- 유틸 ---------- */
const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const unitKey = (u) => [u.j, u.c, u.l, u.u].join('');
const watchKey = (w) => [w.j, w.c, w.l, w.d].join('');
const fmtRatio = (r) => (r == null ? '—' : r.toFixed(2));
const nfmt = (n) => (n == null ? '—' : n.toLocaleString('ko-KR'));

function band(r) {
  if (r == null) return '';
  if (r < 3) return 'lo';
  if (r < 8) return 'mid';
  if (r < 15) return 'hi';
  return 'vhi';
}
function bandLabel(r) {
  if (r == null) return '집계 대기';
  if (r < 3) return '여유';
  if (r < 8) return '보통';
  if (r < 15) return '높음';
  return '매우 높음';
}

/** "2026-09-08T15:00" -> "9/8 15:00" */
function shortTime(t) {
  if (!t) return '—';
  const m = String(t).match(/(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return String(t);
  return +m[2] + '/' + +m[3] + ' ' + m[4] + ':' + m[5];
}

/** 접수기간 "9.7~9.11" 의 마지막 날을 KST 기준 Date 로 (마감 시각은 대학마다 달라 18시로 가정) */
function endOf(period) {
  const m = String(period || '').match(/~\s*(\d{1,2})\.(\d{1,2})/);
  if (!m) return null;
  const year = 2026;
  return new Date(Date.UTC(year, +m[1] - 1, +m[2], 18 - 9, 0, 0));
}
function ddText(period) {
  const e = endOf(period);
  if (!e) return '';
  const diff = e.getTime() - Date.now();
  if (diff <= 0) return '마감';
  const h = Math.floor(diff / 3600e3), mi = Math.floor((diff % 3600e3) / 60e3);
  if (h >= 24) return 'D-' + Math.floor(h / 24) + ' ' + (h % 24) + '시간';
  return h + '시간 ' + mi + '분 남음';
}

/* ---------- 데이터 ---------- */
async function getJSON(url) {
  const r = await fetch(url + (url.includes('?') ? '&' : '?') + 't=' + Date.now(), { cache: 'no-store' });
  if (!r.ok) throw new Error('HTTP ' + r.status);
  return await r.json();
}

async function fetchIndex() { IDX = await getJSON('data/index.json'); }

// 진단은 있으면 좋고 없어도 되는 정보라 실패를 무시한다.
async function fetchStatus() {
  try {
    const r = await fetch('data/status.json?t=' + Date.now(), { cache: 'no-store' });
    ST = r.ok ? await r.json() : null;
  } catch (e) { ST = null; }
}

async function fetchUniv(id) {
  const d = await getJSON('data/u/' + id + '.json');
  CACHE.set(id, d);
  return d;
}

async function refresh(quiet) {
  if (loading) return;
  loading = true;
  $('refresh').disabled = true;
  $('hrefresh').disabled = true;
  try {
    await Promise.all([fetchIndex(), fetchStatus()]);
    const ids = [...new Set(S.watch.map((w) => w.u))];
    await Promise.all(ids.map((id) => fetchUniv(id).catch(() => null)));
    render();
    if (!quiet) toast('경쟁률을 다시 불러왔습니다 · 수집 ' + shortTime(IDX.built));
  } catch (e) {
    if (!quiet) toast('불러오기 실패: ' + e.message, 4000);
    renderNoData(e);
  } finally {
    loading = false;
    $('refresh').disabled = false;
    $('hrefresh').disabled = false;
    scheduleNext();
  }
}

function scheduleNext() {
  clearTimeout(timer);
  clearInterval(tick);
  if (!S.auto) { nextAt = 0; paintHead(); return; }
  nextAt = Date.now() + S.period * 1000;
  timer = setTimeout(() => refresh(true), S.period * 1000);
  tick = setInterval(paintHead, 1000);
  paintHead();
}

/* ---------- 헤더 ---------- */
function paintHead() {
  const h = $('hstat');
  if (!h) return;
  const left = nextAt ? Math.max(0, Math.round((nextAt - Date.now()) / 1000)) : null;
  const mm = left == null ? '' : Math.floor(left / 60) + ':' + String(left % 60).padStart(2, '0');
  const parts = [];
  parts.push('<div class="tl' + (IDX ? ' live' : '') + '"><small>수집 시각</small><b>' +
    (IDX ? '<span class="dotlive"></span>' + esc(shortTime(IDX.built)) : '데이터 없음') + '</b></div>');
  parts.push('<div class="tl"><small>자동 갱신</small><b>' +
    (S.auto ? (mm ? esc(mm) + ' 후' : '대기') : '꺼짐') + '</b></div>');
  const per = S.watch.length ? (uOf(S.watch[0].u) || {}).period : '9.7~9.11';
  parts.push('<div class="tl hot"><small>접수 마감</small><b>' + esc(ddText(per) || '9.11') + '</b></div>');
  h.innerHTML = parts.join('');
}

const uOf = (id) => (IDX && IDX.univs ? IDX.univs.find((u) => u.id === id) : null);

/* ---------- 선택 UI ---------- */
function fillUnivList() {
  const dl = $('ulist');
  if (!IDX || !IDX.univs) { dl.innerHTML = ''; return; }
  dl.innerHTML = IDX.univs.filter((u) => u.ok || u.stale)
    .map((u) => '<option value="' + esc(u.name) + '">' + esc(u.region) + ' · 모집단위 ' + (u.units || 0) + '</option>').join('');
}

let selUniv = null;

async function onUnivPick() {
  const name = $('uq').value.trim();
  const u = IDX && IDX.univs ? IDX.univs.find((x) => x.name === name) : null;
  const js = $('jsel'), ds = $('dsel');
  if (!u) {
    selUniv = null;
    js.innerHTML = '<option value="">대학을 먼저 고르세요</option>';
    ds.innerHTML = '<option value="">전형을 먼저 고르세요</option>';
    $('addbtn').disabled = true;
    return;
  }
  if (!u.ok && !u.stale) {
    selUniv = null;
    js.innerHTML = '<option value="">' + esc(u.note || '수집되지 않는 대학') + '</option>';
    ds.innerHTML = '<option value="">—</option>';
    $('addbtn').disabled = true;
    return;
  }
  js.innerHTML = '<option value="">불러오는 중…</option>';
  let d = CACHE.get(u.id);
  if (!d) { try { d = await fetchUniv(u.id); } catch (e) { js.innerHTML = '<option value="">불러오기 실패</option>'; return; } }
  selUniv = d;
  const jungs = [...new Set(d.units.map((x) => x.j))];
  js.innerHTML = jungs.map((j) => '<option value="' + esc(j) + '">' + esc(j) + '</option>').join('');
  onJungPick();
}

function onJungPick() {
  const ds = $('dsel');
  if (!selUniv) return;
  const j = $('jsel').value;
  const rows = selUniv.units.map((u, i) => ({ u, i })).filter((x) => x.u.j === j);
  ds.innerHTML = rows.map((x) => {
    const label = [x.u.c, x.u.l, x.u.u].filter(Boolean).join(' · ');
    return '<option value="' + x.i + '">' + esc(label) + ' (모집 ' + x.u.q + ')</option>';
  }).join('');
  $('addbtn').disabled = !rows.length || S.watch.length >= MAXW;
}

function addWatch() {
  if (!selUniv) return;
  if (S.watch.length >= MAXW) { toast('최대 ' + MAXW + '개까지만 담을 수 있습니다.'); return; }
  const i = +$('dsel').value;
  const u = selUniv.units[i];
  if (!u) return;
  const w = { u: selUniv.id, j: u.j, c: u.c, l: u.l, d: u.u };
  if (S.watch.some((x) => x.u === w.u && watchKey(x) === watchKey(w))) { toast('이미 담긴 모집단위입니다.'); return; }
  S.watch.push(w);
  save();
  render();
  toast('추가: ' + selUniv.name + ' ' + u.u);
}

function removeWatch(n) {
  const w = S.watch[n];
  if (!w) return;
  S.watch.splice(n, 1);
  save();
  render();
  toast('제거: ' + w.d);
}

/* ---------- 계산 ---------- */
function rowOf(w) {
  const d = CACHE.get(w.u);
  if (!d) return null;
  const k = watchKey(w);
  const i = d.units.findIndex((u) => unitKey(u) === k);
  if (i < 0) return { miss: true, univ: d };
  const q = d.units[i].q;
  const series = d.snaps.map((s) => ({ t: s.t, a: s.a[i] })).filter((x) => x.a != null);
  const cur = series.length ? series[series.length - 1] : null;
  const prev = series.length > 1 ? series[series.length - 2] : null;
  const ratio = cur && q ? cur.a / q : null;
  return {
    univ: d, unit: d.units[i], q,
    apply: cur ? cur.a : null,
    at: cur ? cur.t : d.asof,
    delta: cur && prev ? cur.a - prev.a : null,
    ratio, series,
  };
}

function sparkline(series, q) {
  if (!series || series.length < 2 || !q) return '';
  const vals = series.slice(-24).map((s) => s.a / q);
  const max = Math.max(...vals), min = Math.min(...vals);
  const span = max - min || 1;
  const W = 104, H = 42, P = 3;
  const pts = vals.map((v, i) => {
    const x = P + (i / (vals.length - 1)) * (W - P * 2);
    const y = H - P - ((v - min) / span) * (H - P * 2);
    return x.toFixed(1) + ',' + y.toFixed(1);
  });
  return '<svg class="spark" viewBox="0 0 ' + W + ' ' + H + '" aria-hidden="true">' +
    '<polyline fill="none" stroke="var(--c,currentColor)" stroke-width="1.8" stroke-linejoin="round" stroke-linecap="round" points="' + pts.join(' ') + '"></polyline>' +
    '<circle cx="' + pts[pts.length - 1].split(',')[0] + '" cy="' + pts[pts.length - 1].split(',')[1] + '" r="2.4" fill="var(--c,currentColor)"></circle></svg>';
}

/* ---------- 렌더 ---------- */
let nodataShown = false;
function renderNoData(err) {
  $('results').innerHTML = '<div class="empty" id="nodata"><b>경쟁률 데이터를 아직 읽을 수 없습니다.</b><br>' +
    'GitHub Actions 의 <b>수시 경쟁률 수집</b> 워크플로를 한 번 실행하면 <code>data/index.json</code> 이 채워집니다.' +
    (err ? '<br><span style="font-size:12px">(' + esc(err.message) + ')</span>' : '') + '</div>';
  paintFoot();
  if (nodataShown) return;   // 진단 파일은 한 번만 읽는다
  nodataShown = true;
  // 수집기가 남긴 진단 파일이 있으면 실패 이유를 그대로 보여준다.
  // 파일이 없을 수도 있으므로 404 는 조용히 넘긴다.
  fetch('data/status.json?t=' + Date.now(), { cache: 'no-store' }).then((r) => (r.ok ? r.json() : null)).then((s) => {
    const box = $('nodata');
    if (!box || !s) return;
    box.innerHTML += '<div style="margin-top:14px;padding:10px 12px;border:1px solid var(--line);border-radius:8px;text-align:left;font-size:12.5px;color:var(--ink-2)">' +
      '<b>수집기 진단</b>' + (s.built ? ' (' + esc(shortTime(s.built)) + ')' : '') + '<br>' +
      (s.reason ? esc(s.reason) + '<br>' : '') +
      (s.hubError ? '허브 오류: ' + esc(s.hubError) + '<br>' : '') +
      (s.hubCount != null ? '허브에서 읽은 대학 ' + s.hubCount + '개(경로 ' + esc(s.how || '-') + ') · 수집 성공 ' + (s.collected || 0) + '개' : '') +
      '</div>';
  }).catch(() => {});
}

function render() {
  fillUnivList();
  $('wcount').textContent = S.watch.length + ' / ' + (S.watch.length > DEFW ? MAXW : DEFW);
  $('periodlabel').textContent = PERIODS[S.period] || S.period + '초';
  paintHead();
  paintPanel();
  if (!IDX || !(IDX.univs || []).length) { renderNoData(null); return; }

  const rows = S.watch.map((w, n) => ({ w, n, r: rowOf(w) }));
  const order = rows.slice();
  if (S.sort === 'hi') order.sort((a, b) => (b.r && b.r.ratio || -1) - (a.r && a.r.ratio || -1));
  if (S.sort === 'lo') order.sort((a, b) => (a.r && a.r.ratio == null ? 9e9 : a.r.ratio) - (b.r && b.r.ratio == null ? 9e9 : b.r.ratio));
  if (S.sort === 'delta') order.sort((a, b) => (b.r && b.r.delta || 0) - (a.r && a.r.delta || 0));

  const html = [];
  html.push(summaryHTML(rows));
  html.push('<h2 class="sec">담은 모집단위 <small>' + S.watch.length + '개' +
    (S.sort === 'add' ? '' : ' · 정렬 적용') + '</small></h2>');
  if (!S.watch.length) {
    html.push('<div class="empty"><b>아직 담은 모집단위가 없습니다.</b><br>왼쪽에서 대학 → 전형 → 모집단위를 골라 담아주세요.<br>' +
      '수집 성공 ' + (IDX.ok || 0) + ' / ' + (IDX.total || 0) + '개 대학</div>');
  } else {
    html.push('<div class="cards">' + order.map((o) => cardHTML(o)).join('') + '</div>');
  }
  html.push(tableHTML());
  html.push(noteHTML());
  $('results').innerHTML = html.join('');

  $('results').querySelectorAll('[data-rm]').forEach((b) => b.addEventListener('click', () => removeWatch(+b.dataset.rm)));
  const q = $('tq');
  if (q) q.addEventListener('input', filterTable);
  paintFoot();
  if (window.__hints) window.__hints();
}

function summaryHTML(rows) {
  const rs = rows.map((o) => o.r).filter((r) => r && r.ratio != null);
  const avg = rs.length ? rs.reduce((s, r) => s + r.ratio, 0) / rs.length : null;
  const top = rs.slice().sort((a, b) => b.ratio - a.ratio)[0];
  const bot = rs.slice().sort((a, b) => a.ratio - b.ratio)[0];
  const ats = rows.map((o) => o.r && o.r.at).filter(Boolean).sort();
  return '<div class="summary">' +
    '<div class="stat"><small>담은 모집단위</small><b>' + S.watch.length + '<small style="font-size:13px;color:var(--ink-3)"> / ' + MAXW + '</small></b><i>대학 ' + new Set(S.watch.map((w) => w.u)).size + '곳</i></div>' +
    '<div class="stat"><small>평균 경쟁률</small><b>' + fmtRatio(avg) + '</b><i>' + (rs.length ? rs.length + '개 집계' : '집계 대기') + '</i></div>' +
    '<div class="stat"><small>최고 경쟁률</small><b>' + (top ? fmtRatio(top.ratio) : '—') + '</b><i>' + esc(top ? top.unit.u : '—') + '</i></div>' +
    '<div class="stat"><small>최저 경쟁률</small><b>' + (bot ? fmtRatio(bot.ratio) : '—') + '</b><i>' + esc(bot ? bot.unit.u : '—') + '</i></div>' +
    '</div>';
}

function cardHTML(o) {
  const w = o.w, r = o.r;
  const u = uOf(w.u) || {};
  if (!r) {
    return '<div class="card"><div class="top"><div class="title"><div class="u">' + esc(u.name || w.u) + '</div>' +
      '<div class="d">' + esc(w.d) + '</div><div class="t">' + esc(w.j) + '</div></div>' +
      '<button class="xbtn" data-rm="' + o.n + '">제거</button></div>' +
      '<div class="empty" style="padding:12px">불러오는 중…</div></div>';
  }
  if (r.miss) {
    return '<div class="card"><div class="top"><div class="title"><div class="u">' + esc(u.name || w.u) + '</div>' +
      '<div class="d">' + esc(w.d) + '</div><div class="t">' + esc(w.j) + '</div></div>' +
      '<button class="xbtn" data-rm="' + o.n + '">제거</button></div>' +
      '<div class="empty" style="padding:12px">이 모집단위가 최신 집계에 없습니다. 전형명이 바뀌었을 수 있어요.</div></div>';
  }
  const b = band(r.ratio);
  const dcls = r.delta == null ? 'flat' : (r.delta > 0 ? 'up' : 'flat');
  const dtxt = r.delta == null ? '변동 —' : (r.delta > 0 ? '+' + r.delta + '명' : (r.delta === 0 ? '변동 없음' : r.delta + '명'));
  const camp = [r.unit.c, r.unit.l].filter(Boolean).join(' · ');
  return '<div class="card ' + b + '">' +
    '<div class="top"><div class="title">' +
      '<div class="u">' + esc(u.name || '') + (u.region ? ' <span style="color:var(--ink-3)">· ' + esc(u.region) + '</span>' : '') + '</div>' +
      '<div class="d">' + esc(r.unit.u) + '</div>' +
      '<div class="t">' + esc(r.unit.j) + (camp ? ' · ' + esc(camp) : '') + '</div>' +
    '</div><div style="display:flex;flex-direction:column;align-items:flex-end;gap:6px;flex:none">' +
      '<span class="pill">' + bandLabel(r.ratio) + '</span>' +
      '<button class="xbtn" data-rm="' + o.n + '">제거</button>' +
    '</div></div>' +
    '<div class="bignum"><span class="r">' + fmtRatio(r.ratio) + '<small> : 1</small></span>' +
      '<span class="delta ' + dcls + '">' + esc(dtxt) + '</span></div>' +
    '<div class="cutrow"><div class="cuts">' +
      '<div><span>모집인원</span><b>' + nfmt(r.q) + '</b></div>' +
      '<div><span>지원인원</span><b>' + nfmt(r.apply) + '</b></div>' +
      '<div><span>기준 시각</span><b>' + esc(shortTime(r.at)) + '</b></div>' +
    '</div>' + sparkline(r.series, r.q) + '</div>' +
    '<div class="foot"><span class="dl' + (/남음|마감/.test(ddText(u.period)) ? ' hot' : '') + '">접수 ' + esc(u.period || '') + ' · ' + esc(ddText(u.period)) + '</span>' +
      (u.url ? '<a href="' + esc(u.url) + '" target="_blank" rel="noopener">원본 보기</a>' : '') + '</div>' +
    '</div>';
}

function tableHTML() {
  const ids = [...new Set(S.watch.map((w) => w.u))];
  if (!ids.length) return '';
  const pins = new Set(S.watch.map((w) => w.u + '' + watchKey(w)));
  const rows = [];
  for (const id of ids) {
    const d = CACHE.get(id);
    if (!d) continue;
    const last = d.snaps.length ? d.snaps[d.snaps.length - 1] : null;
    const prev = d.snaps.length > 1 ? d.snaps[d.snaps.length - 2] : null;
    d.units.forEach((u, i) => {
      const a = last ? last.a[i] : null;
      const p = prev ? prev.a[i] : null;
      rows.push({
        univ: d.name, j: u.j, camp: [u.c, u.l].filter(Boolean).join(' '), u: u.u, q: u.q, a,
        r: a != null && u.q ? a / u.q : null,
        d: a != null && p != null ? a - p : null,
        pin: pins.has(id + '' + unitKey(u)),
      });
    });
  }
  rows.sort((x, y) => (y.pin - x.pin) || ((y.r == null ? -1 : y.r) - (x.r == null ? -1 : x.r)));
  const body = rows.map((r) =>
    '<tr class="' + (r.pin ? 'pinned' : '') + '" data-k="' + esc((r.univ + ' ' + r.j + ' ' + r.camp + ' ' + r.u).toLowerCase()) + '">' +
    '<td>' + (r.pin ? '★ ' : '') + esc(r.univ) + '</td><td>' + esc(r.j) + '</td><td>' + esc(r.camp) + '</td><td>' + esc(r.u) + '</td>' +
    '<td class="num">' + nfmt(r.q) + '</td><td class="num">' + nfmt(r.a) + '</td>' +
    '<td class="num">' + fmtRatio(r.r) + '</td>' +
    '<td class="num" style="color:' + (r.d > 0 ? 'var(--up)' : 'var(--ink-3)') + '">' + (r.d == null ? '—' : (r.d > 0 ? '+' + r.d : r.d)) + '</td></tr>').join('');
  return '<h2 class="sec">담은 대학의 전체 모집단위 <small>' + rows.length + '행 · ★ 는 담은 항목</small></h2>' +
    '<div class="tablewrap"><div class="tabbar"><input id="tq" type="search" placeholder="대학·전형·학과 검색" aria-label="표 검색"><span class="count" id="tcount">' + rows.length + '행</span></div>' +
    '<div class="scroll"><table><thead><tr><th>대학</th><th>전형</th><th>캠퍼스·단대</th><th>모집단위</th>' +
    '<th class="num">모집</th><th class="num">지원</th><th class="num">경쟁률</th><th class="num">직전 대비</th></tr></thead><tbody>' + body + '</tbody></table></div></div>';
}

function filterTable() {
  const q = $('tq').value.trim().toLowerCase();
  let n = 0;
  document.querySelectorAll('.tablewrap tbody tr').forEach((tr) => {
    const hit = !q || tr.dataset.k.includes(q);
    tr.hidden = !hit;
    if (hit) n++;
  });
  $('tcount').textContent = n + '행';
}

/** 계열 차단을 문장으로 */
function blockedNote() {
  const hs = ST && ST.hostStat;
  if (!hs) return '';
  const NAMES = { jinhak: '진학사(jinhakapply)', uway: '유웨이(uwayapply)' };
  const b = Object.keys(hs).filter((k) => hs[k] && hs[k].blocked);
  if (!b.length) return '';
  return '<b>' + b.map((k) => NAMES[k]).join(' · ') + ' 경쟁률 서버가 수집 서버의 접속을 차단</b>해, 해당 ' +
    b.reduce((n, k) => n + (hs[k].total || 0), 0) + '개 대학은 목록에서 고를 수 없습니다. ' +
    '카드 없이도 각 대학 원본 페이지 링크는 그대로 열립니다.';
}

function noteHTML() {
  if (!IDX) return '';
  const bad = (IDX.univs || []).filter((u) => !u.ok && !u.stale);
  return '<div class="box"><h3>이 숫자는 어디서 온 것인가</h3><ul>' +
    '<li>진학사 <b>대학별 수시 경쟁률 현황</b> 페이지에 걸린 각 대학의 실시간 접수현황 페이지(jinhakapply · uwayapply)를 그대로 읽어 모집단위별 <b>모집인원 · 지원인원</b>을 집계합니다.</li>' +
    '<li>경쟁률은 <b>지원인원 ÷ 모집인원</b>으로 다시 계산하며, 원본 표의 값과 동일합니다.</li>' +
    '<li>수집은 15분마다 돌지만, <b>원본 갱신 주기는 대학마다 10분~1시간</b>입니다. 카드의 <b>기준 시각</b>이 원본이 표시한 시각입니다.</li>' +
    '<li>수집 성공 ' + (IDX.ok || 0) + ' / ' + (IDX.total || 0) + '개 대학' +
      (bad.length ? ' · 미수집 ' + bad.length + '곳(대학 자체 페이지, 준비중, 또는 수집 서버 차단)' : '') + '</li>' +
    (blockedNote() ? '<li>' + blockedNote() + '</li>' : '') +
    '</ul></div>';
}

function paintPanel() {
  const wl = $('wlist');
  if (!S.watch.length) {
    wl.innerHTML = '<div class="help">담은 항목이 없습니다.</div>';
  } else {
    wl.innerHTML = S.watch.map((w, n) => {
      const u = uOf(w.u) || {};
      return '<div class="wrow"><div class="g"><b>' + esc(w.d) + '</b><span>' + esc(u.name || w.u) + ' · ' + esc(w.j) + '</span></div>' +
        '<button class="xbtn" data-wrm="' + n + '">×</button></div>';
    }).join('');
    wl.querySelectorAll('[data-wrm]').forEach((b) => b.addEventListener('click', () => removeWatch(+b.dataset.wrm)));
  }
  const st = $('srcstat');
  if (IDX) {
    const bad = (IDX.univs || []).filter((u) => !u.ok && !u.stale);
    st.innerHTML = '수집 시각 <b>' + esc(shortTime(IDX.built)) + '</b><br>성공 <b>' + (IDX.ok || 0) + '</b> / ' + (IDX.total || 0) + '개 대학' +
      hostBlockHTML() +
      (bad.length ? '<br>미수집 ' + bad.length + '곳: ' + esc(bad.slice(0, 6).map((u) => u.name).join(', ')) + (bad.length > 6 ? ' 외' : '') : '');
  } else {
    st.textContent = 'data/index.json 을 아직 읽지 못했습니다.';
  }
  $('addbtn').disabled = !selUniv || S.watch.length >= MAXW;
}

/** 한 계열(진학사/유웨이)이 통째로 막힌 경우를 알려준다. */
function hostBlockHTML() {
  const hs = ST && ST.hostStat;
  if (!hs) return '';
  const NAMES = { jinhak: '진학사 계열', uway: '유웨이 계열' };
  const rows = Object.keys(hs).filter((k) => hs[k] && (hs[k].blocked || hs[k].skipped))
    .map((k) => NAMES[k] + ' ' + (hs[k].total || 0) + '곳 ' + (hs[k].blocked ? '차단' : '건너뜀'));
  if (!rows.length) return '';
  return '<br><span style="color:var(--reach)">⚠ ' + esc(rows.join(' · ')) + '</span>';
}

function paintFoot() {
  $('foot').innerHTML = '출처: 진학사 대학별 수시 경쟁률 현황 페이지에 연결된 각 대학 실시간 접수현황(jinhakapply · uwayapply). ' +
    '<span class="warn">경쟁률은 원서접수 진행 중 계속 바뀌며, 마감 직전 몇 시간에 가장 크게 움직입니다. 마감 시각과 최종 경쟁률은 반드시 각 대학 입학처 공고로 확인하세요.</span>' +
    '<br>접수 마감 카운트다운은 마지막 접수일 18:00 을 가정한 값으로, 대학별 실제 마감 시각과 다를 수 있습니다.';
}

/* ---------- 스크롤 안내 배지 ---------- */
function initScrollHints() {
  const hintL = $('hintL'), hintR = $('hintR'), cta = document.querySelector('.cta');
  const wide = () => matchMedia('(min-width:901px)').matches;
  const EDGE = 24;
  function state(sc) {
    const h = sc === document.scrollingElement ? innerHeight : sc.clientHeight;
    const top = sc === document.scrollingElement ? (scrollY || document.documentElement.scrollTop) : sc.scrollTop;
    return { can: sc.scrollHeight - h > EDGE, atEnd: top + h >= sc.scrollHeight - EDGE };
  }
  function show(el, sc, rect, bottom) {
    const s = state(sc);
    el.hidden = !s.can;
    if (!s.can) return;
    el.classList.toggle('out', s.atEnd);
    el.style.left = (rect.left + rect.width / 2) + 'px';
    el.style.bottom = bottom + 'px';
    el._sc = sc;
  }
  function update() {
    const fs = $('formscroll'), rc = $('rightcol');
    if (wide()) {
      if (fs && cta) show(hintL, fs, fs.getBoundingClientRect(), innerHeight - cta.getBoundingClientRect().top + 12);
      else hintL.hidden = true;
      if (rc) show(hintR, rc, rc.getBoundingClientRect(), 18);
      else hintR.hidden = true;
    } else {
      hintL.hidden = true;
      // 좁은 화면에서는 하단 고정 버튼 바 위로 띄운다
      const r = cta ? cta.getBoundingClientRect() : null;
      const pinned = r && r.top > 0 && r.top < innerHeight && r.bottom > innerHeight - 4;
      const over = pinned ? Math.round(innerHeight - r.top + 12) : 18;
      show(hintR, document.scrollingElement, { left: 0, width: innerWidth }, over);
    }
  }
  [hintL, hintR].forEach((el) => el.addEventListener('click', () => {
    const sc = el._sc;
    if (!sc) return;
    const h = sc === document.scrollingElement ? innerHeight : sc.clientHeight;
    if (sc === document.scrollingElement) scrollBy({ top: h * 0.8, behavior: 'smooth' });
    else sc.scrollBy({ top: h * 0.8, behavior: 'smooth' });
  }));
  let raf = 0;
  const kick = () => { cancelAnimationFrame(raf); raf = requestAnimationFrame(update); };
  ['formscroll', 'rightcol'].forEach((id) => { const e = $(id); if (e) e.addEventListener('scroll', kick, { passive: true }); });
  addEventListener('scroll', kick, { passive: true });
  addEventListener('resize', kick);
  if (window.ResizeObserver) {
    const ro = new ResizeObserver(kick);
    ['formscroll', 'rightcol', 'results'].forEach((id) => { const e = $(id); if (e) ro.observe(e); });
  }
  window.__hints = kick;
  kick();
}

/* ---------- 부팅 ---------- */
let booted = false;
function boot() {
  if (booted) return;
  booted = true;
  load();

  $('uq').addEventListener('change', onUnivPick);
  $('uq').addEventListener('input', () => { if ($('uq').value.length > 1) onUnivPick(); });
  $('jsel').addEventListener('change', onJungPick);
  $('addbtn').addEventListener('click', addWatch);
  $('clearw').addEventListener('click', () => { S.watch = []; save(); render(); toast('목록을 비웠습니다.'); });
  $('refresh').addEventListener('click', () => refresh(false));
  $('hrefresh').addEventListener('click', () => refresh(false));
  $('reset').addEventListener('click', () => {
    if (!confirm('담은 목록과 갱신 설정을 초기화할까요?')) return;
    S = { watch: [], auto: true, period: 300, sort: 'add' };
    save();
    syncSeg();
    render();
    scheduleNext();
  });
  $('autochk').addEventListener('change', () => { S.auto = $('autochk').checked; save(); scheduleNext(); });
  document.querySelectorAll('#periodseg button').forEach((b) => b.addEventListener('click', () => {
    S.period = +b.dataset.v; save(); syncSeg(); render(); scheduleNext();
  }));
  document.querySelectorAll('#sortseg button').forEach((b) => b.addEventListener('click', () => {
    S.sort = b.dataset.v; save(); syncSeg(); render();
  }));

  syncSeg();
  initScrollHints();
  render();
  refresh(true);
}

function syncSeg() {
  $('autochk').checked = !!S.auto;
  document.querySelectorAll('#periodseg button').forEach((b) => b.setAttribute('aria-pressed', String(+b.dataset.v === S.period)));
  document.querySelectorAll('#sortseg button').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.v === S.sort)));
}

boot();
