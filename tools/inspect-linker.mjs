// tools/inspect-linker.mjs
//
// 신고: 링크 추가에서 일정/기록/메모를 고르고 조회 범위를 정하면
// '데이터를 불러오는 중...'만 1분 넘게 뜨고 결과가 안 나온다.
//
// 링커를 실제로 열어 범위를 '1년'으로 고르고, 결과가 나올 때까지 잰다.
import { chromium } from 'playwright';

const V4 = 'http://localhost:4190/School_Planner_V4/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
const page = await ctx.newPage();
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(4000);

// 일정 하나를 펼쳐 링크 추가로 들어간다
await page.getByRole('button', { name: '+ 새 일정' }).click();
await page.getByPlaceholder('새로운 일정을 입력하세요...').fill('링커 점검용 일정');
await page.getByRole('button', { name: '저장', exact: true }).click();
await page.waitForTimeout(2500);

// 방금 만든 일정을 눌러 수정 모드로 -> 링크 추가
await page.getByText('링커 점검용 일정').first().click();
await page.waitForTimeout(1200);
const linkBtn = page.getByRole('button', { name: /링크|연결/ }).first();
await linkBtn.click();
await page.waitForTimeout(1500);

// 조회 범위를 넓게 (1년)
const yearBtn = page.getByRole('button', { name: /1년|올해|학년도|년/ }).first();
if (await yearBtn.count()) { await yearBtn.click(); }

const t0 = Date.now();
// '데이터를 불러오는 중'이 사라질 때까지 기다린다
await page.getByText('데이터를 불러오는 중').first().waitFor({ state: 'detached', timeout: 180000 })
  .catch(() => console.log('  (불러오는 중 표시가 3분 안에 안 사라짐)'));
const ms = Date.now() - t0;

const body = await page.locator('body').innerText();
console.log(`\n링크 목록이 나오기까지: ${(ms / 1000).toFixed(1)}초`);
console.log(`목록에 항목이 보이나: ${/\d{4}-\d{2}-\d{2}/.test(body) ? '✔ 보인다' : '✘ 안 보인다'}`);
await page.screenshot({ path: 'tools/report/linker.png', fullPage: true });
await browser.close(); process.exit(0);
