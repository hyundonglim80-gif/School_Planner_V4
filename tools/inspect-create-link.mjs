// tools/inspect-create-link.mjs
//
// 링크 창의 '+ 새 기록 만들어 연결'이 하루 화면과 같은 기록 칸을 열고, 저장하면 연결 목록에 담기는지 본다.
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-create-link.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const ok = (y) => (y ? '✔' : '✘');
await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);

// 일정 하나를 열고 링크 추가
await page.locator('[data-focus-key^="event"]').first().click();
await page.waitForTimeout(800);
await page.locator('#side-column aside[aria-label="일정 쓰기"]').getByRole('button', { name: /링크 추가/ }).click();
await page.waitForTimeout(1200);
const linker = page.locator('#side-column section[role=dialog]', { has: page.getByRole('heading', { name: /새 데이터 연결하기/ }) });
await linker.getByRole('button', { name: /기록/ }).first().click();
await page.waitForTimeout(800);
await linker.getByRole('button', { name: /새 기록 만들어 연결/ }).click();
await page.waitForTimeout(900);

const jr = page.locator('#side-column aside[aria-label="기록 쓰기"]').first();
const same = (await jr.count()) === 1
  && (await jr.getByText('파일 첨부').count()) === 1
  && (await jr.getByText('링크 추가').count()) === 1
  && (await jr.getByText('학생 태그 넣기').count()) === 1;
console.log(`'새 기록 만들어 연결'이 하루 화면과 같은 기록 칸(파일 첨부·링크 추가·학생 태그): ${ok(same)}`);
const T = `연결용 새 기록 ${Date.now() % 10000}`;
const box = jr.locator('textarea').first();
await box.fill(T);
await box.press('Control+s');
await page.waitForTimeout(1500);
console.log(`저장하면 연결 목록에 담긴다: ${ok((await linker.getByText(T.slice(0, 12)).count()) > 0)}`);
console.log(`저장 뒤에도 기록 칸에 적은 것이 남는다(기록 수정): ${ok((await box.inputValue()) === T && (await jr.getByRole('heading', { name: '기록 수정' }).count()) === 1)}`);
await jr.getByRole('button', { name: /^닫기$/ }).click();
await page.waitForTimeout(500);
await linker.getByRole('button', { name: '연결 저장' }).click();
await page.waitForTimeout(1800);
const ev = page.locator('#side-column aside[aria-label="일정 쓰기"]');
console.log(`연결 저장 뒤 일정에 링크가 붙는다: ${ok((await page.locator('[data-focus-key^="event"]').first().getByTitle(/링크된 항목/).count()) > 0 || (await ev.getByText(/연결된 링크|🔗 \d/).count()) > 0)}`);
await page.screenshot({ path: 'tools/report/create-link.png' });
await b.close();
