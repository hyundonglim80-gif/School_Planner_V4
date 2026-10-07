// tools/inspect-dark.mjs
//
// ROADMAP 17 다크 모드 - 바뀐 부분만 실제 크롬으로 본다.
//   - 처음은 '기기 설정 따라'(밝은 기기면 밝게), ⋮ '어둡게 보기' → 어둡게(바탕·카드·글자·흰 글자 단추), 다시 열어도 어둡게(이 기기)
//   - 인쇄는 어두워도 밝게, 환경설정 '화면 밝기'(밝게·기기 설정 따라 - 기기가 어두우면 어둡게)
//   - 코드에 적힌 회색(끝낸 일정 라벨 칩)도 어둡게 따라간다
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-dark.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, colorScheme: 'light' });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

/** 색의 밝기 (0 어둡다 ~ 1 밝다) */
const lum = (sel, prop = 'backgroundColor') =>
  page.evaluate(
    ([s, p]) => {
      // 'app' = 앱 바탕 (body는 밝을 때 투명이다)
      const el = s === 'app' ? document.querySelector('.bg-bg-body') : document.querySelector(s);
      if (!el) return -1;
      const c = document.createElement('canvas').getContext('2d');
      c.fillStyle = getComputedStyle(el)[p];
      c.fillRect(0, 0, 1, 1);
      const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
      return Math.round(((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * 100) / 100;
    },
    [sel, prop],
  );
const isDark = () => page.evaluate(() => document.documentElement.classList.contains('dark'));
const openMenu = async () => {
  await page.getByTitle('더보기 메뉴').click();
  await page.waitForTimeout(300);
};

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.waitForTimeout(1500);
  check('처음은 기기 설정 따라 - 밝은 기기면 밝게', !(await isDark()) && (await lum('app')) > 0.9);

  await openMenu();
  await page.getByRole('button', { name: /어둡게 보기/ }).click();
  await page.waitForTimeout(500);
  const bodyL = await lum('app');
  const cardL = await lum('section, [class*="rounded-2xl"][class*="bg-white"]');
  const textL = await lum('h1 ~ *, h2, h3', 'color');
  check('⋮ 어둡게 보기 → 바탕·카드 어둡게, 글자 밝게', (await isDark()) && bodyL < 0.15 && cardL < 0.2 && textL > 0.6, `바탕 ${bodyL} 카드 ${cardL} 글자 ${textL}`);
  // 흰 글자 단추(주말·일정·수업 토글)는 흰 글자 그대로
  const toggle = page.getByRole('button', { name: '주말', exact: true });
  const tColor = await toggle.evaluate((el) => getComputedStyle(el).color);
  check('색 단추의 흰 글자는 흰색 그대로', /rgb\(255, 255, 255\)/.test(tColor), tColor);
  await page.screenshot({ path: 'tools/report/dark-day.png' });

  // 끝낸 일정의 라벨 칩(코드에 적힌 회색)도 어둡게
  await page.getByRole('button', { name: '월간', exact: true }).first().click();
  await page.waitForTimeout(2500);
  const doneChip = await page.evaluate(() => {
    const el = [...document.querySelectorAll('[data-date] span[style]')].find((s) => (s.getAttribute('style') || '').includes('var(--color-slate-100)'));
    if (!el) return -1;
    const c = document.createElement('canvas').getContext('2d');
    c.fillStyle = getComputedStyle(el).backgroundColor;
    c.fillRect(0, 0, 1, 1);
    const [r, g, b] = c.getImageData(0, 0, 1, 1).data;
    return Math.round(((0.2126 * r + 0.7152 * g + 0.0722 * b) / 255) * 100) / 100;
  });
  check('끝낸 일정 라벨 칩도 어둡게', doneChip >= 0 && doneChip < 0.3, String(doneChip));
  await page.screenshot({ path: 'tools/report/dark-month.png' });

  // 인쇄는 밝게
  await page.emulateMedia({ media: 'print' });
  const printBody = await lum('app');
  await page.emulateMedia({ media: 'screen' });
  check('인쇄는 어두워도 밝게', printBody > 0.9, String(printBody));

  // 다시 열어도 어둡게 (이 기기) - 그리기 전부터
  await page.reload({ waitUntil: 'domcontentloaded' });
  check('다시 열어도 어둡게 (그리기 전부터)', await isDark());
  await page.locator('[data-month-week]').first().waitFor({ timeout: 40000 });


  // 환경설정 - 밝게 / 기기 설정 따라
  await openMenu();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  const lightBtn = page.locator('[data-theme-mode="light"]');
  await lightBtn.waitFor({ timeout: 10000 });
  await lightBtn.click();
  await page.waitForTimeout(300);
  check('환경설정 밝게 → 곧바로 밝게', !(await isDark()) && (await lum('app')) > 0.9);
  await page.emulateMedia({ colorScheme: 'dark' });
  await page.locator('[data-theme-mode="system"]').click();
  await page.waitForTimeout(300);
  check('기기 설정 따라 - 기기가 어두우면 어둡게', await isDark());
  await page.emulateMedia({ colorScheme: 'light' });
  await page.waitForTimeout(300);
  check('기기가 밝아지면 따라 밝게', !(await isDark()));
  await page.keyboard.press('Escape');
} catch (e) {
  check('예상 못 한 오류', false, String(e).slice(0, 300));
  await page.screenshot({ path: 'tools/report/dark-error.png' }).catch(() => {});
} finally {
  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  // 점검 계정 브라우저는 밝게(기기 설정 따라)로 둔다 - 이 기기 설정이라 다른 점검에 남지 않지만 깔끔하게
  await page.evaluate(() => localStorage.removeItem('sp4_theme')).catch(() => {});
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
