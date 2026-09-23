// tools/inspect-back.mjs
//
// 휴대폰 뒤로가기가 팝업만 닫는지 진짜 브라우저에서 확인한다.
//
// jsdom의 history는 흉내다. pushState/popstate가 진짜 브라우저와 같은 차례로
// 오지 않으므로, '뒤로가기를 눌렀더니 앱에서 나가더라' 같은 것은 단위 테스트로
// 잡히지 않는다. 실제로 이 사고가 그랬다.
//
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-back.mjs
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
// 휴대폰 크기로 본다 (이 사고는 휴대폰에서 났다)
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const page = await ctx.newPage();

const ok = (yes) => (yes ? '✔' : '✘');
// '앱에 그대로 있다'는 두 가지를 다 본다. 고치기 전 판은 뒤로가기 한 번에
// about:blank로 나가 버렸다(주소가 바뀜고 화면도 사라졌다).
const onApp = async () =>
  page.url().startsWith(V4) &&
  (await page.getByRole('heading', { name: '일정' }).isVisible().catch(() => false));
const historyLen = () => page.evaluate(() => history.length);

await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(2500);

// 휴대폰에서 팝업을 여는 길: 아래 탭바의 '더보기' 또는 상단 단추들
async function openSearch() {
  // 좁은 화면에서는 단추 글씨가 숨고 아이콘만 남는다. title로 찾는다.
  await page.getByTitle(/통합 검색/).first().click();
  await page.getByRole('heading', { name: /🔍 검색/ }).waitFor({ timeout: 10000 });
}

const searchOpen = () =>
  page.getByRole('heading', { name: /🔍 검색/ }).isVisible().catch(() => false);

console.log('\n[1] 팝업을 열고 뒤로가기]');
const lenBefore = await historyLen();
await openSearch();
await page.waitForTimeout(400);
await page.goBack();
await page.waitForTimeout(800);
console.log(`  팝업이 닫혔다: ${ok(!(await searchOpen()))}`);
console.log(`  앱에 그대로 있다: ${ok(await onApp())}`);

console.log('\n[2] 겹쳐 연 팝업 - 맨 위만 닫힌다]');
await openSearch();
await page.waitForTimeout(300);
// 검색 팝업 위에 라벨 관리를 띄울 길이 없으므로, 하루 화면의 새 일정 > 링크 추가로 겹쳐 본다
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.getByRole('button', { name: /새 일정/ }).first().click();
await page.waitForTimeout(300);
await page.getByRole('button', { name: /링크 추가/ }).first().click();
await page.waitForTimeout(1200);
const linkerOpen = () =>
  page.getByRole('heading', { name: /새 데이터 연결하기/ }).isVisible().catch(() => false);
console.log(`  링크 추가가 열렸다: ${ok(await linkerOpen())}`);
await page.getByRole('button', { name: /새 일정 만들어 연결/ }).first().click();
await page.waitForTimeout(800);
const createOpen = () =>
  page.getByRole('heading', { name: /만들어 연결/ }).isVisible().catch(() => false);
console.log(`  그 위에 등록창이 열렸다: ${ok(await createOpen())}`);
await page.goBack();
await page.waitForTimeout(800);
console.log(`  뒤로가기 한 번 - 등록창만 닫혔다: ${ok(!(await createOpen()))}`);
console.log(`  아래 링크 추가는 그대로다: ${ok(await linkerOpen())}`);
await page.goBack();
await page.waitForTimeout(800);
console.log(`  뒤로가기 또 한 번 - 링크 추가도 닫혔다: ${ok(!(await linkerOpen()))}`);
console.log(`  앱에 그대로 있다: ${ok(await onApp())}`);

console.log('\n[3] 닫기 단추로 닫으면 기록이 쌓이지 않는다]');
const lenA = await historyLen();
for (let i = 0; i < 3; i++) {
  await openSearch();
  await page.waitForTimeout(250);
  await page.getByTitle('닫기').first().click();
  await page.waitForTimeout(500);
}
const lenB = await historyLen();
console.log(`  열고 닫기 3번 - 기록 길이 ${lenA} -> ${lenB}: ${ok(lenB <= lenA + 1)}`);

console.log(`\n(처음 기록 길이 ${lenBefore})`);
await page.screenshot({ path: 'tools/report/back-button.png' });
await browser.close();
process.exit(0);
