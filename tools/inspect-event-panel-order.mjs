// tools/inspect-event-panel-order.mjs
//
// 일정 칸의 내용 칸이 맨 위인지(docs/ROADMAP.md 6-4) 실제 크롬으로 본다.
//   - 새 일정 칸: 내용 칸이 날짜·라벨·속성보다 위, 열자마자 커서가 있어 곧바로 적힌다
//   - 저장하면 이어지는 수정 칸도 내용 칸이 맨 위
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-event-panel-order.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;
const TEXT = `내용 칸 맨 위 점검 ${Date.now() % 100000}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();

  const panel = page.getByRole('complementary', { name: '일정 쓰기' });
  const tops = async () => {
    const y = async (loc) => (await loc.boundingBox())?.y ?? -1;
    return {
      text: await y(panel.getByPlaceholder('새로운 일정을 입력하세요...')),
      date: await y(panel.getByLabel('일정 날짜')),
      label: await y(panel.getByText('라벨 (다중 선택 가능)')),
      attrs: await y(panel.getByText('속성 설정')),
    };
  };
  const inOrder = (t) => t.text >= 0 && t.text < t.date && t.date < t.label && t.label < t.attrs;

  // ── 1. 새 일정 칸 ──
  await page.getByRole('button', { name: '일정 추가' }).first().click();
  await panel.getByPlaceholder('새로운 일정을 입력하세요...').waitFor({ timeout: 10000 });
  const t1 = await tops();
  check('새 일정 칸: 내용 → 날짜 → 라벨 → 속성 차례', inOrder(t1), JSON.stringify(t1));
  await page.waitForTimeout(300);
  const focused = await page.evaluate(() => document.activeElement?.getAttribute('placeholder'));
  check('열자마자 커서가 내용 칸에 있다', focused === '새로운 일정을 입력하세요...', String(focused));
  await page.keyboard.type(TEXT);
  check('누르지 않고 곧바로 적힌다', (await panel.getByPlaceholder('새로운 일정을 입력하세요...').inputValue()) === TEXT);
  await page.screenshot({ path: 'tools/report/event-panel-order-new.png' });

  // ── 2. 저장하면 수정 칸도 같은 차례 ──
  await page.keyboard.press('Control+s');
  await page.getByText('일정을 추가했습니다').first().waitFor({ timeout: 15000 });
  await panel.getByRole('heading', { name: '일정 수정' }).waitFor({ timeout: 10000 });
  const t2 = await tops();
  check('수정 칸: 내용 → 날짜 → 라벨 → 속성 차례', inOrder(t2), JSON.stringify(t2));
  check('수정 칸 내용 칸에 적은 글이 그대로', (await panel.getByPlaceholder('새로운 일정을 입력하세요...').inputValue()) === TEXT);

  // ── 3. 목록에서 다시 열어도 같은 차례, 지우고 정리 ──
  await panel.getByRole('button', { name: '닫기' }).click();
  await page.getByText(TEXT).first().click();
  await panel.getByPlaceholder('새로운 일정을 입력하세요...').waitFor({ timeout: 10000 });
  const t3 = await tops();
  check('목록에서 연 수정 칸도 같은 차례', inOrder(t3), JSON.stringify(t3));
  await page.screenshot({ path: 'tools/report/event-panel-order-edit.png' });
  await panel.getByRole('button', { name: '삭제' }).click();
  await page.getByText(/일정을 삭제했습니다/).first().waitFor({ timeout: 15000 }).catch(() => {});

  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
