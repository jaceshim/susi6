#!/usr/bin/env python3
"""data/ipgyeol.json 을 어디가 발표자료 페이지에서 다시 만든다.

출처는 자체 완결형 HTML 한 장이고, 모든 수치가 그 안의 `const D = {...}` 에 들어 있다.
D.cells 의 키는 "대학idx|학과idx|연도", 값은 행 배열이며 한 행은 12칸이다.
칸 뜻은 출처 페이지의 렌더 코드가 직접 알려 준다:

    {cnt:r[3], rate:r[4], real:r[10], g50:r[8], g70:r[9], fill:r[5]}

    r[0] 구분(교과/종합)  r[1] 전형idx  r[2] 계열(인문/자연/…)
    r[3] 모집인원  r[4] 경쟁률  r[5] 충원인원  r[6] 변환50%  r[7] 변환70%
    r[8] 최종50%   r[9] 최종70%  r[10] 실경쟁률  r[11] 백분위

실경쟁률 = 지원자/(모집+충원) 이 표본에서 정확히 맞아떨어져 이 해석을 확인했다.

  python3 tools/build_ipgyeol.py                 # 페이지를 내려받아 새로 만든다
  python3 tools/build_ipgyeol.py --page page.html  # 받아 둔 파일로 만든다
  python3 tools/build_ipgyeol.py --check         # 다시 만들어 현재 파일과 같은지만 본다
"""

import argparse
import json
import re
import sys
import urllib.request
from collections import defaultdict

SRC = 'https://ppakangna-svg.github.io/parkhanmin/'
OUT = 'data/ipgyeol.json'
YEARS = [2024, 2025, 2026]
COLS = ['모집', '충원', '경쟁률', 'g50', 'g70']


def fetch(path=None):
    if path:
        return open(path, encoding='utf-8', errors='replace').read()
    req = urllib.request.Request(SRC, headers={'User-Agent': 'susi6-build/1.0'})
    with urllib.request.urlopen(req, timeout=120) as r:
        return r.read().decode('utf-8', 'replace')


def extract_D(html):
    body = re.search(r'<script[^>]*>(.*?)</script>', html, re.S)
    if not body:
        sys.exit('출처 페이지에서 script 를 찾지 못했습니다')
    body = body.group(1)
    i = body.index('const D = ') + len('const D = ')
    j = body.index('const SU =', i)
    return json.loads(body[i:j].strip().rstrip(';').strip())


def merge(rows):
    """같은 (대학·학과·전형·연도) 에 모집군이 여럿이면 하나로 합친다.

    모집·충원은 더하고, 경쟁률은 지원자 합을 모집 합으로 나눈다(= 정확한 통합 경쟁률).
    등급컷은 모집인원 가중평균 — 서로 다른 모집군의 컷을 대표하는 한 값으로 묶는다."""
    if len(rows) == 1:
        r = rows[0]
        return [r[3], r[5], r[4], r[8], r[9]]

    cnt = sum(r[3] or 0 for r in rows)
    sup = sum(r[5] or 0 for r in rows)
    appl = sum((r[3] or 0) * (r[4] or 0) for r in rows)
    rate = round(appl / cnt, 2) if cnt else None

    def wavg(idx):
        num = den = 0
        for r in rows:
            v, w = r[idx], r[3] or 0
            if v is None or w <= 0:
                continue
            num += v * w
            den += w
        return round(num / den, 2) if den else None

    return [cnt or None, sup, rate, wavg(8), wavg(9)]


def build(D):
    inv = {}
    for reg, us in D['ru'].items():
        for u in us:
            inv[u] = reg
    regions = [inv.get(i, '') for i in range(len(D['univs']))]

    # (대학, 학과, 전형, 구분) → 연도 → 그 해의 행들
    bucket = defaultdict(lambda: defaultdict(list))
    for key, rows in D['cells'].items():
        u, h, y = (int(x) for x in key.split('|'))
        if y not in YEARS:
            continue
        for r in rows:
            bucket[(u, h, r[1], 0 if r[0] == '교과' else 1)][y].append(r)

    out = []
    for (u, h, j, edu), byyear in bucket.items():
        row = [u, h, j, edu]
        for y in YEARS:
            row += merge(byyear[y]) if byyear.get(y) else [None] * len(COLS)
        out.append(row)
    out.sort(key=lambda r: (r[0], r[1], r[2], r[3]))

    return {
        'note': ('행 = [univIdx,hakIdx,jungIdx,edu(0교과/1종합), '
                 + ', '.join(f"y{y}:{'/'.join(COLS)}" for y in YEARS) + ']'
                 + ' · 한 (대학·학과·전형·연도) 에 모집군이 여럿이면 모집·충원은 합, '
                   '경쟁률은 지원자합/모집합, 등급컷은 모집인원 가중평균으로 합쳤다'),
        'src': SRC,
        'years': YEARS,
        'cols': COLS,
        'univs': D['univs'],
        'regions': regions,
        'haks': D['haks'],
        'jungs': D['jungs'],
        'rows': out,
    }


def main():
    ap = argparse.ArgumentParser(description='ipgyeol.json 재생성')
    ap.add_argument('--page', help='내려받아 둔 출처 HTML 경로')
    ap.add_argument('--out', default=OUT)
    ap.add_argument('--check', action='store_true', help='쓰지 않고 현재 파일과 같은지만 본다')
    args = ap.parse_args()

    doc = build(extract_D(fetch(args.page)))
    text = json.dumps(doc, ensure_ascii=False, separators=(',', ':'))

    n = len(doc['rows'])
    filled = sum(1 for r in doc['rows'] for k in range(4, len(r), len(COLS)) if r[k] is not None)
    cuts = sum(1 for r in doc['rows'] for k in range(4, len(r), len(COLS)) if r[k + 3] is not None)
    print(f'대학 {len(doc["univs"])} · 학과 {len(doc["haks"])} · 전형 {len(doc["jungs"])}')
    print(f'행 {n:,} · 연도칸 {n * len(YEARS):,} 중 모집 있음 {filled:,} · 등급컷 있음 {cuts:,}')

    if args.check:
        try:
            cur = open(args.out, encoding='utf-8').read()
        except OSError:
            print('현재 파일이 없습니다'); return 1
        if cur == text:
            print(f'✓ {args.out} 는 출처와 같습니다')
            return 0
        print(f'{args.out} 가 출처와 다릅니다 — `python3 tools/build_ipgyeol.py` 로 다시 만드세요')
        return 1

    with open(args.out, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'{args.out} 를 다시 썼습니다')
    return 0


if __name__ == '__main__':
    sys.exit(main())
