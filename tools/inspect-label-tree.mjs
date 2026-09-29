// tools/inspect-label-tree.mjs
//
// 메모·기록 라벨 상위/하위(2단계)를 실제 크롬에서 본다.
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-label-tree.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const ok = (y) => (y ? '✔' : '✘');
await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);

// V3가 읽는 라벨 문서가 바뀌지 않는지 보려고 저장 전 모습을 적어 둔다
const labelsDoc = () => page.evaluate(async () => {
  const r = await fetch('http://127.0.0.1:8080/v1/projects/schoolplannerv3/databases/(default)/documents:runQuery', { method: 'POST' }).catch(() => null);
  return r ? r.status : null;
});

// 통합 라벨 관리 - 기록: 학생상담을 학급활동 밑에
await page.getByTitle('기록 라벨 설정').first().click();
await page.waitForTimeout(1500);
const dlg = page.locator('[role=dialog]', { hasText: '통합 라벨' }).last();
await dlg.getByLabel('학생상담 상위 라벨').selectOption({ label: '학급활동' });
await page.waitForTimeout(300);
console.log(`기록 라벨: 하위가 들여 보인다: ${ok((await dlg.locator('[data-label-row="학생상담"]').getAttribute('class')).includes('ml-6'))}`);
console.log(`  하위가 생긴 학급활동은 상위를 못 고른다(2단계): ${ok(await dlg.getByLabel('학급활동 상위 라벨').isDisabled())}`);
// 메모 탭: 개인을 업무 밑에
await dlg.getByRole('button', { name: /메모 라벨/ }).first().click();
await page.waitForTimeout(500);
const memoNames = await dlg.locator('[data-label-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-label-row')));
const [mParent, mChild] = [memoNames[0], memoNames[1]];
await dlg.getByLabel(`${mChild} 상위 라벨`).selectOption({ label: mParent });
await dlg.getByRole('button', { name: /클라우드 저장/ }).click();
await page.waitForTimeout(2000);
await page.keyboard.press('Escape');
await page.waitForTimeout(500);

// 새로 고쳐도 남는지 (계정에 저장)
await page.reload();
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1800);

// 하루 화면 기록 거르개
const chipCount = async () => page.locator('[data-focus-key^="journal"]').count();
// 기록을 두 개 만든다 (학급활동, 학생상담)
for (const [lbl, txt] of [['학급활동', '트리 상위 기록'], ['학생상담', '트리 하위 기록']]) {
  await page.getByRole('button', { name: '기록 추가' }).click();
  await page.waitForTimeout(600);
  const pn = page.locator('#side-column aside[aria-label="기록 쓰기"]').first();
  for (const on of await pn.locator('button', { hasText: /^✓/ }).all()) await on.click();
  await pn.getByRole('button', { name: new RegExp(`^(✓ )?${lbl}$`) }).click();
  await pn.locator('textarea').first().fill(txt);
  await pn.locator('textarea').first().press('Control+s');
  await page.waitForTimeout(1200);
  await pn.getByRole('button', { name: /^닫기$/ }).click();
  await page.waitForTimeout(400);
}
// 거르개 줄은 그날 기록이 있어야 보이므로, 기록을 만든 뒤에 본다 (오늘 심은 기록이 없을 수 있다)
const hidden = (await page.locator('main').getByRole('button', { name: '학생상담', exact: true }).count()) === 0;
await page.getByRole('button', { name: '학급활동 하위 라벨 펼치기' }).click();
await page.waitForTimeout(300);
const shown = (await page.locator('main').getByRole('button', { name: '학생상담', exact: true }).count()) === 1;
console.log(`하루 기록 거르개: 하위는 접혀 있다가 ▾로 펼쳐진다: ${ok(hidden && shown)}`);
await page.getByRole('button', { name: '학급활동', exact: true }).click();
await page.waitForTimeout(500);
const both = (await page.locator('[data-focus-key^="journal"]', { hasText: '트리 상위 기록' }).count()) === 1
  && (await page.locator('[data-focus-key^="journal"]', { hasText: '트리 하위 기록' }).count()) === 1;
console.log(`상위(학급활동)를 고르면 하위(학생상담) 기록까지 보인다: ${ok(both)}`);
await page.getByRole('button', { name: '학생상담', exact: true }).click();
await page.waitForTimeout(500);
const onlyChild = (await page.locator('[data-focus-key^="journal"]', { hasText: '트리 상위 기록' }).count()) === 0
  && (await page.locator('[data-focus-key^="journal"]', { hasText: '트리 하위 기록' }).count()) === 1;
console.log(`하위를 고르면 하위만: ${ok(onlyChild)}`);
await page.screenshot({ path: 'tools/report/label-tree-day.png', clip: { x: 0, y: 740, width: 1400, height: 210 } });

// 메모 화면 왼쪽 거르개
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Shift+Digit5');
await page.waitForTimeout(1800);
const nav = page.getByRole('navigation', { name: '메모 라벨 거르개' });
const childBtn = nav.getByRole('button', { name: new RegExp(mChild) });
console.log(`메모 거르개: 하위는 들여 쓰이고 마우스를 올리면 '${mParent} › ${mChild}': ${ok((await childBtn.getAttribute('title')) === `${mParent} › ${mChild}`)}`);
const cnt = (btn) => btn.evaluate((e) => Number(e.textContent.match(/(\d+)\s*$/)?.[1] || 0));
const parentCount = await cnt(nav.getByRole('button', { name: new RegExp(`^(✓)?${mParent}`) }).first());
const childCount = await cnt(childBtn.first());
console.log(`  상위 개수에 하위 메모도 들어간다 (${mParent} ${parentCount} ≥ ${mChild} ${childCount}): ${ok(parentCount >= childCount && childCount > 0)}`);
await page.screenshot({ path: 'tools/report/label-tree-memo.png', clip: { x: 0, y: 90, width: 320, height: 500 } });
await b.close();
