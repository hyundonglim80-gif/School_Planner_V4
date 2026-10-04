// tools/inspect-today-scroll.mjs
//
// 상단 2행의 가운데 날짜를 누르면 오늘로 돌아오고 오늘 칸이 보이게 스크롤되는지 (lib/todayScroll, 2026-10-04 신고:
// 휴대폰 년간에서 안 됨). 휴대폰 390px와 PC 1400px에서 하루·주간·월간·년간(학사력·자세히)을 본다.
//   - 화면을 맨 아래로 내려 두고 날짜를 누른다 → 오늘 칸(없으면 오늘이 든 구역)이 머리줄 아래 화면 안에 보인다
//   - 하루 화면은 맨 위로
//   - 년간은 ◀ 로 지난 학년도에 가 있다가 눌러도 이번 학년도의 오늘로 (새로 그려지는 동안 기다린다)
// 자료를 바꾸지 않는다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-today-scroll.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;
const OUT = process.env.OUT || 'tools/report';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const logs = [];

/** 오늘 칸(없으면 오늘이 든 구역)이 머리줄 아래·화면 안에 보이나 */
const todayInView = (page) =>
  page.evaluate(() => {
    const vis = (el) => el.getClientRects().length > 0;
    const day = [...document.querySelectorAll('[data-today="true"]')].find(vis);
    const area = [...document.querySelectorAll('[data-today-area="true"]')].find(vis);
    const el = day || area;
    if (!el) return { ok: false, why: '오늘 칸·구역이 없음', y: window.scrollY };
    const r = el.getBoundingClientRect();
    const headerBottom = document.querySelector('header').getBoundingClientRect().bottom;
    // 휴대폰은 아래 탭바가 덮는다
    const bar = [...document.querySelectorAll('nav, div')].find((n) => getComputedStyle(n).position === 'fixed' && n.getBoundingClientRect().bottom >= innerHeight - 1 && n.getBoundingClientRect().height < 120 && n.getBoundingClientRect().width >= innerWidth - 2);
    const bottom = bar ? bar.getBoundingClientRect().top : innerHeight;
    const ok = r.top >= headerBottom - 4 && r.top < bottom - 20;
    return { ok, what: day ? '오늘 칸' : '오늘이 든 구역', top: Math.round(r.top), headerBottom: Math.round(headerBottom), bottom: Math.round(bottom), y: Math.round(window.scrollY) };
  });

const clickHeaderDate = async (page) => {
  await page.locator('span[title^="오늘 날짜로 돌아가기"]').first().click();
  await page.waitForTimeout(1800);
};
const toBottom = async (page) => {
  await page.evaluate(() => window.scrollTo(0, document.documentElement.scrollHeight));
  await page.waitForTimeout(500);
};

for (const [tag, viewport] of [['휴대폰', { width: 390, height: 844 }], ['PC', { width: 1400, height: 900 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`${tag} pageerror: ${e.message.slice(0, 200)}`));
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(800);

  // 하루: 맨 위로
  await toBottom(page);
  const before = await page.evaluate(() => Math.round(window.scrollY));
  await clickHeaderDate(page);
  const y = await page.evaluate(() => Math.round(window.scrollY));
  check(`[${tag}] 하루: 내려 둔 화면이 맨 위로`, y <= 2, `${before} → ${y}`);

  for (const [name, key] of [['주간', 'Shift+Digit2'], ['월간', 'Shift+Digit3']]) {
    await page.keyboard.press(key);
    await page.waitForTimeout(2500);
    await toBottom(page);
    await clickHeaderDate(page);
    const r = await todayInView(page);
    check(`[${tag}] ${name}: 오늘이 화면 안에`, r.ok, JSON.stringify(r));
  }
  // 월간에서 다음 달로 갔다가 눌러도 이번 달 오늘로
  await page.getByTitle(/^다음 날짜/).click();
  await page.waitForTimeout(1500);
  await clickHeaderDate(page);
  const rm = await todayInView(page);
  check(`[${tag}] 월간: 다음 달에서 눌러도 이번 달의 오늘로`, rm.ok, JSON.stringify(rm));

  // 년간 - 학사력과 자세히
  await page.keyboard.press('Shift+Digit4');
  await page.waitForTimeout(2500);
  for (const [view, label] of [['sheet', '학사력'], ['detail', '자세히']]) {
    await page.locator(`[data-year-view="${view}"]`).click();
    await page.waitForTimeout(2500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await page.waitForTimeout(400);
    await clickHeaderDate(page);
    const r = await todayInView(page);
    check(`[${tag}] 년간 ${label}: 맨 위에서 눌러도 오늘로 내려간다`, r.ok, JSON.stringify(r));
    await page.screenshot({ path: `${OUT}/today-scroll-${tag === 'PC' ? 'pc' : 'mobile'}-year-${view}.png` });

    // 지난 학년도에 가 있다가 누르면 이번 학년도로 돌아와 오늘로 (새로 그려지는 동안 기다린다)
    await page.getByTitle(/^이전 날짜/).click();
    await page.waitForTimeout(1200);
    await clickHeaderDate(page);
    await page.waitForTimeout(800);
    const r2 = await todayInView(page);
    check(`[${tag}] 년간 ${label}: 지난 학년도에서 눌러도 이번 학년도의 오늘로`, r2.ok, JSON.stringify(r2));
  }
  await page.locator('[data-year-view="sheet"]').click(); // 처음 모양으로 되돌린다 (이 기기 설정)
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(500);
  await ctx.close();
}

check('점검 동안 페이지 오류가 없다', logs.length === 0, logs.slice(0, 3).join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - fails.length}/${results.length} 통과`);
process.exit(fails.length ? 1 : 0);
