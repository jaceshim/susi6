# 2027 수시 경쟁률 대시보드

2027학년도 수시 실시간 경쟁률과 최근 3개년(2026·2025·2024) 경쟁률·입결을 모집단위 단위로 비교하는 정적 페이지입니다. 빌드 도구 없이 HTML 한 장과 JSON 두 개로 동작합니다.

## 구조

```
index.html                     대시보드 (의존성 없음, 폰트만 외부)
data/susi_ratio.json           경쟁률 — 수동 업데이트 대상
data/ipgyeol.json              입결 50%·70% 컷 (2024~2026), 학년도 단위로만 갱신
.github/workflows/deploy.yml   main push 시 검증 → Pages 배포
```

## 경쟁률 업데이트 (일상 작업)

접수 기간에는 `data/susi_ratio.json` 만 갈아끼우면 됩니다.

```bash
# susi-ratio 스킬로 재수집한 결과를 덮어쓴다
cp ~/Downloads/susi_merged.json data/susi_ratio.json

python3 -m json.tool data/susi_ratio.json > /dev/null   # 문법 확인
git add data/susi_ratio.json
git commit -m "chore(data): 경쟁률 갱신 $(date +%Y-%m-%d\ %H:%M)"
git push
```

push 후 Actions 가 JSON 구조를 검증하고 Pages 에 배포합니다. 검증이 실패하면 배포되지 않으므로 깨진 데이터가 올라가는 일은 없습니다.

`universities` 배열에 대학을 추가하면 선택 목록에 자동으로 나타납니다. 아직 수집하지 않은 대학은 목록에 남아 있고, 선택하면 "경쟁률 데이터 없음" 안내가 표시됩니다.

## 데이터 스키마

### data/susi_ratio.json

```
universities[]
  university        대학명 ("서강대학교")
  region, univId, homepage
  current           올해 접수 정보 (status, ratioUrl, applicationPeriod)
  trend[]           연도별 전체 경쟁률
  seasons[]
    year, kind      2027 = "live", 그 이전 = "past"
    updatedAt       { raw, iso } — 경쟁률 기준시각
    overall         { recruit, applied, ratio }
    byAdmissionType[]  전형별 집계
    details[]
      name          전형명 ("학생부교과(지역균형)")
      units[]       { unit, 접수단위, recruit, applied, ratio }
```

### data/ipgyeol.json

문자열 중복을 없앤 인덱스 형식입니다. 한 행이 (대학 × 학과 × 전형) 하나에 대응합니다.

```
univs[], haks[], jungs[]   이름 사전
rows[]  = [ univIdx, hakIdx, jungIdx, edu(0 교과 / 1 종합),
            2024: g50, g70, 모집, 경쟁률,
            2025: g50, g70, 모집, 경쟁률,
            2026: g50, g70, 모집, 경쟁률 ]
```

g50 / g70 = 최종등록자 교과등급 상위 50% · 70% 지점. 출처는 대입정보포털 어디가 발표자료입니다.

## 두 자료를 잇는 방식

경쟁률 자료와 입결 자료는 표기가 다릅니다. `index.html` 이 이름을 정규화해 매칭합니다.

| 축 | 처리 |
|---|---|
| 대학 | `서강대학교` → `서강대` (`대학교$` → `대`) |
| 전형 | `학생부교과(…)` → `교과(…)`, `학생부종합(…)` → `종합(…)`, 로마숫자(Ⅰ·Ⅱ) 제거 → `학생부종합(일반Ⅰ)` 과 `학생부종합(일반Ⅱ)` 가 모두 `종합(일반)` 에 붙는다 |
| 모집단위 | 완전일치 → 접두일치 → 괄호·접미어(학부/학과/전공/계열) 제거 후 일치. `접수단위` 가 단일 학과면 그쪽을 먼저 본다 (`인문학부 / 국어국문학과` → `국어국문학과`) |

논술·기회균형·특성화고 등은 어디가가 입결을 공개하지 않아 입결 칸이 비고, 카드 하단에 그 사실이 표시됩니다. 매칭된 경우에도 어떤 전형·학과에 붙었는지 카드 하단에서 확인할 수 있습니다.

과거 연도의 모집·지원인원은 `susi_ratio.json` 의 지난 경쟁률을 먼저 쓰고, 없으면 입결 자료의 모집·경쟁률로 채우면서 지원인원에 `*` 를 붙입니다.

## 로컬에서 보기

`fetch` 를 쓰므로 `file://` 로는 열리지 않습니다.

```bash
python3 -m http.server 8000
# http://localhost:8000
```

## GitHub Pages 최초 설정

1. 저장소 → Settings → Pages → Source 를 **GitHub Actions** 로 변경
2. `main` 에 push

## 표시 규칙

- 대시보드는 최대 100건까지 표시합니다. 초과하면 선택한 정렬 기준 상위 100건만 보여주고 전체 건수를 함께 안내합니다.
- 카드 좌측 색띠는 현재 선택된 목록 안에서의 경쟁률 사분위입니다(초록 = 하위 25%, 빨강 = 상위 25%). 절대 기준이 아니라 선택 범위 안에서의 상대 위치입니다.
