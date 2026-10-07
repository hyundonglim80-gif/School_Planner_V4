// tools/inspect-more-menu.mjs
//
// ⋮ 메뉴 구역 제목(docs/ROADMAP.md 6-3)을 실제 크롬으로 본다.
//   - 구역 다섯 개가 제목과 함께 차례로 있고, 항목이 제 구역에 들었다
//   - 명령 창은 없다 (19번 U4에서 지움)
//   - 항목마다 누르면 메뉴가 닫히고 그 창(출석부·알림장은 오른쪽 칸)이 열린다
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-more-menu.mjs
import { chromium } from 'playwright';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const SECTIONS = [
  // 구역 안 차례는 자주 쓰는 것이 위 (UX-AUDIT M3, 2026-10-07). 앱 설치·화면 밝기는 환경설정으로 옮겼다(M4)
  ['일정 · 라벨', ['라벨 관리', '여러 개 고르기', '반복 일정 등록', '지난 일정 오늘로 가져오기']],
  ['수업', ['진도 관리', '시간표', '주간학습안내']],
  ['학급 운영', ['출석부', '알림장 모아 보기', '발표자 뽑기', '학생 기록(누가기록)', '조사표 모아 보기', '자리표', '학급 정보(명렬표) 관리']],
  ['공유 · 연동 · 백업', ['구글 캘린더로 보내기', '공유 그룹 관리', '백업 (내보내기 / 가져오기)']],
  ['설정 · 도움말', ['환경설정', '사용 설명서']],
]

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

  const openMenu = async () => {
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').first().waitFor({ timeout: 5000 });
  };
  // 출석부·알림장은 오른쪽 쓰는 칸(aside)으로 열린다
  const opened = () => page.locator('[role=dialog], aside[aria-label^="출석부"], aside[aria-label^="알림장"]');
  const closeAll = async () => {
    for (let i = 0; i < 4 && (await opened().count()) > 0; i++) {
      await page.keyboard.press('Escape');
      await page.waitForTimeout(250);
    }
  };

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();

  // ── 1. 구역과 항목 ──
  await openMenu();
  const titles = await page.locator('[data-menu-section]').evaluateAll((els) => els.map((e) => e.getAttribute('data-menu-section')));
  check('구역 다섯 개가 차례로', JSON.stringify(titles) === JSON.stringify(SECTIONS.map(([t]) => t)), titles.join(' / '));
  for (const [title, items] of SECTIONS) {
    const group = page.getByRole('group', { name: title });
    check(`'${title}' 제목이 보인다`, await group.getByText(title, { exact: true }).isVisible());
    const texts = (await group.getByRole('button').allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
    const ok = items.every((it, i) => texts[i]?.includes(it)) && texts.length === items.length;
    check(`'${title}' 항목`, ok, texts.join(' | '));
  }
  check('⋮ 메뉴에 명령 창이 없다 (19번 U4)', (await page.getByRole('button', { name: /명령 창/ }).count()) === 0);
  await page.screenshot({ path: 'tools/report/more-menu.png' });

  // ── 2. 항목마다 누르면 메뉴가 닫히고 창이 열린다 ──
  await page.keyboard.press('Escape');
  await page.locator('body').click({ position: { x: 5, y: 300 } });
  // 다중 선택·앱 설치·어둡게 보기(화면 밝기만 바꾼다 - inspect-dark가 본다)는 창을 열지 않는다
  const opens = SECTIONS.flatMap(([, items]) => items).filter((t) => !/여러 개 고르기/.test(t));
  for (const name of opens) {
    await closeAll();
    await openMenu();
    await page.locator('[data-menu-section]').getByRole('button', { name }).click();
    await page.waitForTimeout(500);
    const menuGone = (await page.locator('[data-menu-section]').count()) === 0;
    const dialogs = await opened().count();
    check(`'${name}' → 창이 열린다`, menuGone && dialogs > 0, `dialog ${dialogs}`);
  }
  await closeAll();

  // 여러 개 고르기는 창 없이 모드만 - 메뉴 글이 '여러 개 고르기 끝'으로 바뀐다
  await openMenu();
  await page.locator('[data-menu-section]').getByRole('button', { name: /여러 개 고르기(?! 끝)/ }).click();
  await openMenu();
  const multi = page.locator('[data-menu-section]').getByRole('button', { name: /여러 개 고르기/ });
  check('여러 개 고르기 → 메뉴 글이 "여러 개 고르기 끝"으로', (await multi.innerText()).includes('끝'));
  await multi.click();

  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await browser.close();

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} 통과`);
  process.exit(failed.length ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
