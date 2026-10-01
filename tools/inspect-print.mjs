// tools/inspect-print.mjs
//
// 인쇄(docs/ROADMAP.md 12)를 실제 크롬으로 확인한다. 인쇄 창은 열지 않는다 - window.print를 바꿔 끼우고,
// 찍을 준비(#sp4-print-root·@page)를 본 뒤 인쇄 모양(media print)으로 PDF를 만들어 tools/report에 둔다.
//   - 12-1 주간: 🖨️ 인쇄 → A4 가로, 이번 주 칸만, 요일마다 한 열, 제목 / 인쇄가 끝나면(afterprint) 치운다
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-print.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
// 인쇄 창 대신 센다
await ctx.addInitScript(() => {
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
});

const root = () => page.locator('#sp4-print-root');
const pageRule = () => page.evaluate(() => document.getElementById('sp4-print-root-page')?.textContent || '');
const afterPrint = () => page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });

  // ── 12-1 주간 ──
  await page.getByRole('button', { name: '주간', exact: true }).first().click();
  await page.locator('[data-week-grid]').first().waitFor({ timeout: 15000 });
  await page.locator('[data-week-print]').click();
  check('🖨️ 인쇄 → 인쇄 창을 연다', (await page.evaluate(() => window.__printed)) === 1);
  check('찍을 것을 준비 (#sp4-print-root)', (await root().count()) === 1);
  check('A4 가로', /size:\s*A4 landscape/.test(await pageRule()), await pageRule());
  check('제목에 주간 날짜', /년 \d+\.\d+ ~ \d+\.\d+ 주간/.test(await root().locator('.sp4-print-title').innerText()), await root().locator('.sp4-print-title').innerText());
  check('이번 주 칸 하나만 (다음 주 칸은 빼고)', (await root().locator('[data-week-grid]').count()) === 1);
  check('화면에서는 보이지 않는다', !(await root().isVisible()));
  await page.emulateMedia({ media: 'print' });
  const cols = await root().locator('[data-week-grid]').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const days = await root().locator('[data-week-grid]').evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--week-cols')) || 0);
  check('인쇄 모양: 요일마다 한 열', cols === days && cols >= 5, `${cols}열 / 요일 ${days}`);
  check('인쇄 모양: 앱 화면은 숨는다', !(await page.locator('#root').isVisible()));
  // 눈으로 볼 그림 - A4 가로 인쇄 폭(약 1060px)에서 인쇄 모양 (pdf()는 인쇄 흉내를 되돌리므로 먼저)
  await page.setViewportSize({ width: 1060, height: 750 });
  await page.screenshot({ path: 'tools/report/print-week.png', fullPage: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.pdf({ path: 'tools/report/print-week.pdf', preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await afterPrint();
  check('인쇄가 끝나면 치운다', (await root().count()) === 0 && (await page.evaluate(() => document.body.hasAttribute('data-printing'))) === false);
} catch (e) {
  check('예상 못 한 오류', false, String(e).slice(0, 300));
  await page.screenshot({ path: 'tools/report/print-error.png' }).catch(() => {});
} finally {
  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await browser.close();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
