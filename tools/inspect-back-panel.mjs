// tools/inspect-back-panel.mjs
//
// 휴대폰에서 항목 추가 배너(오른쪽 칸)를 열고 뒤로가기를 누르면 배너만 닫히는지 본다.
//
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-back-panel.mjs
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: Number(process.env.W || 390), height: 844 }, hasTouch: true, isMobile: true });
const page = await ctx.newPage();
page.on('console', (m) => process.env.VERBOSE && console.log('  [console]', m.text()));

const ok = (yes) => (yes ? '✔' : '✘');
const onApp = () => page.url().startsWith(V4);
const hist = () => page.evaluate(() => `${history.length} ${JSON.stringify(history.state)}`);
const panelOpen = (name) => page.getByRole('heading', { name }).isVisible().catch(() => false);

// 처음 들어온 자리 앞에 빈 자리를 하나 둔다. 그래야 '앱에서 나가기'가 about:blank로 보인다.
await page.goto('about:blank');
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(2500);

async function check(label, open, heading) {
  console.log(`\n[${label}]`);
  console.log(`  열기 전 기록: ${await hist()}`);
  await open();
  await page.waitForTimeout(800);
  console.log(`  배너가 열렸다: ${ok(await panelOpen(heading))}  기록: ${await hist()}`);
  await page.goBack().catch(() => {});
  await page.waitForTimeout(1000);
  console.log(`  뒤로가기 - 배너가 닫혔다: ${ok(onApp() && !(await panelOpen(heading)))}`);
  console.log(`  앱에 그대로 있다: ${ok(onApp())}  (${page.url()})`);
  if (!onApp()) {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
    await page.waitForTimeout(2000);
  }
}

await check('새 일정', () => page.getByRole('button', { name: /새 일정/ }).first().click(), /새 일정|일정 수정/);
await check('새 일정 다시', () => page.getByRole('button', { name: /새 일정/ }).first().click(), /새 일정|일정 수정/);

// 옆에 붙은 칸(768px 이상)에서만 왼쪽 화면을 누를 수 있다
if (Number(process.env.W || 390) >= 768) {
console.log('\n[칸을 연 채 다른 일정을 열고, 닫기 단추로 닫는다]');
const len0 = await page.evaluate(() => history.length);
await page.getByRole('button', { name: /새 일정/ }).first().click();
await page.waitForTimeout(600);
await page.getByTitle('일정 수정').first().click();
await page.waitForTimeout(1200);
console.log(`  다른 일정으로 바꿔 열어도 칸이 남는다: ${ok(await panelOpen(/일정 수정/))}  기록: ${await hist()}`);
await page.getByRole('button', { name: /^닫기$|^취소$/ }).first().click().catch(() => page.getByTitle('닫기').first().click());
await page.waitForTimeout(1200);
const len1 = await page.evaluate(() => history.length);
console.log(`  닫기 단추로 닫음 - 칸 닫힘 ${ok(!(await panelOpen(/일정 수정/)))} / 표지판 치움 ${ok((await hist()).endsWith('null'))} / 기록 길이 ${len0} -> ${len1}`);
await page.goBack();
await page.waitForTimeout(1000);
console.log(`  그다음 뒤로가기는 진짜로 앱을 나간다(삼키지 않는다): ${ok(!onApp())}`);
}

await page.screenshot({ path: 'tools/report/back-panel.png' });
await browser.close();
process.exit(0);
