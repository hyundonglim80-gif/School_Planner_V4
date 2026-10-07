// tools/inspect-help-tree.mjs
//
// 2026-10-02 설명서 점검에서 고친 것을 실제 크롬으로 눌러 본다.
//   - 사용 설명서 왼쪽 목차(트리): 오른쪽 칸(PC 1400px)에서 옆에 서고, 분류 펴기 → 기능 누르기 → 내용·짚기,
//     목차만 따로 스크롤(본문 높이), 가로 넘침 없음, 📚 목차로 접기 → 새로고침 뒤에도 접힘 → 다시 펴기
//   - 가운데 팝업 모양에서도 목차가 옆에 선다
//   - 휴대폰(390px): 목차는 처음에 접혀 있고 📚 목차로 위에 펼친다, 고르면 접힌다, 넘침 없음
//   - 월간 31일에 ▶ → 다음 달 (예전엔 한 달을 건너뜀)
//   - 통합 검색 기간: 처음 값 '전체 기간'(날짜 제한 없음), '학년도 전체'는 날짜가 보인다
//   - ⋮ → 반복 일정 등록: 만들면 창이 닫힌다 (만든 일정은 끝에 지운다)
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-help-tree.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

/** 머리줄의 📅 달력 '직접 선택'으로 그 날짜로 (19번 U4에서 명령 창을 지운 뒤) */
async function pickDate(page, date) {
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await page.waitForTimeout(300);
  }
  await direct.fill(date);
  await page.mouse.move(5, 600);
  await page.waitForTimeout(800);
}


const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;
const OUT = process.env.OUT || 'tools/report';

// 반복 일정 점검이 만든 일정을 지우려고 서버에 붙는다 (2031년 3월 - seed가 쓰지 않는 날)
const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'help-tree');
const db = getFirestore(fbApp);
const fbAuth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(fbAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(fbAuth, 'teacher@example.com', 'test1234');
const RECUR_DATES = ['2031-03-03', '2031-03-10'];
const recurRef = (d) => doc(db, 'users', user.uid, 'events', d);
for (const d of RECUR_DATES) {
  if ((await getDocFromServer(recurRef(d))).exists()) {
    console.error(`${d} 일정 문서가 이미 있다 - 지우면 안 되니 멈춘다`);
    process.exit(1);
  }
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const logs = [];

async function openApp(viewport) {
  const ctx = await browser.newContext({ viewport });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  return { ctx, page };
}
const openHelp = async (page) => {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /사용 설명서/ }).first().click();
  await page.getByRole('region', { name: '설명서 내용' }).waitFor({ timeout: 10000 });
  await page.waitForTimeout(400);
};
/** 환경설정 > 팝업 모양. 계정에 저장되므로(1초 뒤에 올린다) 넉넉히 기다린다 */
const setPopupStyle = async (page, label) => {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  await page.getByRole('button', { name: label, exact: true }).click();
  await page.waitForTimeout(2500);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
};
const helpDialog = (page) => page.getByRole('dialog').filter({ has: page.getByRole('region', { name: '설명서 내용' }) });
const tree = (page) => page.getByRole('navigation', { name: '설명서 목차' });
const content = (page) => page.getByRole('region', { name: '설명서 내용' });

// ── PC 1400px, 오른쪽 칸 ──
{
  const { ctx, page } = await openApp({ width: 1400, height: 900 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await openHelp(page);
  // 앞선 점검이 팝업 모양을 가운데로 남겼으면 오른쪽 칸으로 되돌리고 다시 연다
  if ((await content(page).evaluate((el) => el.closest('[data-popup-frame]')?.getAttribute('data-popup-frame'))) !== 'side') {
    await page.keyboard.press('Escape');
    await setPopupStyle(page, '오른쪽 칸');
    await openHelp(page);
  }
  check('[목차] 팝업 모양이 오른쪽 칸', (await content(page).evaluate((el) => el.closest('[data-popup-frame]')?.getAttribute('data-popup-frame'))) === 'side');
  const dlg = helpDialog(page);
  const navBox = await tree(page).boundingBox();
  const contentBox = await content(page).boundingBox();
  check('[목차] 오른쪽 칸에서 목차가 내용 왼쪽에 선다', !!navBox && !!contentBox && navBox.x + navBox.width <= contentBox.x + 1,
    navBox && contentBox ? `목차 ${Math.round(navBox.width)}px · 내용 ${Math.round(contentBox.width)}px` : '');
  check('[목차] 처음에는 처음 화면이 짚이고 분류는 접혀 있다',
    (await tree(page).locator('[aria-current="page"]').innerText()).includes('처음 화면') &&
      (await tree(page).locator('[data-help-tree-topic]').count()) === 0);
  await page.screenshot({ path: `${OUT}/help-tree-pc-1-home.png` });

  await tree(page).getByRole('button', { name: '첨부 · 캡처 · 링크 펴기' }).click();
  await tree(page).locator('[data-help-tree-topic="paste-image"]').click();
  await page.waitForTimeout(300);
  const h = await content(page).getByRole('heading', { level: 3 }).first().innerText();
  check('[목차] 기능을 누르면 내용이 그 기능', /캡처 이미지 붙여넣기/.test(h), h);
  check('[목차] 지금 기능이 짚인다', (await tree(page).locator('[aria-current="page"]').getAttribute('data-help-tree-topic')) === 'paste-image');

  // 내용 칸의 연결로 다른 분류에 가면 목차도 따라간다
  await tree(page).locator('[data-help-tree-category="events"]').click();
  await content(page).locator('[data-help-topic="event-attrs"]').click();
  await content(page).getByRole('button', { name: '시간표 적용', exact: true }).first().click();
  await page.waitForTimeout(300);
  check('[목차] 설명 안의 연결로 가도 목차가 그 분류를 펴서 짚는다',
    (await tree(page).locator('[aria-current="page"]').getAttribute('data-help-tree-topic')) === 'timetable');

  // 모두 펴면 목차만 따로 스크롤된다 (본문 높이까지)
  await tree(page).getByRole('button', { name: '모두 펴기' }).click();
  await page.waitForTimeout(300);
  const scroll = await tree(page).evaluate((el) => ({ sh: el.scrollHeight, ch: el.clientHeight, body: el.parentElement.parentElement.clientHeight }));
  check('[목차] 모두 펴면 목차가 본문 높이 안에서 따로 스크롤', scroll.sh > scroll.ch && scroll.ch <= scroll.body + 1, JSON.stringify(scroll));
  const over = await dlg.locator('[data-scroll-lock]').evaluate((el) => el.scrollWidth - el.clientWidth);
  check('[목차] 설명서 칸이 가로로 넘치지 않는다', over <= 1, `${over}px`);
  await page.screenshot({ path: `${OUT}/help-tree-pc-2-expanded.png` });

  // 📚 목차로 접고, 새로고침 뒤에도 접힌 채
  await page.getByRole('button', { name: '📚 목차' }).click();
  check('[목차] 📚 목차로 접는다', (await tree(page).count()) === 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await openHelp(page);
  check('[목차] 접은 것을 기억한다 (새로고침 뒤)', (await tree(page).count()) === 0);
  await page.getByRole('button', { name: '📚 목차' }).click();
  check('[목차] 다시 펴진다', await tree(page).isVisible());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── 월간 31일 ▶ ──
  await pickDate(page, '2026-10-31');
  await page.getByRole('button', { name: '월간', exact: true }).first().click();
  await page.waitForTimeout(800);
  const headerDate = () => page.locator('span[title^="오늘 날짜로 돌아가기"]').first().innerText();
  const before = await headerDate();
  await page.getByTitle(/^다음 날짜/).click();
  await page.waitForTimeout(800);
  const after = await headerDate();
  await page.getByTitle(/^다음 날짜/).click();
  await page.waitForTimeout(800);
  const after2 = await headerDate();
  check('[월간] 31일에 ▶ → 다음 달 (달을 건너뛰지 않는다)', before === '2026년 10월' && after === '2026년 11월' && after2 === '2026년 12월',
    `${before} → ${after} → ${after2}`);
  await page.getByRole('button', { name: '하루', exact: true }).first().click();

  // ── 통합 검색 기간 ──
  await page.locator('span[title^="오늘 날짜로 돌아가기"]').first().click();
  await page.waitForTimeout(300);
  await page.getByTitle(/^통합 검색/).click();
  const scope = page.getByRole('dialog').locator('select').first();
  await scope.waitFor();
  const first = await scope.inputValue();
  const noLimit = await page.getByText('날짜 제한 없음').isVisible();
  await scope.selectOption('year');
  const y0 = await page.getByLabel('시작일').inputValue();
  const y1 = await page.getByLabel('종료일').inputValue();
  check('[검색] 처음 값은 전체 기간(날짜 제한 없음), 학년도 전체는 그 학년도 날짜',
    first === 'all' && noLimit && /^\d{4}-03-01$/.test(y0) && /^\d{4}-02-2[89]$/.test(y1), `${first} · ${y0}~${y1}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ── 반복 일정 등록: 만들면 닫힌다 ──
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /반복 일정 등록/ }).click();
  const rdlg = page.getByRole('dialog').filter({ hasText: '반복 일정 생성' });
  await rdlg.waitFor();
  await rdlg.getByPlaceholder(/학년 협의회/).fill('점검용 반복 일정');
  const dates = rdlg.locator('input[type=date]');
  await dates.nth(0).fill('2031-03-03');
  await dates.nth(1).fill('2031-03-16');
  await rdlg.getByRole('button', { name: /반복 일정 생성 \(/ }).click();
  await page.waitForTimeout(2500);
  const made = [];
  for (const d of RECUR_DATES) made.push((await getDocFromServer(recurRef(d))).exists());
  check('[반복 일정] 만들고 나면 창이 닫힌다 (월요일 두 번 생김)', (await rdlg.count()) === 0 && made.every(Boolean), made.join(','));
  // 만든 것 지우기 (처음에 없던 문서라 문서째)
  for (const d of RECUR_DATES) await deleteDoc(recurRef(d));
  await ctx.close();
}

// ── 가운데 팝업 모양 (환경설정에서 바꾸고 끝에 되돌린다 - 계정에 저장되는 설정) ──
{
  const { ctx, page } = await openApp({ width: 1400, height: 900 });
  await setPopupStyle(page, '가운데 팝업 (예전 방식)');
  await openHelp(page);
  const frame = await content(page).evaluate((el) => el.closest('[data-popup-frame]')?.getAttribute('data-popup-frame'));
  const navBox = await tree(page).boundingBox();
  const contentBox = await content(page).boundingBox();
  check('[목차] 가운데 팝업에서도 목차가 옆에 선다', frame === 'center' && !!navBox && navBox.x + navBox.width <= contentBox.x + 1,
    `${frame} · 목차 ${Math.round(navBox?.width || 0)}px · 내용 ${Math.round(contentBox.width)}px`);
  await page.screenshot({ path: `${OUT}/help-tree-center.png` });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  await setPopupStyle(page, '오른쪽 칸');
  await ctx.close();
}

// ── 휴대폰 390px ──
{
  const { ctx, page } = await openApp({ width: 390, height: 844 });
  await openHelp(page);
  check('[휴대폰] 목차는 처음에 접혀 있다', (await tree(page).count()) === 0);
  await page.getByRole('button', { name: '📚 목차' }).click();
  await page.waitForTimeout(300);
  check('[휴대폰] 📚 목차를 누르면 내용 위에 펼친다', await tree(page).isVisible());
  await page.screenshot({ path: `${OUT}/help-tree-mobile-1-open.png` });
  await tree(page).getByRole('button', { name: '일정 펴기' }).click();
  await tree(page).locator('[data-help-tree-topic="event-add"]').click();
  await page.waitForTimeout(400);
  const h = await content(page).getByRole('heading', { level: 3 }).first().innerText();
  check('[휴대폰] 기능을 고르면 목차가 접히고 그 기능이 열린다', (await tree(page).count()) === 0 && /일정 추가하기/.test(h), h);
  const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  check('[휴대폰] 가로로 넘치지 않는다', over <= 1, `${over}px`);
  await page.screenshot({ path: `${OUT}/help-tree-mobile-2-topic.png` });
  await ctx.close();
}

check('점검 동안 페이지 오류가 없다', logs.length === 0, logs.slice(0, 3).join(' | '));
await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - fails.length}/${results.length} 통과`);
process.exit(fails.length ? 1 : 0);
