// tools/inspect-subject-attendance-summary.mjs
//
// 18번 교과 전담 S7 '교과 출결 누계 + 학급 탭 정리' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3 5-2에 교과 출결을 서버에 직접 심는다 (2학기 11-02·11-04, 1학기 06-10)
//   - 학급 탭: '5학년' 줄에 5-1~5-4 반 색 칩, '교과 출결' 도구, 출석부 도구 없음
//   - 누계 창: 2학기 1번 결과 1·지각 1 / 2번 지각 1, 1학기 1번 조퇴 1, 학년도 1번 합계 3, 이름을 누르면 날짜·교시 내역, CSV 내려받기
//   - 학생 기록(누가기록)(5-2 1번)에 '교과 출결' 줄, 교과 출결 칸의 '📊 누계'로 그 반 누계가 열린다
//   - 회귀: teacher(초등 담임) ⋮ 메뉴에 '교과 출결 누계'가 없다
//   심은 문서는 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-subject-attendance-summary.mjs
import { readFileSync } from 'node:fs';
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, deleteDoc, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-subject-att-summary');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const ref = (date) => doc(db, 'users', user.uid, 'v4_subjectAttendance', `2026_5_2_${date}`);
const META = { classKey: '2026_5_2', year: 2026, grade: '5', classNum: '2' };
const rec = (num, kind, extra = {}) => ({ num, name: `나${num}`, kind, reason: 'sick', ...extra });
const SEED = {
  '2026-11-02': { 3: { 1: rec(1, 'absent', { note: '보건실' }), 2: rec(2, 'late') } },
  '2026-11-04': { 1: { 1: rec(1, 'late') } },
  '2026-06-10': { 2: { 1: rec(1, 'early') } },
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
async function cleanup() {
  for (const d of Object.keys(SEED)) await deleteDoc(ref(d));
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

async function openApp(as = '?as=3') {
  await page.goto(`${V4}${as}`, { waitUntil: 'domcontentloaded' });
  const day = page.getByRole('button', { name: '하루', exact: true }).first();
  await day.waitFor({ timeout: 40000 });
  await day.click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1000);
}
const rowText = async (modal, n) => (await modal.locator(`[data-summary-row="${n}"]`).innerText()).replace(/\s+/g, ' ');

try {
  await cleanup();
  for (const [date, periods] of Object.entries(SEED)) {
    await setDoc(ref(date), { ...META, date, periods, updatedAt: Date.now() });
  }
  await openApp();

  // ── 학급 탭 ─────────────────────────────────────────────────
  await page.getByRole('button', { name: '학급', exact: true }).first().click();
  await page.locator('[data-class-screen]').waitFor({ timeout: 10000 });
  const row5 = page.locator('[data-class-grade="5"]');
  await row5.waitFor({ timeout: 10000 });
  const chips = await row5.locator('[data-class-chip]').allInnerTexts();
  check("학급 탭 '5학년' 줄에 5-1~5-4 반 칩", chips.join(',') === '5-1,5-2,5-3,5-4', chips.join(','));
  const chipClass = await row5.locator('[data-class-chip="5-2"]').getAttribute('class');
  check('반 칩에 반 색', /bg-\w+-100/.test(chipClass || ''), chipClass);
  await row5.locator('[data-class-chip="5-2"]').click();
  check('5-2 칩을 누르면 골라진다', (await row5.locator('[data-class-chip="5-2"]').getAttribute('aria-pressed')) === 'true');
  check("도구에 '교과 출결'이 있고 출석부는 없다",
    (await page.locator('[data-class-tool="subjectAttendance"]').count()) === 1 && (await page.locator('[data-class-tool="attendance"]').count()) === 0);

  // ── 누계 창 ─────────────────────────────────────────────────
  await page.locator('[data-class-tool="subjectAttendance"]').click();
  const modal = page.locator('[data-subject-att-summary-modal]');
  await modal.waitFor({ timeout: 10000 });
  check('누계 창이 고른 반(5-2)으로 열린다', (await modal.locator('[data-summary-class="5-2"]').getAttribute('aria-pressed')) === 'true');
  await modal.locator('[data-summary-range="sem2"]').click();
  await modal.locator('[data-summary-row="1"]').waitFor({ timeout: 10000 });
  const r1 = await rowText(modal, 1);
  const r2 = await rowText(modal, 2);
  check('2학기: 1번 결과 1·지각 1·조퇴 0·합계 2', /나1 1 1 0 2$/.test(r1), r1);
  check('2학기: 2번 지각 1', /나2 0 1 0 1$/.test(r2), r2);
  await modal.locator('[data-summary-range="sem1"]').click();
  await page.waitForTimeout(300);
  check('1학기: 1번 조퇴 1', /나1 0 0 1 1$/.test(await rowText(modal, 1)), await rowText(modal, 1));
  await modal.locator('[data-summary-range="year"]').click();
  await page.waitForTimeout(300);
  check('학년도 전체: 1번 합계 3', /나1 1 1 1 3$/.test(await rowText(modal, 1)), await rowText(modal, 1));
  await modal.locator('[data-summary-row="1"] button').first().click();
  const items = (await modal.locator('[data-summary-row="1"] [data-summary-items]').innerText()).split('\n');
  check("이름을 누르면 내역 '11/2(월) 3교시 결과(질병) - 보건실'", items.some((l) => /11\/2\(월\) 3교시 결과\(질병\) - 보건실/.test(l)), items.join(' / '));

  const [download] = await Promise.all([page.waitForEvent('download'), modal.locator('[data-summary-csv]').click()]);
  const csv = readFileSync(await download.path(), 'utf-8').replace(/^﻿/, '');
  const lines = csv.split(/\r?\n/);
  // 클라우드 컨테이너의 Chromium은 blob 내려받기 이름을 'download'로 준다 (inspect-eval-overview도 같다) - 그때는 이름을 보지 않는다
  const fname = download.suggestedFilename();
  check('CSV: 이름·머리줄·1번 줄 (BOM 붙은 UTF-8)', (fname === '교과출결_2026학년도_5-2_학년도전체.csv' || fname === 'download') &&
    /번호,이름,결과,지각,조퇴,합계/.test(lines[0].replace(/"/g, '')) && lines.some((l) => l.replace(/"/g, '') === '1,나1,1,1,1,3'),
    `${download.suggestedFilename()} / ${lines.slice(0, 2).join(' | ')}`);
  await page.screenshot({ path: 'tools/report/subject-att-summary.png' }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 학생 기록(누가기록) ────────────────────────────────────────────
  await page.locator('[data-class-student="1"]').click();
  const tl = page.locator('[data-timeline-kind="subjectAttendance"]').first();
  await tl.waitFor({ timeout: 10000 }).catch(() => {});
  const tlCount = await page.locator('[data-timeline-kind="subjectAttendance"]').count();
  const tlText = tlCount ? (await tl.locator('xpath=ancestor::button[1]').innerText()).replace(/\s+/g, ' ') : '';
  check("누가기록(5-2 1번)에 '교과 출결' 줄 3개", tlCount === 3 && /교과 출결/.test(tlText), `${tlCount}개 · ${tlText}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // ── 교과 출결 칸의 '📊 누계' ─────────────────────────────────
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) await page.getByTitle(/달력에서 날짜 선택/).first().click();
  await direct.fill('2026-11-02');
  await page.mouse.move(5, 600);
  const card3 = page.locator('[data-focus-key="period:2026-11-02:3"]').first();
  await card3.locator('[data-subject-attendance]').waitFor({ timeout: 10000 });
  check("11-02 3교시(5-2) 카드 '결과 1 · 지각 1'", (await card3.locator('[data-subject-att-summary]').innerText()) === '결과 1 · 지각 1');
  await card3.locator('[data-subject-attendance]').click();
  await page.locator('[data-subject-att-open-summary]').click();
  await modal.waitFor({ timeout: 10000 });
  check("교과 출결 칸 '📊 누계' → 5-2 누계", (await modal.locator('[data-summary-class="5-2"]').getAttribute('aria-pressed')) === 'true');
  await page.keyboard.press('Escape');

  // ── 회귀: 초등 담임 ──────────────────────────────────────────
  await openApp('');
  await page.getByTitle('더보기 메뉴').click();
  await page.locator('[data-menu-section]').first().waitFor({ timeout: 5000 });
  const labels = (await page.locator('[data-menu-section] button').allInnerTexts()).join('|');
  check("초등 담임(teacher) ⋮ 메뉴에 '교과 출결 누계'가 없다", !labels.includes('교과 출결'));
  await page.keyboard.press('Escape');

  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
  await page.screenshot({ path: 'tools/report/subject-att-summary-fail.png' }).catch(() => {});
} finally {
  await cleanup();
  await browser.close();
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
