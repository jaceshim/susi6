// 브라우저 실행/컨텍스트 생성 공통 모듈.
// 진학사 계열이 헤드리스 브라우저를 걸러내므로, 실제 로컬 브라우저와 같은
// User-Agent · 클라이언트 힌트 · 언어 헤더를 붙이고 자동화 흔적을 지운다.
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

// UA 우선순위: 환경변수 UA → data/ua.txt → 기본값
// 본인 크롬 콘솔에서 navigator.userAgent 를 복사해 data/ua.txt 로 저장하면 그 값을 씁니다.
const DEFAULT_UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36';

export function resolveUA(root = '.') {
  if (process.env.UA && process.env.UA.trim()) return process.env.UA.trim();
  try {
    const p = path.resolve(root, 'data/ua.txt');
    const v = fs.readFileSync(p, 'utf8').trim();
    if (v) return v;
  } catch (e) {}
  return DEFAULT_UA;
}

/** UA 문자열에서 sec-ch-ua 계열 힌트를 만들어 준다 (UA 와 힌트가 어긋나면 오히려 걸린다) */
function clientHints(ua) {
  const major = (ua.match(/Chrome\/(\d+)/) || [, '140'])[1];
  const mac = /Macintosh/.test(ua);
  const win = /Windows/.test(ua);
  return {
    'sec-ch-ua': `"Chromium";v="${major}", "Google Chrome";v="${major}", "Not=A?Brand";v="24"`,
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': mac ? '"macOS"' : win ? '"Windows"' : '"Linux"',
  };
}

export async function launchBrowser() {
  const launch = {
    args: [
      '--no-sandbox',
      '--disable-blink-features=AutomationControlled', // navigator.webdriver 신호 제거
      '--disable-features=IsolateOrigins,site-per-process',
      '--lang=ko-KR',
    ],
  };
  if (process.env.PW_CHROMIUM) launch.executablePath = process.env.PW_CHROMIUM; // 로컬 테스트용
  // CHROME_PATH 를 주면 설치된 실제 크롬으로 돈다 (헤드리스 감지에 가장 강함)
  if (process.env.CHROME_PATH) launch.executablePath = process.env.CHROME_PATH;
  if (process.env.HEADFUL === '1') launch.headless = false;
  return await chromium.launch(launch);
}

export async function newContext(browser, root = '.') {
  const ua = resolveUA(root);
  const ctx = await browser.newContext({
    userAgent: ua,
    // locale 을 지정하면 Accept-Language 가 'ko-KR' 한 값으로 고정돼 실제 크롬과 달라지므로
    // 여기서는 지정하지 않고, 아래에서 헤더를 직접 넣고 navigator.language 는 init script 로 맞춘다.
    timezoneId: 'Asia/Seoul',
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 2,
    javaScriptEnabled: true,
  });
  // locale 이 Accept-Language 를 'ko-KR' 하나로 덮어쓰므로, 실제 크롬과 같은 값으로 다시 설정한다.
  await ctx.setExtraHTTPHeaders({
    'Accept-Language': 'ko-KR,ko;q=0.9,en-US;q=0.8,en;q=0.7',
    'Upgrade-Insecure-Requests': '1',
    ...clientHints(ua),
  });
  // 자동화 탐지에 흔히 쓰이는 값들을 실제 브라우저와 같게 맞춘다.
  await ctx.addInitScript(() => {
    Object.defineProperty(navigator, 'webdriver', { get: () => undefined });
    Object.defineProperty(navigator, 'languages', { get: () => ['ko-KR', 'ko', 'en-US', 'en'] });
    Object.defineProperty(navigator, 'language', { get: () => 'ko-KR' });
    if (!navigator.plugins || !navigator.plugins.length) {
      Object.defineProperty(navigator, 'plugins', { get: () => [1, 2, 3, 4, 5] });
    }
    window.chrome = window.chrome || { runtime: {} };
    const orig = navigator.permissions && navigator.permissions.query;
    if (orig) {
      navigator.permissions.query = (p) =>
        p && p.name === 'notifications'
          ? Promise.resolve({ state: Notification.permission })
          : orig.call(navigator.permissions, p);
    }
  });
  return ctx;
}

export { DEFAULT_UA };
