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
data/status.json                마지막 수집의 성공/실패 진단 (수집기가 생성)
scripts/scrape.mjs              수집기 (Playwright)
scripts/parse-in-page.js        브라우저 안에서 도는 표 파서
scripts/seed-snippet.js         브라우저 콘솔에 붙여 대학 목록을 뽑는 스니펫 (권장)
scripts/seed-univs.mjs          저장한 허브 HTML 로 대학 목록을 만드는 스크립트
scripts/probe.mjs               러너에서 각 호스트에 닿는지 확인하는 진단
scripts/browser.mjs             브라우저 실행 공통 모듈 (UA·헤더·자동화 흔적 제거)
data/ua.txt                     쓰고 싶은 User-Agent (없으면 기본값)
data/univs.json                 대학 목록 (수집기가 갱신하거나 직접 심는 파일)
data/probe.json                 마지막 접속 진단 결과
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

## 실행 환경 진단 결과 (2026-09-08 확인)

GitHub Actions 러너에서 세 호스트를 열어본 결과입니다 (`data/probe.json`).

| 호스트 | 결과 | 대상 |
|---|---|---|
| `www.jinhak.com` (허브) | **403 · "안전한 접속 확인"** | 대학 목록 |
| `addon.jinhakapply.com` | **403 · "안전한 접속 확인"** | 85개교 |
| `ratio.uwayapply.com` | **200 · 정상 (표 확인)** | 88개교 |

진학사 계열이 러너 IP(미국 리전)를 차단합니다. 유웨이는 정상이므로 **88개교는 Actions 로 그대로 수집됩니다.**
그래서 설정은 두 단계로 나뉩니다.

### 1단계 — 대학 목록 심기 (필수)

허브가 막혀 있으니 목록은 브라우저에서 한 번 뽑아 심습니다.

1. 크롬에서 [허브 페이지](https://www.jinhak.com/jh/high3/univ-entrance-info/ipsi-analysis/ipsi-strategy/100000727)를 열고 끝까지 스크롤
2. F12 → Console 에 `scripts/seed-snippet.js` 내용을 전부 붙여넣고 Enter
3. 다운로드된 `univs.json` 을 `data/univs.json` 으로 넣고 push

```bash
git add data/univs.json && git commit -m "chore(data): 대학 목록 시드" && git push
```

이것만 하면 Actions 가 15분마다 **유웨이 88개교**를 수집합니다. 진학사 85개교는 목록에 남지만
`ok: false` 로 표시되고 페이지에서 "진학사 계열 85곳 차단" 이라고 안내됩니다.
수집기는 차단된 호스트를 첫 요청에서 알아보고 나머지를 건너뛰므로 실행 시간도 낭비하지 않습니다.

### 실제 브라우저처럼 접근하기

진학사 계열의 403 이 IP 때문인지 헤드리스 탐지 때문인지는 겉으로 구분되지 않습니다.
그래서 수집기는 실제 크롬과 같은 신호를 보내도록 맞춰 두었습니다 (`scripts/browser.mjs`).

- `User-Agent` 와 `sec-ch-ua` 계열 클라이언트 힌트를 **서로 맞춰서** 전송 (어긋나면 오히려 걸립니다)
- `Accept-Language: ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7`, `Upgrade-Insecure-Requests: 1`
- 시간대 `Asia/Seoul`, `navigator.language`/`languages` 를 한국어로
- `navigator.webdriver` 제거, `window.chrome` 존재, 플러그인 목록 채우기, `--disable-blink-features=AutomationControlled`

**본인 브라우저의 UA 를 쓰려면** 크롬 콘솔에서 `navigator.userAgent` 를 복사해 `data/ua.txt` 로 저장하세요.
`UA` 환경변수로 넘겨도 됩니다. 우선순위는 `UA` → `data/ua.txt` → 기본값이며,
실제로 어떤 값이 쓰였는지는 로그 첫 줄과 `data/probe.json` 의 `ua` 에 남습니다.

```bash
echo 'UA 문자열 붙여넣기' > data/ua.txt
git add data/ua.txt && git commit -m "chore: UA 지정" && git push
```

로컬에서 돌릴 때는 설치된 크롬을 그대로 쓰는 편이 가장 강합니다.

```bash
# macOS
CHROME_PATH="/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
  ONLY_SRC=jinhak node scripts/scrape.mjs .

# 창을 띄워서 확인하고 싶으면
HEADFUL=1 CHROME_PATH="..." node scripts/probe.mjs .
```

그래도 러너에서 403 이 계속되면 IP 기반 차단이므로 아래 2단계로 넘어갑니다.

### 2단계 — 진학사 85개교까지 원하면 (선택)

진학사 계열은 국내 IP 에서만 열리므로, 그 부분만 본인 컴퓨터에서 돌려 push 합니다.
파일은 대학별로 나뉘어 있어 Actions 결과와 자연스럽게 합쳐집니다.

```bash
# 한 번만 설치
npm i playwright && npx playwright install chromium

# 진학사 계열만 수집 (유웨이는 Actions 가 담당)
ONLY_SRC=jinhak node scripts/scrape.mjs .
git add data && git commit -m "chore(data): 진학사 계열 경쟁률" && git push
```

15분마다 자동으로 돌리려면 `crontab -e` 에 다음 한 줄을 넣습니다.

```
*/15 * * * * cd ~/susi-ratio && ONLY_SRC=jinhak /usr/local/bin/node scripts/scrape.mjs . && git add data && git commit -m "chore(data): 진학사 계열 경쟁률" && git push
```

`ONLY_SRC` 는 `jinhak` / `uway` / `jinhak,uway` 를 받습니다. 생략하면 둘 다 시도합니다.
로컬에서 둘 다 돌릴 수 있으면 Actions 워크플로는 꺼도 됩니다.

### 그 밖에 목록이 비는 경우

수집기는 허브를 세 가지 방법으로 시도합니다.

1. 렌더된 DOM 에서 경쟁률 링크를 찾아 조상 요소에서 대학명·접수기간을 읽음
2. 렌더된 HTML 전체를 정규식으로 파싱
3. 원본 HTTP 응답(Next.js RSC 페이로드)을 정규식으로 파싱

모두 100개 미만이면 `data/univs.json` 을 재사용하고, 그것도 없으면 **`data/index.json` 을 건드리지 않고**
실패로 끝냅니다. 기존 데이터가 빈 파일로 덮이는 일은 없습니다.
허브 페이지를 HTML 로 저장해 두었다면 `node scripts/seed-univs.mjs 저장한파일.html` 로도 목록을 만들 수 있습니다.

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
