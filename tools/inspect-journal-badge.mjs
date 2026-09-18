// 주간·월간·년간에서 기록 아이콘이 보이고, 눌렀을 때 그날 기록이 뜨는지 본다.
import { chromium } from 'playwright';
const V4 = 'http://localhost:4190/School_Planner_V4/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1500, height: 1050 } });
const page = await ctx.newPage();
const errs = [];
page.on('pageerror', (e) => errs.push(e.message.slice(0, 140)));
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(3500);

async function check(tab) {
  await page.getByRole('button', { name: tab, exact: true }).click();
  await page.waitForTimeout(6000);
  const badges = page.getByRole('button', { name: /기록 \d+건 보기/ });
  const n = await badges.count();
  console.log(`  ${tab}: 기록 아이콘 ${n}개`);
  await page.screenshot({ path: `tools/report/badge-${tab}.png` });
  return n;
}

console.log('\n── 기록 아이콘 ──');
const w = await check('주간');
const m = await check('월간');
const y = await check('년간');

// 월간에서 하나 눌러 본다
await page.getByRole('button', { name: '월간', exact: true }).click();
await page.waitForTimeout(5000);
const first = page.getByRole('button', { name: /기록 \d+건 보기/ }).first();
let opened = false, hasText = false;
if (await first.count()) {
  await first.click();
  await page.waitForTimeout(2500);
  const body = await page.locator('body').innerText();
  opened = /일 기록/.test(body);
  hasText = !/이 날짜에 기록이 없습니다/.test(body) && opened;
  await page.screenshot({ path: 'tools/report/badge-peek.png' });
}
console.log(`\n  아이콘을 눌렀을 때 창이 뜨나 : ${opened ? '✔ 뜬다' : '✘ 안 뜬다'}`);
console.log(`  그 창에 기록 내용이 있나     : ${hasText ? '✔ 있다' : '✘ 없다'}`);
if (errs.length) { console.log('\n  오류:'); [...new Set(errs)].slice(0,5).forEach((e)=>console.log('   '+e)); }
const ok = w > 0 && m > 0 && y > 0 && opened && hasText && errs.length === 0;
console.log(`\n${ok ? '✔ 세 화면 모두 정상' : '✘ 확인 필요'}`);
await browser.close(); process.exit(0);
