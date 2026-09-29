// tools/inspect-side-popups.mjs
//
// 팝업을 오른쪽 칸으로 띄우는 것(환경설정 > 팝업 모양)을 실제 크롬에서 본다.
//   - 넓은 화면: 화면을 나눠 오른쪽에 붙는다 / 칸 위에서 연 칸은 위아래로 나눈다(하위가 위)
//   - 칸 스크롤이 뒤 화면과 따로 돈다
//   - 휴대폰: 오른쪽에서 나오는 배너
//   - 뒤로가기는 맨 위 칸부터 한 겹씩 닫는다
//
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-side-popups.mjs      (사진은 tools/report/side-*.png)
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ok = (yes) => (yes ? '✔' : '✘');

async function open(width, height) {
  const ctx = await browser.newContext({ viewport: { width, height } });
  const page = await ctx.newPage();
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(2000);
  return page;
}
const frames = (page) =>
  page.$$eval('[data-popup-frame], aside[aria-label]', (els) =>
    els.map((e) => {
      const r = e.getBoundingClientRect();
      return { kind: e.dataset.popupFrame || 'panel', top: Math.round(r.top), h: Math.round(r.height), left: Math.round(r.left), w: Math.round(r.width) };
    })
  );

// ── 넓은 화면 ──
const page = await open(1280, 800);
console.log('\n[넓은 화면 1280]');
await page.getByTitle(/통합 검색/).first().click();
await page.waitForTimeout(800);
let f = await frames(page);
const mainRight = await page.$eval('main', (m) => Math.round(m.getBoundingClientRect().right));
console.log(`  검색이 오른쪽 칸으로: ${ok(f.length === 1 && f[0].kind === 'side' && f[0].left + f[0].w === 1280)}  ${JSON.stringify(f)}`);
console.log(`  화면이 칸 폭만큼 줄었다(본문 오른쪽 끝 ${mainRight} <= 칸 왼쪽 ${f[0]?.left}): ${ok(mainRight <= f[0]?.left + 1)}`);
await page.screenshot({ path: 'tools/report/side-1-search.png' });

// 스크롤이 따로 돈다: 칸 위에서 굴리면 뒤 화면은 그대로
const y0 = await page.evaluate(() => scrollY);
await page.mouse.move(1280 - 50, 400);
for (let i = 0; i < 15; i++) await page.mouse.wheel(0, 400);
await page.waitForTimeout(600);
const y1 = await page.evaluate(() => scrollY);
console.log(`  칸 위에서 굴려도 뒤 화면은 그대로 (scrollY ${y0} -> ${y1}): ${ok(y0 === y1)}`);
// 뒤 화면 위에서 굴리면 뒤 화면이 굴러간다 (잠그지 않았다)
await page.mouse.move(300, 400);
await page.mouse.wheel(0, 600);
await page.waitForTimeout(600);
const y2 = await page.evaluate(() => scrollY);
console.log(`  칸이 열린 채 뒤 화면도 굴러간다 (scrollY ${y1} -> ${y2}): ${ok(y2 > y1)}`);
await page.evaluate(() => scrollTo(0, 0));
await page.getByTitle('닫기').first().click();
await page.waitForTimeout(500);

// 칸 위에서 연 칸: 일정 쓰는 칸 -> 링크 추가 -> 새 일정 만들어 연결
await page.getByRole('button', { name: /새 일정/ }).first().click();
await page.waitForTimeout(600);
await page.locator('aside').getByRole('button', { name: /링크 추가/ }).first().click();
await page.waitForTimeout(1200);
f = await frames(page);
const sorted = [...f].sort((a, b) => a.top - b.top);
console.log(`  일정 칸에서 링크 추가 - 둘로 나눈다(링크가 위, 일정 칸이 아래): ${ok(f.length === 2 && sorted[0].kind === 'side' && sorted[1].kind === 'panel' && sorted[0].h > 300 && sorted[1].top >= sorted[0].h - 2)}  ${JSON.stringify(sorted)}`);
await page.screenshot({ path: 'tools/report/side-2-split.png' });
await page.getByRole('button', { name: /새 일정 만들어 연결/ }).first().click().catch(() => {});
await page.waitForTimeout(1000);
f = await frames(page);
console.log(`  거기서 또 열면 셋으로 나눈다: ${ok(f.length === 3)}  ${JSON.stringify([...f].sort((a, b) => a.top - b.top))}`);
await page.screenshot({ path: 'tools/report/side-3-three.png' });

await page.goBack();
await page.waitForTimeout(800);
console.log(`  뒤로가기 - 맨 위만 닫혀 둘로 돌아간다: ${ok((await frames(page)).length === 2)}`);
await page.goBack();
await page.waitForTimeout(800);
f = await frames(page);
console.log(`  뒤로가기 - 일정 칸이 다시 오른쪽을 다 쓴다: ${ok(f.length === 1 && f[0].kind === 'panel' && f[0].top === 0 && f[0].h === 800)}`);
await page.goBack();
await page.waitForTimeout(800);
console.log(`  뒤로가기 - 다 닫히고 앱에 그대로: ${ok((await frames(page)).length === 0 && page.url().startsWith(V4))}`);

// 넓은 팝업(라벨 관리)과 환경설정의 '가운데 팝업'
await page.getByTitle('일정 라벨 설정').first().click();
await page.waitForTimeout(1000);
await page.screenshot({ path: 'tools/report/side-4-label.png' });
f = await frames(page);
console.log(`  라벨 관리는 넓게 연다: ${ok(f[0]?.w > 500)} (${f[0]?.w}px)`);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
// 환경설정에서 '가운데 팝업'을 고르면 그 자리에서 환경설정 창부터 가운데로 옮겨 간다
// (계정에 저장되는 값이라 localStorage를 직접 고치면 계정 값이 도로 덮는다)
await page.getByTitle('더보기 메뉴').click();
await page.getByRole('button', { name: /환경설정/ }).first().click();
await page.waitForTimeout(800);
await page.getByRole('button', { name: /가운데 팝업/ }).click();
await page.waitForTimeout(600);
f = await frames(page);
console.log(`  '가운데 팝업'을 고르면 그 자리에서 예전처럼: ${ok(f.length === 1 && f[0]?.kind === 'center')}`);
await page.screenshot({ path: 'tools/report/side-5-center.png' });
await page.getByRole('button', { name: /^오른쪽 칸$/ }).click();
await page.waitForTimeout(600);
f = await frames(page);
console.log(`  '오른쪽 칸'으로 되돌리면 다시 오른쪽: ${ok(f[0]?.kind === 'side')}`);
await page.context().close();

// ── 휴대폰 ──
const phone = await open(390, 844);
console.log('\n[휴대폰 390]');
await phone.getByTitle(/통합 검색/).first().click();
await phone.waitForTimeout(800);
f = await frames(phone);
console.log(`  배너로 뜬다(화면을 꽉 채움): ${ok(f[0]?.kind === 'banner' && f[0]?.w >= 380)}`);
await phone.screenshot({ path: 'tools/report/side-6-phone.png' });
await phone.goBack();
await phone.waitForTimeout(800);
console.log(`  뒤로가기로 닫힌다: ${ok((await frames(phone)).length === 0 && phone.url().startsWith(V4))}`);

await browser.close();
process.exit(0);
