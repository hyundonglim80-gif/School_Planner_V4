// tools/inspect-calendar-journal.mjs
//
// 주간·월간·년간에서 기록을 고치거나 더할 때 하루 화면과 같은 기록 칸이 열리는지 본다.
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-calendar-journal.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const ok = (y) => (y ? '✔' : '✘');
await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1200);
for (const [key, name] of [['Shift+Digit2', '주간'], ['Shift+Digit3', '월간'], ['Shift+Digit4', '년간']]) {
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press(key);
  await page.waitForTimeout(2000);
  // 고치기
  await page.getByTitle(/기록 \d+건 보기/).first().click();
  await page.waitForTimeout(1200);
  await page.locator('[role=dialog]').last().getByRole('button', { name: '수정' }).first().click();
  await page.waitForTimeout(1200);
  const edit = page.locator('#side-column aside', { has: page.getByRole('heading', { name: '기록 수정' }) });
  const hasAll = (await edit.count()) === 1
    && (await edit.getByText('파일 첨부').count()) === 1
    && (await edit.getByText('링크 추가').count()) === 1
    && (await edit.getByRole('button', { name: '삭제' }).count()) === 1
    && (await edit.getByRole('button', { name: '↔ 메모로' }).count()) === 1
    && /기록 ·/.test(await edit.innerText());
  console.log(`${name} - '수정'은 하루 화면과 같은 기록 칸(옆에 붙음·날짜·첨부·링크·삭제·옮기기): ${ok(hasAll)}`);
  await edit.getByRole('button', { name: /^닫기$/ }).click();
  await page.waitForTimeout(400);
  // 새로 쓰기
  await page.getByTitle(/기록 \d+건 보기/).first().click();
  await page.waitForTimeout(1000);
  await page.getByRole('button', { name: '이 날 기록 추가' }).click();
  await page.waitForTimeout(800);
  const add = page.locator('#side-column aside[aria-label="기록 쓰기"]').first();
  const okAdd = (await page.getByRole('heading', { name: '새 기록' }).count()) === 1 && (await add.getByText('파일 첨부').count()) === 1 && (await add.getByText('링크 추가').count()) === 1;
  console.log(`${name} - '+ 추가'는 하루 화면과 같은 새 기록 칸: ${ok(okAdd)}`);
  if (name === '주간') {
    const T = `달력에서 쓴 기록 ${Date.now() % 10000}`;
    const box = add.locator('textarea').first();
    await box.fill(T);
    await box.press('Control+s');
    await page.waitForTimeout(1500);
    await add.getByRole('button', { name: /^닫기$/ }).click();
    await page.evaluate(() => document.activeElement?.blur());
    await page.keyboard.press('Shift+Digit1');
    await page.waitForTimeout(1500);
    console.log(`  주간에서 쓴 기록이 하루 화면에 보인다: ${ok((await page.locator('[data-focus-key^="journal"]', { hasText: T }).count()) === 1)}`);
  } else {
    await add.getByRole('button', { name: /^닫기$/ }).click();
  }
  await page.waitForTimeout(400);
}
// 기록을 누르면 붙은 라벨이 체크된 채 열린다 (하루 화면)
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Shift+Digit1');
await page.waitForTimeout(1500);
const L = `라벨 점검 ${Date.now() % 10000}`;
await page.getByRole('button', { name: '기록 추가' }).click();
await page.waitForTimeout(700);
const np = page.locator('#side-column aside[aria-label="기록 쓰기"]').first();
await np.locator('textarea').first().fill(L);
await np.getByRole('button', { name: /^(✓ )?학생상담$/ }).click();
await np.locator('textarea').first().press('Control+s');
await page.waitForTimeout(1500);
await np.getByRole('button', { name: /^닫기$/ }).click();
await page.waitForTimeout(600);
// 새로 고친 뒤(라벨 목록을 새로 받는 상황) 눌러 연다
await page.reload();
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);
await page.locator('[data-focus-key^="journal"]', { hasText: L }).click();
await page.waitForTimeout(1500);
const panel = page.locator('#side-column aside[aria-label="기록 쓰기"]').first();
console.log(`기록을 눌러 열면 붙은 라벨(학생상담)이 체크되어 있다: ${ok((await panel.getByRole('button', { name: '✓ 학생상담' }).count()) === 1)}`);

// ESC: 쓰는 칸 둘 + 팝업 하나를 모두 닫는다
await page.getByRole('button', { name: '일정 추가' }).click();
await page.waitForTimeout(600);
await page.getByTitle('일정 라벨 설정').first().click();
await page.waitForTimeout(900);
console.log(`  (ESC 전 오른쪽 줄 ${await page.locator('#side-column > *').count()}칸)`);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
console.log(`ESC 한 번에 오른쪽 줄이 모두 닫힌다: ${ok((await page.locator('#side-column > *').count()) === 0)}`);

// ESC: 저장 안 한 글이 있으면 묻는다 (아니오 -> 남음, 예 -> 닫힘)
await page.getByRole('button', { name: '일정 추가' }).click();
await page.waitForTimeout(600);
await page.getByPlaceholder('새로운 일정을 입력하세요...').fill('저장 안 한 일정');
let asked = 0;
page.once('dialog', (d) => { asked++; d.dismiss(); });
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
const kept = (await page.locator('#side-column > *').count()) === 1;
page.once('dialog', (d) => { asked++; d.accept(); });
await page.keyboard.press('Escape');
await page.waitForTimeout(600);
console.log(`저장 안 한 글이 있으면 묻고(${asked}번), 아니오면 남고 예면 닫힌다: ${ok(asked === 2 && kept && (await page.locator('#side-column > *').count()) === 0)}`);

// Ctrl+S: 칸의 빈 곳을 누른 뒤에도(커서 없음) 맨 위 칸이 저장한다
await page.getByRole('button', { name: '일정 추가' }).click();
await page.waitForTimeout(600);
const E = `빈곳 저장 ${Date.now() % 10000}`;
await page.getByPlaceholder('새로운 일정을 입력하세요...').fill(E);
await page.locator('#side-column aside').first().click({ position: { x: 200, y: 700 } });
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Control+s');
await page.waitForTimeout(1500);
console.log(`칸의 빈 곳을 누른 뒤 Ctrl+S도 저장된다: ${ok((await page.locator('[data-focus-key^="event"]', { hasText: E }).count()) === 1)}`);
await b.close();
