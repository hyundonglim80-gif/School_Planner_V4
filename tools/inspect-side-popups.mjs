// tools/inspect-side-popups.mjs
//
// 오른쪽 줄(팝업·쓰는 칸)과 왼쪽 클립보드 칸을 실제 크롬에서 본다.
//   - 넓은 화면: 칸이 화면을 나눠 오른쪽 줄에 선다 / 폭은 모두 같다 / 경계선을 끌어 폭을 바꾼다
//   - 칸 위에서 연 칸은 위(새 것)·아래(먼저 연 것)로 쌓이고 줄 전체가 한 덩어리로 스크롤
//   - 뒤로가기는 맨 위 칸부터 한 겹씩 / 휴대폰은 오른쪽 배너
//   - 클립보드: 📋로 열기, Ctrl+C·다른 프로그램 복사·캡처 그림이 최신 순으로, 누르면 붙여넣기
//
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-side-popups.mjs      (사진은 tools/report/side-*.png)
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ok = (yes) => (yes ? '✔' : '✘');

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: new URL(V4).origin });
  const page = await ctx.newPage();
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(2000);
  return page;
}
const rect = (page, sel) =>
  page.$$eval(sel, (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { top: Math.round(r.top), h: Math.round(r.height), left: Math.round(r.left), w: Math.round(r.width), label: e.getAttribute('aria-label') || e.querySelector('h2,h3')?.textContent?.trim() };
    })
  );
const items = (page) => rect(page, '#side-column > *');
const column = async (page) => (await rect(page, '#side-column'))[0];

// ── 넓은 화면 ──
const page = await open(1280, 800);
console.log('\n[넓은 화면 1280 - 오른쪽 줄]');
await page.getByTitle(/통합 검색/).first().click();
await page.waitForTimeout(800);
let col = await column(page);
const mainRight = await page.$eval('main', (m) => Math.round(m.getBoundingClientRect().right));
console.log(`  검색이 오른쪽 줄에, 줄을 꽉 채움: ${ok(col && col.left + col.w === 1280 && (await items(page))[0]?.h === 800)}  ${JSON.stringify(col)}`);
console.log(`  화면이 줄 폭만큼 줄었다: ${ok(mainRight <= col.left + 1)}`);
const searchW = col.w;
await page.getByTitle('닫기').first().click();
await page.waitForTimeout(400);
await page.getByTitle('일정 라벨 설정').first().click();
await page.waitForTimeout(900);
col = await column(page);
console.log(`  넓던 팝업(라벨 관리)도 같은 폭: ${ok(col.w === searchW)} (${searchW} / ${col.w})`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 칸 위에서 연 칸: 일정 쓰는 칸 -> 링크 추가 -> 새 일정 만들어 연결
await page.getByRole('button', { name: '일정 추가' }).first().click();
await page.waitForTimeout(600);
await page.locator('#side-column aside').getByRole('button', { name: /링크 추가/ }).first().click();
await page.waitForTimeout(1200);
let st = await items(page);
st.sort((a, b) => a.top - b.top);
console.log(`  일정 칸에서 링크 추가 - 링크가 위, 일정 칸이 아래로 쌓임: ${ok(st.length === 2 && st[1].label === '일정 쓰기' && st[1].top >= st[0].top + st[0].h - 5)}  ${JSON.stringify(st)}`);
const colBox = await page.$eval('#side-column', (c) => ({ sh: c.scrollHeight, ch: c.clientHeight }));
console.log(`  둘을 합쳐 줄이 한 덩어리로 스크롤된다 (높이 ${colBox.sh} > 보이는 ${colBox.ch}): ${ok(colBox.sh > colBox.ch)}`);
await page.screenshot({ path: 'tools/report/side-2-stack-top.png' });
const y0 = await page.evaluate(() => scrollY);
await page.mouse.move(1280 - 60, 500);
for (let i = 0; i < 10; i++) await page.mouse.wheel(0, 500);
await page.waitForTimeout(700);
const colTop = await page.$eval('#side-column', (c) => c.scrollTop);
const y1 = await page.evaluate(() => scrollY);
console.log(`  줄 위에서 굴리면 줄만 굴러감 (줄 ${colTop}px 내려감, 뒤 화면 ${y0} -> ${y1}): ${ok(colTop > 0 && y0 === y1)}`);
await page.screenshot({ path: 'tools/report/side-3-stack-scrolled.png' });
await page.mouse.move(300, 400);
await page.mouse.wheel(0, 600);
await page.waitForTimeout(600);
console.log(`  뒤 화면은 따로 굴러감: ${ok((await page.evaluate(() => scrollY)) > y1)}`);
await page.evaluate(() => scrollTo(0, 0));

await page.getByRole('button', { name: /새 일정 만들어 연결/ }).first().click().catch(() => {});
await page.waitForTimeout(1000);
console.log(`  또 열면 셋이 쌓이고, 줄은 맨 위로 올라가 새 칸이 보인다: ${ok((await items(page)).length === 3 && (await page.$eval('#side-column', (c) => c.scrollTop)) === 0)}`);
await page.goBack();
await page.waitForTimeout(800);
console.log(`  뒤로가기 - 맨 위만 닫힘: ${ok((await items(page)).length === 2)}`);
await page.goBack();
await page.waitForTimeout(800);
st = await items(page);
console.log(`  뒤로가기 - 일정 칸이 다시 줄을 꽉 채움: ${ok(st.length === 1 && st[0].h === 800)}`);

// 경계선 끌기
const before = (await column(page)).w;
const handle = page.locator('[data-column-resizer="right"]');
const hb = await handle.boundingBox();
await page.mouse.move(hb.x + hb.width / 2, 400);
await page.mouse.down();
await page.mouse.move(hb.x - 150, 400, { steps: 8 });
await page.mouse.up();
await page.waitForTimeout(400);
const after = (await column(page)).w;
console.log(`  경계선을 왼쪽으로 끌면 넓어진다 (${before} -> ${after}): ${ok(after > before + 100)}`);
await page.goBack();
await page.waitForTimeout(700);
await page.getByTitle(/통합 검색/).first().click();
await page.waitForTimeout(700);
console.log(`  바꾼 폭을 다른 칸도 쓴다: ${ok(Math.abs((await column(page)).w - after) <= 1)}`);
await page.locator('[data-column-resizer="right"]').dblclick();
await page.waitForTimeout(400);
console.log(`  두 번 누르면 기본 폭: ${ok(Math.abs((await column(page)).w - before) <= 1)}`);
await page.getByTitle('닫기').first().click();
await page.waitForTimeout(400);

// ── 클립보드 ──
console.log('\n[왼쪽 클립보드 칸]');
await page.getByTitle(/클립보드 열기/).click();
await page.waitForTimeout(600);
const clip = (await rect(page, 'aside[aria-label="클립보드"]'))[0];
const mainLeft = await page.$eval('main', (m) => Math.round(m.getBoundingClientRect().left));
console.log(`  📋로 열면 왼쪽에 붙고 화면이 오른쪽으로 밀림: ${ok(clip?.left === 0 && mainLeft >= clip.w - 1)}  ${JSON.stringify(clip)}`);
// 앱 안 Ctrl+C
await page.getByRole('button', { name: '일정 추가' }).first().click();
await page.waitForTimeout(600);
const box = page.locator('#side-column').getByPlaceholder('새로운 일정을 입력하세요...');
await box.fill('복사해 갈 문장');
await box.selectText();
await page.keyboard.press('Control+c');
await page.waitForTimeout(500);
// 다른 프로그램에서 복사한 것과 캡처 그림 (클립보드에 직접 쓴다)
await page.evaluate(() => navigator.clipboard.writeText('다른 프로그램에서 복사'));
await page.waitForTimeout(2600);
await page.evaluate(async () => {
  const c = document.createElement('canvas');
  c.width = 120; c.height = 60;
  const g = c.getContext('2d'); g.fillStyle = '#e11d48'; g.fillRect(0, 0, 120, 60);
  const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
  await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
});
await page.waitForTimeout(2600);
const rows = await page.locator('aside[aria-label="클립보드"] li').allInnerTexts();
const hasImg = await page.locator('aside[aria-label="클립보드"] li img').count();
console.log(`  최신 것이 위: 캡처 그림 > 다른 프로그램 복사 > 앱 안 Ctrl+C: ${ok(hasImg > 0 && rows[0].includes('그림') && rows[1].includes('다른 프로그램에서 복사') && rows[2].includes('복사해 갈 문장'))}`);
console.log(`    ${JSON.stringify(rows.slice(0, 3).map((r) => r.replace(/\s+/g, ' ').slice(0, 30)))}`);
await page.screenshot({ path: 'tools/report/side-4-clipboard.png' });
// 누르면 글 쓰던 칸에 붙여넣기
await box.fill('');
await box.click();
await page.locator('aside[aria-label="클립보드"] li', { hasText: '다른 프로그램에서 복사' }).getByTitle('눌러서 붙여넣기').click();
await page.waitForTimeout(400);
console.log(`  항목을 누르면 쓰던 칸에 붙는다: ${ok((await box.inputValue()) === '다른 프로그램에서 복사')}`);
// '모두 지우기' 뒤에 가장 최근 복사한 것이 2초 뒤 도로 담기던 것
page.once('dialog', (d) => d.accept());
await page.getByRole('button', { name: '모두 지우기' }).click();
await page.waitForTimeout(5000);
const afterClear = await page.locator('aside[aria-label="클립보드"] li').count();
console.log(`  '모두 지우기' 뒤 5초 - 되살아나지 않는다: ${ok(afterClear === 0)} (${afterClear}개)`);
await page.evaluate(() => navigator.clipboard.writeText('지운 뒤 새로 복사'));
await page.waitForTimeout(2600);
const afterNew = await page.locator('aside[aria-label="클립보드"] li').allInnerTexts();
console.log(`  새로 복사하면 다시 모인다: ${ok(afterNew.length === 1 && afterNew[0].includes('지운 뒤 새로 복사'))}`);
// 클립보드 칸 폭 조절
const cw0 = clip.w;
const lh = await page.locator('[data-column-resizer="left"]').boundingBox();
await page.mouse.move(lh.x + lh.width / 2, 300);
await page.mouse.down();
await page.mouse.move(lh.x + 120, 300, { steps: 6 });
await page.mouse.up();
await page.waitForTimeout(300);
const cw1 = (await rect(page, 'aside[aria-label="클립보드"]'))[0].w;
console.log(`  클립보드 경계선도 끌어 폭을 바꾼다 (${cw0} -> ${cw1}): ${ok(cw1 > cw0 + 80)}`);
await page.screenshot({ path: 'tools/report/side-5-both.png' });
await page.locator('[data-column-resizer="left"]').dblclick();
await page.getByTitle('클립보드 닫기').first().click();
await page.context().close();

// ── 휴대폰 ──
const phone = await open(390, 844);
console.log('\n[휴대폰 390]');
await phone.getByTitle(/통합 검색/).first().click();
await phone.waitForTimeout(800);
const pf = await rect(phone, '[data-popup-frame]');
console.log(`  배너로 뜬다(화면을 꽉 채움): ${ok(pf[0]?.w >= 380)}`);
await phone.goBack();
await phone.waitForTimeout(800);
console.log(`  뒤로가기로 닫힌다: ${ok((await rect(phone, '[data-popup-frame]')).length === 0 && phone.url().startsWith(V4))}`);
await phone.getByTitle(/클립보드 열기/).click();
await phone.waitForTimeout(600);
const pc = (await rect(phone, 'aside[aria-label="클립보드"]'))[0];
console.log(`  클립보드는 왼쪽에서 덮어 나온다: ${ok(pc?.left === 0 && pc?.w > 300)}`);
await phone.screenshot({ path: 'tools/report/side-6-phone-clipboard.png' });
await phone.goBack();
await phone.waitForTimeout(800);
console.log(`  뒤로가기로 클립보드가 닫힌다: ${ok((await rect(phone, 'aside[aria-label="클립보드"]')).length === 0 && phone.url().startsWith(V4))}`);

await browser.close();
process.exit(0);
