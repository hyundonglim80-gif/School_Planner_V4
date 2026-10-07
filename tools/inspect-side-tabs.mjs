// tools/inspect-side-tabs.mjs
//
// 오른쪽 칸 탭 (2026-10-07) - 실제 크롬으로 본다 (PC 1400px, teacher).
//   - 칸 하나면 탭이 없다 / 새 메모 → 새 기록을 열면 탭 둘, 나중에 연 기록이 보이고 메모는 숨는다
//   - 메모 탭을 누르면 메모 칸이 보이고 적던 글이 그대로 / 탭 이름에 쓰던 글 첫 줄
//   - 탭의 ×는 그 칸만 닫는다 / 팝업(라벨 관리)도 탭으로 더해진다 / ESC는 모두 닫는다
// 저장하지 않으므로 바뀌는 자료가 없다.
import { chromium } from 'playwright';
const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.setDefaultTimeout(15000);
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
const tabs = page.locator('[data-side-tabs] [role=tab]');
try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(800);
  await page.locator('[data-day-add-memo]').click();
  const memo = page.locator('aside[aria-label="메모 쓰기"]');
  await memo.locator('textarea').first().fill('탭점검 메모 첫줄\n둘째');
  check('칸 하나면 탭이 없다', (await page.locator('[data-side-tabs]').count()) === 0);
  await page.getByRole('button', { name: '기록 추가' }).first().click();
  const journal = page.locator('aside[aria-label="기록 쓰기"]');
  await journal.waitFor();
  await page.locator('[data-side-tabs]').waitFor();
  check('새 기록을 열면 탭 둘, 기록이 보이고 메모는 숨는다', (await tabs.count()) === 2 && (await journal.isVisible()) && !(await memo.isVisible()));
  await page.waitForTimeout(300);
  const firstTab = tabs.nth(0);
  check("탭 이름에 칸 이름·쓰던 글 첫 줄 ('메모 · 탭점검 메모 첫줄')", /메모 · 탭점검/.test(await firstTab.innerText()), await firstTab.innerText());
  check('보이는 탭은 기록', (await tabs.nth(1).getAttribute('aria-selected')) === 'true');
  await firstTab.locator('button').first().click();
  await page.waitForTimeout(300);
  check('메모 탭을 누르면 메모 칸이 보이고 적던 글이 그대로', (await memo.isVisible()) && !(await journal.isVisible()) && (await memo.locator('textarea').first().inputValue()) === '탭점검 메모 첫줄\n둘째');
  // 팝업도 탭으로
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /라벨 관리/ }).first().click();
  await page.locator('[role=dialog]', { hasText: '라벨 관리' }).first().waitFor();
  check('팝업(라벨 관리)도 탭으로 더해진다', (await tabs.count()) === 3 && (await tabs.nth(2).getAttribute('aria-selected')) === 'true', String(await tabs.count()));
  // × 로 기록 탭만 닫기
  await tabs.nth(1).getByLabel('탭 닫기').click();
  await page.waitForTimeout(500);
  check('탭의 ×는 그 칸만 닫는다 (기록)', (await journal.count()) === 0 && (await tabs.count()) === 2);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  check('ESC는 모두 닫는다 (저장 안 한 글은 묻고 - 예)', (await page.locator('#side-column > *').count()) === 0);
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
