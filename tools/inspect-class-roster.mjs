// tools/inspect-class-roster.mjs
//
// 명렬표를 학급 화면 안으로 (2026-10-07 사용자 요청) - 실제 크롬으로 본다 (PC 1400px, teacher).
//   - ⋮ 메뉴에 명렬표 항목이 없다
//   - 학급 화면 맨 위 '🏫 학급 도구 | 🧑‍🤝‍🧑 명렬표' 전환 → 명렬표가 창이 아니라 화면 안의 판, 관리·검색·암기 탭
//   - 학급 화면에서 고른 학급으로 명렬표가 열린다
//   - 검색 탭을 보다 하루 화면에 갔다 와도 명렬표·검색 그대로 / '학급 도구'로 돌아가기 / 도구 칸 '명렬표'도 연다
// 저장하지 않으므로 바뀌는 자료가 없다 (이 브라우저의 고른 학급 기억만 바뀐다).
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
const scope = (name) => page.locator('header').getByRole('button', { name, exact: true }).first().click();
try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });

  await page.getByTitle('더보기 메뉴').click();
  await page.waitForTimeout(300);
  const menuText = await page.locator('body').innerText();
  check('⋮ 메뉴에 명렬표 항목이 없다', !/학급 정보\(명렬표\)|명렬표 관리/.test(menuText) && /자리표/.test(menuText));
  await page.keyboard.press('Escape');

  await scope('학급');
  const hub = page.locator('[data-class-screen]');
  await hub.waitFor();
  const sw = page.locator('[data-class-mode-switch]');
  check('학급 화면 맨 위에 학급 도구 | 명렬표 전환', (await sw.count()) === 1 && (await page.locator('[data-class-mode="hub"]').getAttribute('aria-selected')) === 'true');

  // 둘째 학급을 고른다
  const select = page.getByLabel('학급 고르기');
  const values = await select.locator('option').evaluateAll((os) => os.map((o) => o.value));
  const pick = values[1] || values[0];
  await select.selectOption(pick);
  const [, grade, classNum] = pick.split('_');

  await page.locator('[data-class-mode="roster"]').click();
  const roster = page.locator('[data-roster-embedded]');
  await roster.waitFor();
  check('명렬표가 창이 아니라 학급 화면 안의 판', (await page.locator('[role=dialog]').count()) === 0 && (await hub.count()) === 0);
  const tabsOk = await Promise.all(['관리', '검색', '암기'].map((t) => roster.getByRole('button', { name: t, exact: true }).count()));
  check('관리 · 검색 · 암기 탭', tabsOk.every((n) => n === 1));
  const sel = await roster.locator('select').evaluateAll((ss) => ss.map((s) => s.value));
  check(`학급 화면에서 고른 학급(${grade}-${classNum})으로 열린다`, sel.includes(grade) && sel.includes(classNum), sel.join(','));
  check('판에는 닫기 단추가 없다 (위의 학급 도구로 돌아간다)', (await roster.getByRole('button', { name: '닫기', exact: true }).count()) === 0);

  await roster.getByRole('button', { name: '검색', exact: true }).click();
  await page.waitForTimeout(300);
  await scope('하루');
  await page.getByRole('heading', { name: '일정' }).first().waitFor();
  await scope('학급');
  await roster.waitFor();
  check('하루 화면에 갔다 와도 명렬표 · 검색 탭 그대로', (await roster.getByPlaceholder(/ㄱㅈㅇ/).count()) === 1);

  await page.locator('[data-class-mode="hub"]').click();
  await hub.waitFor();
  check('학급 도구를 누르면 학급 도구로 돌아간다', (await roster.count()) === 0);
  await page.locator('[data-class-tool="roster"]').click();
  await roster.waitFor();
  check("도구 칸 '명렬표'도 화면 안의 명렬표를 연다", (await page.locator('[data-class-mode="roster"]').getAttribute('aria-selected')) === 'true');
  await page.locator('[data-class-mode="hub"]').click();
  await scope('하루');
  check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('점검 도중 오류', false, String(e).slice(0, 300));
} finally {
  await browser.close();
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length}`);
process.exit(pass === results.length ? 0 : 1);
