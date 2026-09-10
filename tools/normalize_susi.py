#!/usr/bin/env python3
"""susi_ratio.json 정규화 — 수집기가 남긴 표 구조 왜곡을 복구한다.

수집기는 진학사/유웨이 경쟁률 표의 열을 헤더 문구로 표준 키에 매핑하는데,
대학마다 헤더가 달라 아래 다섯 가지가 그대로 흘러든다. 모두 index.html 이
읽는 필드(unit, details[].name)를 비우거나 숫자를 어긋나게 만들므로,
CI 의 구조 검사가 잡아내기 전에 여기서 되돌린다.

  R1 전형별 요약표가 details 에 섞임      강원대 — 캠퍼스별 "… 전형별" 표 3개
  R2 앞 칸이 비어 행 전체가 한 칸 밀림    성균관대 — 경쟁률이 col 로 밀려남
  R3 모집단위 이름이 원본 헤더 키에 남음  선문대 세부학과과전공 등 5개 대학
  R4 rowspan 잔여물인 빈 행               장로회신학대
  R5 전형명 없이 코드만 수집됨            중앙대 — uway 파서 한계

멱등하다. 이미 정규화된 파일에 다시 돌려도 아무것도 바뀌지 않는다.

  python3 tools/normalize_susi.py            # data/susi_ratio.json 을 고쳐 쓴다
  python3 tools/normalize_susi.py --check    # 고칠 게 있으면 보고하고 exit 1
"""

import argparse
import json
import re
import sys
from collections import Counter

DEFAULT_PATH = 'data/susi_ratio.json'

# 모집단위 이름이 흘러들 수 있는 키 — 앞에 있을수록 우선한다.
# 원본 표의 헤더 문구가 그대로 키가 되므로, 새 대학이 새 헤더를 들고 오면
# --check 가 그 키를 보고하고 실패한다. 그때 여기에 추가하면 된다.
UNIT_NAME_KEYS = (
    'unit2', 'unit3',
    '모집단위전공명', '모집단위개설전공', '모집단위응시영역',
    '세부학과과전공', '개설된학과학부전공', '기본전공',
    'label', 'admissionType',
)

# 이름 후보로 절대 쓰면 안 되는 키 — 안내 링크·홍보 문구 따위.
NON_NAME_RE = re.compile(
    r'홈페이지|동영상|영상|소개|안내|바로가기|비고|슬로건|캐치프레이즈|홍보'
    r'|진로|성과|전공안내서|기업명|추천인원|인원|지원현황|실기|종목|포지션'
)

NUM_RE = re.compile(r'-?[\d,]+(?:\.\d+)?')


def as_num(v):
    """'1,004' → 1004, '11.30 : 1' → 11.3, '-' → None."""
    if isinstance(v, bool):
        return None
    if isinstance(v, (int, float)):
        return v
    if not isinstance(v, str):
        return None
    m = NUM_RE.search(v)
    if not m:
        return None
    t = m.group(0).replace(',', '')
    return float(t) if '.' in t else int(t)


def as_int(v):
    """모집·지원 인원은 정수로 — 파일 전체가 그렇게 저장되어 있다."""
    n = as_num(v)
    return int(n) if isinstance(n, float) and n.is_integer() else n


def ratio_text(r):
    return f'{r:.2f} : 1' if isinstance(r, (int, float)) else None


class Report:
    def __init__(self):
        self.counts = Counter()
        self.by_univ = Counter()
        self.unknown_keys = Counter()
        self.notes = []

    def hit(self, rule, univ, n=1):
        self.counts[rule] += n
        self.by_univ[(rule, univ)] += n

    @property
    def total(self):
        return sum(self.counts.values())


def is_summary_detail(det):
    """units 가 모두 모집단위가 아니라 전형(admissionType)인 표 = 전형별 요약표."""
    units = det.get('units') or []
    return bool(units) and all(
        not u.get('unit') and u.get('admissionType') for u in units
    )


def to_summary_table(det):
    """details 항목을 season.summaryTables 규약({title, columns, rows})으로 옮긴다."""
    rows = []
    for u in det['units']:
        row = {'col': u.get('campus'), 'label': u.get('admissionType')}
        for k in ('recruit', 'applied', 'ratio', 'ratioText'):
            row[k] = u.get(k)
        rows.append(row)
    return {
        'title': det.get('name'),
        'columns': ['col', 'label', 'recruit', 'applied', 'ratio'],
        'rows': rows,
        'movedFromDetails': True,
    }


def unshift_row(u):
    """R2 — 왼쪽 한 칸이 비어 밀린 행을 되돌린다.

    밀린 행:  unit=∅  unit2=이름  recruit=∅  applied=모집  ratio=지원  col=경쟁률
    제자리:   unit=이름           recruit=모집  applied=지원  ratio=경쟁률
    """
    applied = as_int(u.get('ratio'))
    if applied is None:  # 지원자가 네 자리면 '1,004' 로 남아 ratio 가 비어 있다
        applied = as_int(u.get('ratioText'))
    ratio = as_num(u.get('col'))
    if isinstance(ratio, int):
        ratio = float(ratio)   # 경쟁률은 파일 전체가 실수로 저장되어 있다

    u['unit'] = u.get('unit2')
    u['unit2'] = None
    u['recruit'] = as_int(u.get('applied'))
    u['applied'] = applied
    u['ratio'] = ratio
    u['ratioText'] = (u['col'].strip() if isinstance(u.get('col'), str)
                      else ratio_text(ratio))
    del u['col']


def promote_name(u):
    """R3 — 원본 헤더 키에 남은 모집단위 이름을 unit 으로 올린다."""
    for k in UNIT_NAME_KEYS:
        v = u.get(k)
        if isinstance(v, str) and v.strip():
            u['unit'] = v.strip()
            return k
    return None


def is_empty_row(u):
    """R4 — 이름도 모집인원도 경쟁률도 없는 rowspan 잔여물."""
    return (u.get('recruit') is None
            and u.get('ratio') is None
            and as_num(u.get('ratioText')) is None)


def unknown_name_keys(u):
    """이름을 못 찾은 행에서, 이름 후보였을 법한 키를 추린다."""
    return [k for k, v in u.items()
            if isinstance(v, str) and v.strip()
            and k not in UNIT_NAME_KEYS
            and k not in ('unit', 'ratioText', 'college', 'campus', 'major', 'track')
            and not NON_NAME_RE.search(k)]


def normalize(doc, rep):
    for uv in doc.get('universities', []):
        univ = uv.get('university') or '(이름 없음)'

        for season in uv.get('seasons') or []:
            details = season.get('details')
            if not isinstance(details, list):
                continue

            # R1 — 전형별 요약표를 details 에서 걷어내 summaryTables 로 옮긴다.
            keep = []
            for det in details:
                if is_summary_detail(det):
                    season.setdefault('summaryTables', []).append(to_summary_table(det))
                    rep.hit('R1 요약표 이동', univ)
                else:
                    keep.append(det)
            if len(keep) != len(details):
                season['details'] = keep
                details = keep

            for det in details:
                # R5 — 전형명 없이 코드만 있는 전형에 코드 기반 임시 라벨을 준다.
                if not det.get('name') and det.get('code'):
                    det['name'] = f"전형 {det['code']}"
                    rep.hit('R5 전형명 보완', univ)

                units = det.get('units')
                if not isinstance(units, list):
                    continue

                kept_units = []
                for u in units:
                    if not u.get('unit'):
                        if u.get('col'):
                            unshift_row(u)          # R2
                            rep.hit('R2 밀린 행 복구', univ)
                        elif promote_name(u):
                            rep.hit('R3 이름 승격', univ)   # R3
                        elif is_empty_row(u):
                            rep.hit('R4 빈 행 제거', univ)  # R4
                            continue
                        else:
                            for k in unknown_name_keys(u):
                                rep.unknown_keys[k] += 1
                    kept_units.append(u)

                if len(kept_units) != len(units):
                    det['units'] = kept_units

        # R5 — details 와 짝을 이루는 byAdmissionType 요약도 같이 맞춘다.
        for season in uv.get('seasons') or []:
            for at in season.get('byAdmissionType') or []:
                if not at.get('name') and at.get('code'):
                    at['name'] = f"전형 {at['code']}"


def main():
    ap = argparse.ArgumentParser(description='susi_ratio.json 구조 정규화')
    ap.add_argument('path', nargs='?', default=DEFAULT_PATH)
    ap.add_argument('--check', action='store_true',
                    help='고쳐 쓰지 않고, 고칠 것이 있으면 보고 후 exit 1')
    args = ap.parse_args()

    with open(args.path, encoding='utf-8') as f:
        raw = f.read()
    doc = json.loads(raw)
    # 수집기 출력 서식을 그대로 따라간다(압축본이면 압축, 들여쓴 파일이면 들여쓰기)
    compact = '\n' not in raw.strip()

    rep = Report()
    normalize(doc, rep)

    if rep.unknown_keys:
        print('알 수 없는 모집단위 이름 열이 있습니다 — UNIT_NAME_KEYS 에 추가하세요:')
        for k, n in rep.unknown_keys.most_common():
            print(f'  ? {k!r} × {n}')
        return 1

    if not rep.total:
        print(f'✓ {args.path} 는 이미 정규화되어 있습니다')
        return 0

    print(f'{"고칠 항목" if args.check else "정규화"} {rep.total}건')
    for rule, n in rep.counts.most_common():
        print(f'  · {rule}: {n}건')
        for (r, univ), c in rep.by_univ.most_common():
            if r == rule:
                print(f'      {univ}: {c}')

    if args.check:
        print('\ndata/susi_ratio.json 이 정규화되지 않았습니다. '
              '`python3 tools/normalize_susi.py` 를 돌리고 커밋하세요.')
        return 1

    # 원본과 같은 직렬화 형식(유니코드 그대로, 끝 개행 없음).
    text = (json.dumps(doc, ensure_ascii=False, separators=(',', ':')) if compact
            else json.dumps(doc, ensure_ascii=False, indent=2))
    with open(args.path, 'w', encoding='utf-8') as f:
        f.write(text)
    print(f'\n{args.path} 를 다시 썼습니다')
    return 0


if __name__ == '__main__':
    sys.exit(main())
