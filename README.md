# 수시 경쟁률 현황 (2027학년도)

원서접수 기간 중 관심 대학·학과의 경쟁률을 한 화면에서 추적하는 정적 웹페이지입니다.
페이지 자체는 HTML/JavaScript 뿐이고, 데이터는 GitHub Actions 가 주기적으로 모아 `data/` 에 커밋합니다.

## 왜 수집기가 따로 필요한가

브라우저에서 대학별 경쟁률 페이지(jinhakapply · uwayapply)를 직접 읽는 방법은 모두 막혀 있습니다.

| 방법 | 결과 |
|---|---|
| 페이지에서 `fetch` | CORS 헤더가 없어 차단 |
| 공용 CORS 프록시 | Cloudflare 봇 차단(`Just a moment…`)에 걸림 |
| `iframe` 임베드 | `X-Frame-Options` 로 빈 화면 |

그래서 **GitHub Actions 안의 헤드리스 브라우저**가 대신 읽어 JSON 으로 저장하고,
페이지는 같은 오리진의 그 JSON 만 읽습니다. 별도 서버는 없습니다.

## 구조

```
index.html                      대시보드 (스타일 내장)
app.js                          대시보드 로직
data/index.json                 대학 목록 + 대학별 요약 (수집기가 생성)
data/u/<대학ID>.json            모집단위 목록 + 시간별 스냅샷 (수집기가 생성)
scripts/scrape.mjs              수집기 (Playwright)
scripts/parse-in-page.js        브라우저 안에서 도는 표 파서
.github/workflows/ratio.yml     15분마다 수집 → 커밋
```

`data/u/<id>.json` 한 개의 모양:

```json
{
  "id": "J10030381", "name": "가톨릭대학교", "region": "서울", "period": "9.7~9.11",
  "url": "https://addon.jinhakapply.com/RatioV1/RatioH/Ratio10030381.html",
  "asof": "2026-09-08T15:00",
  "units": [{ "j": "학생부교과(지역균형전형)", "c": "성심", "l": "", "u": "자유전공학부", "q": 5 }],
  "snaps": [{ "t": "2026-09-08T14:00", "a": [2] }, { "t": "2026-09-08T15:00", "a": [3] }]
}
```

`units[i]` 와 `snaps[*].a[i]` 는 같은 순서로 대응합니다. `q` 는 모집인원, `a` 는 그 시각의 지원인원이고
경쟁률은 페이지에서 `a / q` 로 계산합니다. 스냅샷은 대학별 160개까지 보관합니다(15분 간격이면 약 40시간).

## 배포 순서

1. **리포지토리 생성** — GitHub 에서 새 저장소를 만들고(공개/비공개 무관) 이 폴더 전체를 push 합니다.
   ```bash
   git init && git add . && git commit -m "init: 수시 경쟁률 현황"
   git branch -M main
   git remote add origin https://github.com/<계정>/<저장소>.git
   git push -u origin main
   ```
2. **Actions 쓰기 권한 켜기** — 저장소 `Settings → Actions → General → Workflow permissions` 에서
   **Read and write permissions** 를 선택합니다. (수집기가 `data/` 를 커밋해야 합니다.)
3. **Pages 켜기** — `Settings → Pages → Build and deployment` 에서 Source 를 **Deploy from a branch**,
   Branch 를 **main / (root)** 으로 지정합니다. 몇 분 뒤 `https://<계정>.github.io/<저장소>/` 로 열립니다.
4. **첫 수집 실행** — `Actions → 수시 경쟁률 수집 → Run workflow` 를 한 번 눌러줍니다.
   3~6분쯤 걸리고, 끝나면 `data/index.json` 과 `data/u/*.json` 이 커밋됩니다.
   이후에는 15분마다 자동으로 돕니다.
5. **접수 마감 후** — `Actions → 수시 경쟁률 수집 → ⋯ → Disable workflow` 로 끄면 됩니다.

> 비공개 저장소는 GitHub Pages 가 유료 플랜에서만 동작합니다. 무료 계정이면 저장소를 공개로 둬야 하고,
> 그 경우 페이지와 `data/*.json` 은 URL 을 아는 누구나 볼 수 있습니다. 담은 목록은 브라우저에만
> 저장되므로 공유되지 않습니다.

## 갱신 주기에 대해

- 원본 경쟁률은 대학에 따라 **10분~1시간 단위**로 갱신됩니다(가톨릭대는 1시간, 유웨이(uwayapply) 계열은 대학별로 상이).
- 수집기는 15분마다 돌고, 페이지의 자동 갱신 주기는 1·3·5·10·30분에서 고를 수 있습니다.
- 카드에 표시되는 **기준 시각**은 원본 페이지가 스스로 밝힌 시각입니다. 이 값이 바뀌지 않았다면
  실제로 경쟁률이 그대로인 것이지, 수집이 실패한 것이 아닙니다.

## 수집되지 않는 대학

진학사 허브에 189개교가 올라 있고, 이 중 173개교가 jinhakapply/uwayapply 의 공통 표 구조를 씁니다.
나머지(서울대·동국대 등)는 대학이 자체 페이지로만 공개하므로 목록에는 남지만 카드로 담을 수 없고,
`data/index.json` 의 해당 항목에 `ok: false` 와 사유가 기록됩니다.

## 주의

경쟁률은 접수 마감 직전 몇 시간에 가장 크게 움직입니다. 마감 시각과 최종 경쟁률은
반드시 각 대학 입학처 공고로 확인하세요. 페이지의 마감 카운트다운은 마지막 접수일 18:00 을
가정한 값이라 대학별 실제 마감 시각과 다를 수 있습니다.
