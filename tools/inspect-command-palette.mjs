// tools/inspect-command-palette.mjs
//
// 명령 창(docs/ROADMAP.md 6-2)을 실제 크롬으로 눌러 본다.
//   - 단축키로 열고 '다음 주 목' Enter → 그 날의 하루 화면
//   - 주간을 보던 중 '10/15' ↓ Enter → 주간 화면에 남은 채 그 주로
//   - '출석' → 출석부 칸, '진도' → 진도 관리 창 (처음 받는 창도 열린 채 남는다 - 뒤로가기 표지판 경합)
//   - 맞는 기능이 없는 글 → 통합 검색이 그 글로 열리고 곧바로 찾는다
//   - ⋮ 메뉴에서도 열린다, ESC로 닫힌다, 글 칸에 커서가 있어도 단축키가 듣는다
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-command-palette.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const p2 = (n) => String(n).padStart(2, '0');
const DAY = ['일', '월', '화', '수', '목', '금', '토'];
const label = (d) => `${d.getFullYear()}년 ${d.getMonth() + 1}월 ${d.getDate()}일 (${DAY[d.getDay()]})`;
// 다음 주 목요일 (주는 월요일부터)
const now = new Date();
const monIdx = (now.getDay() + 6) % 7;
const nextThu = new Date(now.getFullYear(), now.getMonth(), now.getDate() - monIdx + 7 + 3);

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

  const palette = () => page.getByRole('dialog').filter({ has: page.getByRole('combobox', { name: '명령 창' }) });
  const box = () => page.getByRole('combobox', { name: '명령 창' });
  const selected = () => page.locator('[role=option][aria-selected=true]');
  const headerDate = () => page.locator('span[title^="오늘 날짜로 돌아가기"]').first();
  const open = async () => {
    await page.keyboard.press('Control+k');
    await box().waitFor({ timeout: 10000 });
  };

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.locator('body').click({ position: { x: 5, y: 300 } });

  // ── 1. 단축키로 열기 ──
  await open();
  check('단축키로 열린다', await palette().isVisible());
  check('글 칸에 커서가 있다', await box().evaluate((el) => el === document.activeElement));
  check('비어 있으면 기능 목록', (await page.locator('[role=option]').count()) > 20);
  await page.screenshot({ path: 'tools/report/palette-empty.png' });

  // ── 2. 다음 주 목 → 하루 화면 ──
  await box().fill('다음 주 목');
  const first = (await selected().innerText()).replace(/\s+/g, ' ');
  check('맨 위가 다음 주 목요일 날짜', first.includes(label(nextThu)), first);
  await page.screenshot({ path: 'tools/report/palette-date.png' });
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('Enter → 창이 닫힌다', (await palette().count()) === 0);
  check('그 날의 하루 화면', (await headerDate().innerText()) === label(nextThu), await headerDate().innerText());

  // ── 3. 주간에서 10/15 ↓ Enter → 주간에 남는다 ──
  await page.getByRole('button', { name: '주간', exact: true }).first().click();
  await page.waitForTimeout(300);
  await open();
  await box().fill('10/15');
  await page.keyboard.press('ArrowDown');
  check('↓ → 주간 화면에서 가는 줄', (await selected().innerText()).includes('주간 화면에서'));
  await page.keyboard.press('Enter');
  await page.waitForTimeout(400);
  check('주간 화면에 남은 채 10월 그 주로', /년 10월 \d주/.test(await headerDate().innerText()), await headerDate().innerText());
  await page.getByRole('button', { name: '하루', exact: true }).first().click();

  // ── 4. 출석 → 출석부 칸 (남아 있는지) ──
  await open();
  await box().fill('출석');
  check("'출석' 맨 위가 출석부", (await selected().innerText()).includes('출석부'));
  await page.keyboard.press('Enter');
  const attend = page.locator('aside[aria-label="출석부 쓰기"]');
  await attend.waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('출석부 칸이 열려 남아 있다', await attend.isVisible().catch(() => false));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── 5. 진도 → 진도 관리 창 (처음 받는 창) ──
  await open();
  await box().fill('ㅈㄷ');
  check("첫소리 'ㅈㄷ' → 진도 관리", (await selected().innerText()).includes('진도 관리'));
  await page.keyboard.press('Enter');
  const prog = page.getByRole('dialog').filter({ hasText: '📘 진도 관리' });
  await prog.first().waitFor({ timeout: 15000 }).catch(() => {});
  await page.waitForTimeout(1500);
  check('진도 관리 창이 열려 남아 있다', await prog.first().isVisible().catch(() => false));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── 6. 맞는 기능이 없는 글 → 통합 검색 ──
  await open();
  await box().fill('현장체험');
  check('맞는 기능이 없으면 맨 위가 통합 검색', (await selected().innerText()).includes('"현장체험" 통합 검색'));
  await page.keyboard.press('Enter');
  const searchBox = page.getByPlaceholder(/검색어 입력/);
  await searchBox.waitFor({ timeout: 15000 });
  check('검색 창에 그 글이 들어 있다', (await searchBox.inputValue()) === '현장체험');
  const searched = await page
    .getByText(/총 \d+건|결과가 없습니다|찾지 못했습니다|검색 결과/)
    .first()
    .waitFor({ timeout: 20000 })
    .then(() => true)
    .catch(() => false);
  check('열자마자 찾았다', searched);
  await page.screenshot({ path: 'tools/report/palette-search.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 검색 단추로 다시 열면 비어 있다 (넘겨받은 글이 남지 않는다)
  await page.getByTitle(/^통합 검색/).first().click();
  await searchBox.waitFor({ timeout: 10000 });
  check('검색 단추로 열면 빈 칸', (await searchBox.inputValue()) === '');
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 7. ⋮ 메뉴, ESC, 글 칸 안에서 단축키 ──
  await page.getByTitle('더보기 메뉴').click();
  await page.getByText('명령 창 (기능·날짜·검색)').first().click();
  check('⋮ 메뉴에서 열린다', await box().isVisible().catch(() => false));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  check('ESC로 닫힌다', (await palette().count()) === 0);

  await page.getByTitle(/^통합 검색/).first().click();
  await searchBox.waitFor({ timeout: 10000 });
  await searchBox.click();
  await page.keyboard.press('Control+k');
  check('글 칸에 커서가 있어도 단축키가 듣는다', await box().isVisible({ timeout: 5000 }).catch(() => false));
  await page.keyboard.press('Escape');

  if (logs.length) {
    console.log('\n── 콘솔 ──');
    logs.slice(0, 10).forEach((l) => console.log('  ' + l));
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
};
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
