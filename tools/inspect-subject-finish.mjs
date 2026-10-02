// tools/inspect-subject-finish.mjs
//
// 18번 교과 전담 S10 '마무리' - 명령 창의 새 항목과 휴대폰 폭(390px) 한 번 (CLAUDE.md 2장: 폭 점검은 이 세션에서만).
//   - teacher3 명령 창 '과정 만들기' → 진도 관리 창이 과정 칸(과목·반)으로, '교사 유형 바꾸기' → 환경설정이 교사 유형 구역으로
//   - 휴대폰 390px: 교과 모드 하루 카드(11-02)·교과 출결 칸이 가로로 넘치지 않는다, 반 도구 줄·출결 단추가 보인다
//   점검은 아무것도 저장하지 않는다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-subject-finish.mjs
import { chromium } from 'playwright';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];

async function openApp(page) {
  await page.goto(`${V4}?as=3`, { waitUntil: 'domcontentloaded' });
  const day = page.getByRole('button', { name: '하루', exact: true }).first();
  await day.waitFor({ timeout: 40000 });
  await day.click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1000);
}
async function palette(page, text) {
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  await page.keyboard.press('Control+k');
  const box = page.getByRole('combobox', { name: '명령 창' });
  await box.waitFor({ timeout: 10000 });
  await box.fill(text);
  await page.waitForTimeout(300);
  const first = (await page.locator('[role=option][aria-selected=true]').innerText()).replace(/\s+/g, ' ');
  await page.keyboard.press('Enter');
  return first;
}

try {
  // ── PC: 명령 창 ─────────────────────────────────────────────
  const pc = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
  pc.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await openApp(pc);
  const f1 = await palette(pc, '과정 만들기');
  const form = pc.locator('[data-course-form]');
  const okForm = await form.waitFor({ timeout: 10000 }).then(() => true, () => false);
  check("명령 창 '과정 만들기' → 진도 관리 창이 과정 칸으로", /과정 만들기/.test(f1) && okForm, f1);
  await pc.keyboard.press('Escape');
  await pc.waitForTimeout(400);
  const f2 = await palette(pc, '교사 유형');
  const sec = pc.locator('[data-teaching-mode-setting]');
  await sec.waitFor({ timeout: 10000 });
  await pc.waitForTimeout(600);
  const inView = await sec.evaluate((el) => {
    const r = el.getBoundingClientRect();
    return r.top < window.innerHeight && r.bottom > 0;
  });
  check("명령 창 '교사 유형 바꾸기' → 환경설정 교사 유형 구역이 보인다", /교사 유형 바꾸기/.test(f2) && inView, f2);
  await pc.keyboard.press('Escape');

  // ── 휴대폰 390px ────────────────────────────────────────────
  const m = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage();
  m.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await m.goto(`${V4}?as=3`, { waitUntil: 'domcontentloaded' });
  await m.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await m.waitForTimeout(1000);
  // 날짜 옮기기: 작은 달력의 직접 선택 (휴대폰도 같은 칸)
  const direct = m.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await m.getByTitle(/달력에서 날짜 선택/).first().click();
  await m.waitForTimeout(400);
  await direct.fill('2026-11-02');
  await m.waitForTimeout(400);
  await m.keyboard.press('Escape').catch(() => {});
  const card1 = m.locator('[data-focus-key="period:2026-11-02:1"]').first();
  await card1.waitFor({ timeout: 15000 });
  await card1.scrollIntoViewIfNeeded();
  const overflow = await m.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  const cardBox = await card1.boundingBox();
  check('390px: 하루 화면이 가로로 넘치지 않는다', overflow <= 1, `${overflow}px`);
  check('390px: 1교시 카드가 화면 안 (반 도구 줄·출결 단추 보임)',
    !!cardBox && cardBox.x >= 0 && cardBox.x + cardBox.width <= 391 &&
      (await card1.locator('[data-class-tools]').isVisible()) && (await card1.locator('[data-subject-attendance]').isVisible()),
    cardBox ? `x ${Math.round(cardBox.x)} w ${Math.round(cardBox.width)}` : '없음');
  await m.screenshot({ path: 'tools/report/subject-mobile-day.png' }).catch(() => {});
  await card1.locator('[data-subject-attendance]').click();
  const panel = m.locator('[data-subject-attendance-panel]').first();
  await panel.waitFor({ timeout: 10000 });
  await m.waitForTimeout(500);
  const pOver = await panel.evaluate((el) => el.scrollWidth - el.clientWidth);
  const pBox = await panel.boundingBox();
  check('390px: 교과 출결 칸이 화면 안, 가로로 넘치지 않는다', !!pBox && pBox.x >= -1 && pBox.x + pBox.width <= 391 && pOver <= 1,
    pBox ? `x ${Math.round(pBox.x)} w ${Math.round(pBox.width)} 넘침 ${pOver}px` : '없음');
  await m.screenshot({ path: 'tools/report/subject-mobile-attendance.png' }).catch(() => {});

  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
