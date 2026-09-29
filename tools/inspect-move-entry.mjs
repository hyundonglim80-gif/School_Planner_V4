// tools/inspect-move-entry.mjs
//
// 메모 ↔ 기록 옮기기를 실제 크롬에서 본다.
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-move-entry.mjs
import { chromium } from 'playwright';
const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const b = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await b.newContext({ viewport: { width: 1280, height: 900 } })).newPage();
const ok = (y) => (y ? '✔' : '✘');
await page.goto(V4);
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);

// 옮길 메모를 하나 만든다
const M = `옮기기 점검 메모 ${Date.now() % 10000}`;
await page.keyboard.press('Shift+Digit5');
await page.waitForTimeout(1800);
await page.getByTitle(/새 메모 작성/).first().click();
await page.waitForTimeout(600);
const memoBox = page.getByPlaceholder(/자유롭게 생각을 기록해보세요/).first();
await memoBox.fill(M);
await memoBox.press('Control+s');
await page.waitForTimeout(1500);

// 메모 -> 기록
await page.getByRole('button', { name: '↔ 기록으로' }).click();
await page.waitForTimeout(600);
const dlg = page.locator('[role=dialog]', { has: page.getByRole('heading', { name: /기록으로 옮기기/ }) });
const today = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; });
console.log(`옮기기 창: 날짜 칸이 처음에 보던 날 ${ok((await dlg.getByLabel('옮길 날짜').inputValue()) === today)}`);
await dlg.getByRole('button', { name: '기록으로 옮기기' }).click();
await page.waitForTimeout(2500);
const jPanel = page.locator('#side-column aside', { has: page.getByRole('heading', { name: '기록 수정' }) });
console.log(`옮긴 뒤 기록 칸이 열리고 내용이 같다: ${ok((await jPanel.locator('textarea').first().inputValue()) === M)}`);
console.log(`메모 목록에서 사라졌다: ${ok((await page.locator('section [data-focus-key^="memo"]', { hasText: M }).count()) === 0)}`);
// 입력칸에 커서가 있으면 Shift+1은 글자로 들어간다(수식키 없는 단축키는 입력 중에 쉰다). 먼저 빼낸다.
await page.evaluate(() => (document.activeElement)?.blur());
await page.keyboard.press('Shift+Digit1');
await page.waitForTimeout(1800);
console.log(`오늘 기록에 보인다: ${ok((await page.locator('[data-focus-key^="journal"]', { hasText: M }).count()) === 1)}`);

// 기록 -> 메모
await jPanel.getByRole('button', { name: '↔ 메모로' }).click();
await page.waitForTimeout(600);
const dlg2 = page.locator('[role=dialog]', { has: page.getByRole('heading', { name: /메모로 옮기기/ }) });
console.log(`기록 -> 메모 창에 날짜 첫 줄 안내: ${ok((await dlg2.getByText(/\[\d{4}-\d{2}-\d{2} \(.\) 기록\]/).count()) > 0)}`);
await dlg2.getByRole('button', { name: '메모로 옮기기' }).click();
await page.waitForTimeout(2500);
const mPanel = page.locator('#side-column aside', { has: page.getByRole('heading', { name: '메모 수정' }) });
const memoText = await mPanel.locator('textarea').first().inputValue();
console.log(`메모 칸이 열리고 첫 줄에 날짜: ${ok(memoText.startsWith(`[${today} (`) && memoText.endsWith(M))}  (${JSON.stringify(memoText.slice(0, 40))})`);
console.log(`오늘 기록에서 사라졌다: ${ok((await page.locator('[data-focus-key^="journal"]', { hasText: M }).count()) === 0)}`);
await page.screenshot({ path: 'tools/report/move-entry.png' });

// 휴지통에 원본 둘
await mPanel.getByRole('button', { name: /^닫기$/ }).click();
await page.getByTitle(/^휴지통/).first().click();
await page.waitForTimeout(1800);
const trash = page.locator('[role=dialog]', { hasText: '휴지통' });
console.log(`휴지통에 (기록으로 옮김)·(메모로 옮김) 원본: ${ok((await trash.getByText(`(기록으로 옮김) ${M}`).count()) === 1 && (await trash.getByText(`(메모로 옮김) ${M}`).count()) === 1)}`);
await b.close();
