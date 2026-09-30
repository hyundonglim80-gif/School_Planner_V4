// tools/inspect-paste-table.mjs
//
// 메모·기록에 엑셀 표 붙여넣기(lib/entryTable)를 실제 크롬에서 본다.
// 엑셀 클립보드와 같은 모양의 HTML을 붙여넣기 이벤트로 넣는다 (엑셀은 표와 함께 그림도 준다).
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-paste-table.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext({ viewport: { width: 1400, height: 950 } })).newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const ok = (y) => (y ? '✔' : '✘');
const RUN = Date.now().toString(36);

const EXCEL = `<html xmlns:x="urn:schemas-microsoft-com:office:excel"><head><style>
td {font-size:11.0pt; text-align:general; vertical-align:bottom; border:none; white-space:nowrap;}
.xl65 {font-weight:700; text-align:center; background:#FFFF00; border:.5pt solid windowtext;}
.xl66 {color:red; border:.5pt solid windowtext;}
.xl67 {border:.5pt solid windowtext; mso-diagonal-down:.5pt solid windowtext;}
</style></head><body><table>
<col width=90><col width=70><col width=70>
<tr height=24><td colspan=3 class=xl65>표점검 ${RUN}</td></tr>
<tr><td class=xl66>이름</td><td class=xl66>국어</td><td class=xl66>수학</td></tr>
<tr><td>김하나</td><td x:num>95</td><td x:num>88</td></tr>
<tr><td class=xl67>대각선</td><td></td><td></td></tr>
</table></body></html>`;

/** 엑셀처럼 표 HTML + 글자 + 그림을 함께 붙여넣는다 */
const pasteExcel = (locator) =>
  locator.evaluate(async (el, html) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/html', html);
    dt.setData('text/plain', '표\t점검');
    const png = await (await fetch('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==')).blob();
    dt.items.add(new File([png], 'excel.png', { type: 'image/png' }));
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, EXCEL);

await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);

// ── 메모 ──
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Shift+Digit5');
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /새 메모/ }).first().click();
await page.waitForTimeout(700);
const memoPanel = page.locator('#side-column aside').first();
await pasteExcel(memoPanel.locator('textarea').first());
await page.waitForTimeout(500);
const title = memoPanel.locator('td', { hasText: `표점검 ${RUN}` });
const t1 = (await title.count()) === 1;
const css = t1 ? await title.evaluate((e) => { const s = getComputedStyle(e); return [s.fontWeight, s.backgroundColor, s.textAlign, e.colSpan]; }) : [];
console.log(`메모 칸: 붙여넣으면 표가 된다: ${ok(t1)}`);
console.log(`  서식 (굵게·노랑 배경·가운데·병합 3칸): ${ok(css[0] === '700' && css[1] === 'rgb(255, 255, 0)' && css[2] === 'center' && css[3] === 3)}  ${JSON.stringify(css)}`);
const red = await memoPanel.locator('td', { hasText: '국어' }).evaluate((e) => getComputedStyle(e).color);
console.log(`  빨간 글자: ${ok(red === 'rgb(255, 0, 0)')}`);
const num = await memoPanel.locator('td', { hasText: '95' }).evaluate((e) => getComputedStyle(e).textAlign);
console.log(`  숫자는 오른쪽: ${ok(num === 'right')}`);
const diag = await memoPanel.locator('td', { hasText: '대각선' }).evaluate((e) => getComputedStyle(e).backgroundImage);
console.log(`  대각선(↘)을 칸 배경에 그린다: ${ok(diag.includes('svg') && diag.includes("y2='100'"))}`);
const noImage = (await memoPanel.getByText(/붙여넣은_이미지|업로드 중/).count()) === 0;
console.log(`  그림으로 올리지 않았다: ${ok(noImage)}`);
// 칸 고치기
await memoPanel.locator('td', { hasText: '김하나' }).click();
await memoPanel.getByLabel('3줄 1열 칸').fill(`김두리${RUN}`);
await memoPanel.getByLabel('3줄 1열 칸').press('Enter');
await memoPanel.locator('textarea').first().fill(`표 메모 ${RUN}`);
await memoPanel.locator('textarea').first().press('Control+s');
await page.waitForTimeout(1500);
await memoPanel.getByRole('button', { name: /^닫기$/ }).click();
await page.waitForTimeout(500);
await page.getByRole('button', { name: /전체 메모/ }).first().click();
await page.waitForTimeout(700);
const card = page.locator('[data-focus-key^="memo"]', { hasText: `표 메모 ${RUN}` });
console.log(`메모 카드에 표가 보인다: ${ok((await card.locator('[data-entry-table] td', { hasText: `김두리${RUN}` }).count()) === 1)}`);

// 새로 고쳐도 남는다
await page.reload();
await page.getByRole('heading', { level: 2 }).first().waitFor({ timeout: 40000 }).catch(() => {});
await page.waitForTimeout(2500);
await page.getByRole('button', { name: /전체 메모/ }).first().click().catch(() => {});
await page.waitForTimeout(800);
const card2 = page.locator('[data-focus-key^="memo"]', { hasText: `표 메모 ${RUN}` });
console.log(`  새로 고쳐도 표·고친 칸이 남는다: ${ok((await card2.locator('td', { hasText: `김두리${RUN}` }).count()) === 1)}`);

// ── 기록 (글 없이 표만) ──
await page.evaluate(() => document.activeElement?.blur());
await page.keyboard.press('Shift+Digit1');
await page.waitForTimeout(1500);
await page.getByRole('button', { name: '기록 추가' }).click();
await page.waitForTimeout(700);
const jPanel = page.locator('#side-column aside[aria-label="기록 쓰기"]').first();
await pasteExcel(jPanel.locator('textarea').first());
await page.waitForTimeout(400);
await jPanel.locator('textarea').first().press('Control+s');
await page.waitForTimeout(1500);
await jPanel.getByRole('button', { name: /^닫기$/ }).click();
await page.waitForTimeout(700);
const jCard = page.locator('[data-focus-key^="journal"]', { hasText: `표점검 ${RUN}` });
console.log(`기록: 글 없이 표만 저장된다: ${ok((await jCard.count()) === 1)}`);
console.log(`  카드에 '[표]' 글은 안 보이고 ▦ 1이 붙는다: ${ok((await jCard.getByText('[표]', { exact: true }).count()) === 0 && (await jCard.getByTitle('붙인 표').innerText()).includes('1'))}`);
await jCard.click();
await page.waitForTimeout(700);
const reopened = page.locator('#side-column aside').first();
console.log(`  다시 열면 본문은 비어 있고 표가 있다: ${ok((await reopened.locator('textarea').first().inputValue()) === '' && (await reopened.locator('td', { hasText: `표점검 ${RUN}` }).count()) === 1)}`);
await page.screenshot({ path: 'tools/report/paste-table.png' });

console.log(`페이지 오류 없음: ${ok(errors.length === 0)} ${errors.join(' | ')}`);
await b.close();
