// tools/shot-help.mjs
//
// 사용 설명서가 목록 → 자세히 → 연결 → 찾기로 제대로 넘어가는지 눈으로 본다.
// PC와 휴대폰 폭 둘 다 찍는다.
//
//   VITE_USE_EMULATOR=1 npm run build && npx vite preview --port 4173
//   SITE=http://localhost:4173/ OUT=<폴더> node tools/shot-help.mjs
//   (개발 서버(dev:emu)에서는 팝업이 열리지 않아 배포본으로 본다)
import { chromium } from 'playwright';

const V4 = process.env.SITE || 'http://localhost:4190/School_Planner_V4/';
const OUT = process.env.OUT || 'tools/report';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

for (const [tag, viewport] of [['pc', { width: 1280, height: 900 }], ['mobile', { width: 390, height: 844 }]]) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);

  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /사용 설명서 및 단축키/ }).click();
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: /단축키 한눈에 보기/ }).waitFor();
  await page.screenshot({ path: `${OUT}/help-${tag}-1-list.png` });

  await page.getByRole('button', { name: /캡처 이미지 붙여넣기/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/help-${tag}-2-detail.png` });

  // 설명 안의 연결을 따라간다
  await page.getByRole('button', { name: '← 목록' }).click();
  await page.getByRole('button', { name: /일정 속성 5가지/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/help-${tag}-3-attrs.png` });

  await page.getByRole('button', { name: '← 목록' }).click();
  await page.getByRole('button', { name: /단축키 한눈에 보기/ }).click();
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/help-${tag}-4-keys.png`, fullPage: false });

  await page.getByRole('button', { name: '← 목록' }).click();
  await page.getByLabel('설명서에서 찾기').fill('링크');
  await page.waitForTimeout(300);
  await page.screenshot({ path: `${OUT}/help-${tag}-5-search.png` });

  // 넘침 점검: 팝업 안에서 가로로 삐져나가는 것이 없어야 한다
  const overflow = await page.evaluate(() => {
    const dlg = document.querySelector('[data-scroll-lock]');
    return dlg ? dlg.scrollWidth - dlg.clientWidth : -1;
  });
  console.log(`${tag}: 가로 넘침 ${overflow}px, 오류 ${errors.length}건 ${errors.join(' | ')}`);
  await ctx.close();
}

await browser.close();
process.exit(0);
