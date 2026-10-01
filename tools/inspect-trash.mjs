// tools/inspect-trash.mjs
//
// 클립보드에서 지운 것이 휴지통으로 가는지, 휴지통 자동 비우기 기간을 환경설정에서 정하고
// 휴지통에서 바로 비울 수 있는지 실제 크롬에서 본다.
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-trash.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await b.newContext({ viewport: { width: 1280, height: 800 } });
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(V4).origin });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const ok = (y) => (y ? '✔' : '✘');
await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);
const clipRows = () => page.locator('aside[aria-label="클립보드"] li');

// 클립보드에 둘 담고 하나는 ✕, 나머지는 모두 지우기
await page.getByTitle(/클립보드 열기/).click();
await page.evaluate(() => navigator.clipboard.writeText('휴지통 갈 첫째'));
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(500);
await page.evaluate(() => navigator.clipboard.writeText('휴지통 갈 둘째'));
await page.getByRole('button', { name: /가져오기/ }).click();
await page.waitForTimeout(500);
await clipRows().filter({ hasText: '휴지통 갈 첫째' }).hover();
await clipRows().filter({ hasText: '휴지통 갈 첫째' }).getByLabel('이 항목 휴지통으로').click();
await page.getByRole('button', { name: '모두 지우기' }).click();
await page.waitForTimeout(800);
console.log(`클립보드가 비었다: ${ok((await clipRows().count()) === 0)}`);

await page.getByTitle(/^휴지통/).first().click();
await page.waitForTimeout(1500);
const dlg = page.locator('[role=dialog]', { hasText: '휴지통' });
const clipInTrash = await dlg.getByText(/휴지통 갈 (첫째|둘째)/).count();
console.log(`휴지통에 클립보드 항목 둘 (이 기기): ${ok(clipInTrash === 2 && (await dlg.getByText('이 기기').count()) === 2)}`);
console.log(`자동 비우기 꺼짐 안내: ${ok((await dlg.getByText(/자동 비우기 꺼짐/).count()) === 1)}`);
await dlg.locator('div:has(> input[type=checkbox])', { hasText: '휴지통 갈 첫째' }).getByRole('button', { name: '복원' }).click();
await page.waitForTimeout(800);
console.log(`복원하면 클립보드로 돌아온다: ${ok((await clipRows().filter({ hasText: '휴지통 갈 첫째' }).count()) === 1)}`);
await page.getByTitle('닫기').first().click();
await page.waitForTimeout(400);

// 환경설정에서 30일 고르기
await page.getByTitle('더보기 메뉴').click();
await page.getByRole('button', { name: /환경설정/ }).first().click();
await page.waitForTimeout(1200);
await page.getByRole('button', { name: '30일', exact: true }).click();
await page.waitForTimeout(1000);
console.log(`30일을 고르면 눌린 채로: ${ok((await page.getByRole('button', { name: '30일', exact: true }).getAttribute('aria-pressed')) === 'true')}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.reload();
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);
await page.getByTitle(/^휴지통/).first().click();
await page.waitForTimeout(1800);
const dlg2 = page.locator('[role=dialog]', { hasText: '휴지통' });
console.log(`새로 고친 뒤에도 30일 안내 (계정에 저장됨): ${ok((await dlg2.getByText(/30일/).count()) > 0)}`);
const before = await dlg2.getByRole('button', { name: '복원' }).count();
await dlg2.getByRole('button', { name: '휴지통 비우기' }).click();
await page.waitForTimeout(3000);
const after = await dlg2.getByRole('button', { name: '복원' }).count();
console.log(`휴지통 비우기 - ${before}개 -> ${after}개: ${ok(before > 0 && after === 0)}`);
await page.screenshot({ path: 'tools/report/trash.png' });
// 되돌려 둔다
await page.getByTitle('닫기').first().click();
await page.getByTitle('더보기 메뉴').click();
await page.getByRole('button', { name: /환경설정/ }).first().click();
await page.waitForTimeout(1200);
await page.locator('[data-trash-retention]').getByRole('button', { name: '끄기', exact: true }).click();
await page.waitForTimeout(800);
await b.close();
