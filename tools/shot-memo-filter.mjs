// tools/shot-memo-filter.mjs
//
// 메모 화면의 라벨 필터가 '고른 것'을 분명히 보여 주는지 눈으로 본다.
// 색이 옅은 라벨은 연한 배경만으로는 안 고른 것과 구분되지 않았다.
//
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/shot-memo-filter.mjs
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 900 } });
const page = await ctx.newPage();

await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(2000);

// 메모 화면으로
await page.getByRole('button', { name: '메모', exact: true }).first().click();
await page.waitForTimeout(2500);

const bar = page.locator('button', { hasText: '전체 메모' }).first().locator('..');
await bar.screenshot({ path: 'tools/report/memo-filter-all.png' });
console.log('① 전체 메모가 골라진 상태를 찍었다');

// 라벨 하나를 골라 본다
const labels = await page
  .locator('button[aria-pressed]')
  .filter({ hasNotText: '전체 메모' })
  .all();
console.log(`   라벨 단추 ${labels.length}개`);
if (labels.length > 0) {
  await labels[0].click();
  await page.waitForTimeout(600);
  await bar.screenshot({ path: 'tools/report/memo-filter-one.png' });
  const pressed = await page.locator('button[aria-pressed="true"]').allInnerTexts();
  console.log(`② 라벨을 고른 상태를 찍었다 — 고른 것: ${pressed.join(', ')}`);
}

await browser.close();
process.exit(0);
