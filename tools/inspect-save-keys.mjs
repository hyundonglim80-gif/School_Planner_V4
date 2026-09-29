// tools/inspect-save-keys.mjs
//
// Ctrl+S가 저장 단추가 있는 팝업마다 저장하는지, 클립보드 칸 단축키가 도는지 실제 크롬에서 본다.
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-save-keys.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
page.on('dialog', (d) => d.accept());
const ok = (y) => (y ? '✔' : '✘');
const toast = async (re) => {
  for (let i = 0; i < 20; i++) {
    if ((await page.getByText(re).count()) > 0) return true;
    await page.waitForTimeout(150);
  }
  return false;
};
const openMenu = async (label) => {
  await page.getByTitle('더보기 메뉴').click();
  await page.waitForTimeout(250);
  await page.getByRole('button', { name: label }).first().click();
  await page.waitForTimeout(900);
};
await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);

// 1) 클립보드 단축키: 단축키 설정에서 Alt+B를 주고 눌러 본다
await openMenu(/환경설정/);
await page.getByRole('button', { name: /단축키 설정/ }).click();
await page.waitForTimeout(700);
const keyBox = page.getByLabel('클립보드 칸 열기 / 닫기 키');
await keyBox.click();
await keyBox.press('Alt+KeyB');
// 키 칸 안에서 누른 Ctrl+S는 키로 들어가야 한다(저장이 아니라) - 다른 칸에서 확인
const box2 = page.getByLabel('휴지통 키');
await box2.click();
await box2.press('Control+KeyS');
await page.waitForTimeout(200);
const boxVal = await box2.inputValue();
console.log(`단축키 칸 안의 Ctrl+S는 키로 들어간다: ${ok(/S/.test(boxVal))} (${boxVal})`);
await box2.press('Backspace');
// 단축키 창 저장은 Ctrl+S로 (칸 밖, 창 안의 제목을 눌러 커서를 옮긴다)
await page.getByRole('heading', { name: '⌨️ 단축키' }).click();
await page.keyboard.press('Control+KeyS');
await page.waitForTimeout(800);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);
await page.keyboard.press('Alt+KeyB');
await page.waitForTimeout(500);
const opened = (await page.locator('aside[aria-label="클립보드"]').count()) > 0;
await page.keyboard.press('Alt+KeyB');
await page.waitForTimeout(500);
const closed = (await page.locator('aside[aria-label="클립보드"]').count()) === 0;
console.log(`Alt+B로 클립보드 열고 닫기 (단축키 창도 Ctrl+S로 저장됨): ${ok(opened && closed)}`);

// 2) D-Day (저장 함수를 따로 안 줬다 - 입력칸의 form 제출)
await page.getByTitle(/학사 D-Day 관리/).click();
await page.waitForTimeout(700);
await page.getByPlaceholder(/일정명/).fill('컨트롤에스디데이');
await page.locator('[role=dialog] input[type=date]').first().fill('2026-12-24');
await page.getByPlaceholder(/일정명/).focus();
await page.keyboard.press('Control+KeyS');
await page.waitForTimeout(1500);
console.log(`D-Day: Ctrl+S로 추가: ${ok((await page.locator('[role=dialog]').getByText('컨트롤에스디데이').count()) > 0)}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 3) 환경설정: 스크롤 이동을 켜고 Ctrl+S
await openMenu(/환경설정/);
await page.getByText('스크롤로 페이지 이동').click();
await page.keyboard.press('Control+KeyS');
console.log(`환경설정: Ctrl+S로 저장: ${ok(await toast(/저장되었습니다|저장했습니다|✓ 저장/))}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(400);

// 4) 라벨 관리
await page.getByTitle('일정 라벨 설정').first().click();
await page.waitForTimeout(1200);
await page.locator('[role=dialog]').last().click({ position: { x: 20, y: 80 } });
await page.keyboard.press('Control+KeyS');
console.log(`라벨 관리: Ctrl+S로 클라우드 저장: ${ok(await toast(/저장/))}`);
await page.keyboard.press('Escape');
await page.waitForTimeout(600);

// 5) 겹친 칸: 일정 쓰는 칸 -> 링크 추가 -> 링크 창에서 Ctrl+S는 링크만 저장, 일정은 저장하지 않는다
const before = await page.locator('[data-focus-key^="event"]').count();
await page.getByRole('button', { name: '일정 추가' }).click();
await page.waitForTimeout(600);
await page.locator('#side-column').getByPlaceholder('새로운 일정을 입력하세요...').fill('컨트롤에스 겹침 점검');
await page.locator('#side-column aside').getByRole('button', { name: /링크 추가/ }).click();
await page.waitForTimeout(1200);
await page.locator('#side-column section[role=dialog]').getByPlaceholder(/키워드/).focus();
await page.keyboard.press('Control+KeyS');
// 고른 것이 없으면 링크 창은 '연결할 항목을 선택해주세요'를 띄우고 남는다(단추와 같다) - 링크 창이 받았다는 뜻
const linkerGot = await toast(/연결할 항목을 선택해주세요/);
await page.waitForTimeout(800);
const after = await page.locator('[data-focus-key^="event"]').count();
await page.getByRole('heading', { name: /새 데이터 연결하기/ }).locator('..').locator('..').getByTitle('닫기').first().click().catch(() => page.keyboard.press('Escape'));
console.log(`링크 창의 Ctrl+S는 링크 창만 (일정은 아직 저장 안 됨 ${before} -> ${after}): ${ok(linkerGot && after === before)}`);
// 이제 일정 칸에서 Ctrl+S
await page.locator('#side-column').getByPlaceholder('새로운 일정을 입력하세요...').focus();
await page.keyboard.press('Control+KeyS');
await page.waitForTimeout(1500);
console.log(`일정 칸의 Ctrl+S는 일정 저장: ${ok((await page.getByText('컨트롤에스 겹침 점검').count()) > 0)}`);
await b.close();
