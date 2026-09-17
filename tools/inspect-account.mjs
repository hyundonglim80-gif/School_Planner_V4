// V3는 A 계정, V4는 B 계정으로 들어간 상태를 만들어 경고가 뜨는지 본다.
// (?as=2 를 붙이면 V4가 두 번째 계정으로 들어간다)
import { chromium } from 'playwright';
const BASE = 'http://localhost:4190';
const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function look(v4url, tag, expectWarn) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const p3 = await ctx.newPage();                       // V3 먼저 (teacher@)
  await p3.goto(`${BASE}/School_Planner_V3/`, { waitUntil: 'domcontentloaded' });
  await p3.waitForTimeout(9000);
  const page = await ctx.newPage();
  await page.goto(v4url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(5000);
  const body = await page.locator('body').innerText();
  const warned = body.includes('V3와 다른 계정으로 로그인되어 있습니다');
  console.log(`  ${tag}: 경고 ${warned ? '떴다' : '안 떴다'} — ${warned === expectWarn ? '✔ 기대대로' : '✘ 기대와 다름'}`);
  await page.screenshot({ path: `tools/report/account-${tag}.png` });
  await ctx.close();
  return warned === expectWarn;
}

console.log('\n── 계정 어긋남 경고 ──');
const a = await look(`${BASE}/School_Planner_V4/?as=2`, '다른계정', true);
const b = await look(`${BASE}/School_Planner_V4/`, '같은계정', false);
await browser.close();
process.exit(a && b ? 0 : 1);
