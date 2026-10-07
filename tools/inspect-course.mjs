// tools/inspect-course.mjs
//
// 18번 교과 전담 S4 '과정 - 차시 목록 하나를 여러 반에' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3: 진도 관리 창 '+ 새 진도'(과목 + 반) → 과목 '과학', 5-1~5-4, 2026-11-02 시작, 차시 6개 붙여 넣기 → 저장
//     (서버 subject·classes·key), 반 탭 미리보기, 목록 '5학년 과학 · 5-1, 5-2, 5-3, 5-4'
//   - 하루 11-02 1교시(5-1)·3교시(5-2) 모두 1/6차시, 11-04 1교시(5-2)·2교시(5-1) 2/6차시
//   - 5-2의 11-02 3교시를 밀면 5-2만 밀리고 5-1은 그대로, 진도 줄을 누르면 창이 5-2 탭으로 열린다, 되돌리기
//   - 반 하나(5-4)를 빼면 그 반 수업 칸에서 진도가 사라진다
//   - 지우기 → 휴지통 → 복원 → 다시 지워 정리
//   - 회귀: teacher(초등 담임) 진도 관리 창에는 '과정' 단추가 없다 (옛 진도는 inspect-progress.mjs 39항목)
//   점검이 만든 진도·휴지통 문서는 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-course.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  deleteDoc,
  getDocFromServer,
  getDocsFromServer,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-course');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const uid = user.uid;
const progressCol = collection(db, 'users', uid, 'v4_progress');
const MARK = '점검 과정';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

async function serverUntil(read, ok, timeout = 8000) {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await read();
  }
  return [v, Date.now() - t0];
}

const coursePlans = async () =>
  (await getDocsFromServer(progressCol)).docs.filter((d) => String(d.data().lessons?.[0]?.content || '').startsWith(MARK));

async function cleanup() {
  for (const d of await coursePlans()) await deleteDoc(d.ref);
  for (const d of (await getDocsFromServer(collection(db, 'users', uid, 'trash'))).docs) {
    const data = d.data();
    if (data.type === 'progress' && String(data.data?.lessons?.[0]?.content || '').startsWith(MARK)) await deleteDoc(d.ref);
  }
}

const TABLE = [
  ['단원', '차시', '학습 내용', '준비물'],
  ['1. 물질의 상태', '1', `${MARK} 1`, '비커'],
  ['', '2', `${MARK} 2`, ''],
  ['', '3', `${MARK} 3`, ''],
  ['', '4', `${MARK} 4`, ''],
  ['', '5', `${MARK} 5`, ''],
  ['', '6', `${MARK} 6`, ''],
]
  .map((r) => r.join('\t'))
  .join('\r\n');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
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
  await page.waitForTimeout(1500);
}
async function openProgress() {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /진도 관리/ }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: '차시 목록' }).first();
  await dlg.waitFor({ timeout: 10000 });
  return dlg;
}
async function goDate(date) {
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await page.waitForTimeout(300);
  }
  await direct.fill(date);
  await page.mouse.move(5, 600);
  await page.locator(`[data-focus-key^="period:${date}:"]`).first().waitFor({ timeout: 15000 });
}
const card = (date, p) => page.locator(`[data-focus-key="period:${date}:${p}"]`).first();
const markText = async (date, p) => {
  const m = card(date, p).locator('[data-progress-mark]');
  await m.first().waitFor({ timeout: 8000 }).catch(() => {});
  return (await m.count()) ? (await m.first().innerText()).replace(/\s+/g, ' ') : '';
};
const previewSlots = (dlg) =>
  dlg.locator('[data-progress-preview] li[data-slot]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot')));

try {
  await cleanup();
  await openApp();

  // ── 과정 만들기 ──────────────────────────────────────────────
  let dlg = await openProgress();
  const newCourse = dlg.locator('[data-new-course]');
  check("교과 전담의 진도 관리 창의 새 진도 단추(과목 + 반)", (await newCourse.count()) === 1);
  await newCourse.click();
  await dlg.locator('[data-course-form]').waitFor({ timeout: 5000 });
  await dlg.locator('[data-course-subject="과학"]').click();
  await dlg.locator('[data-course-class-toggle="5-1"]').waitFor({ timeout: 10000 });
  for (const c of ['5-1', '5-2', '5-3', '5-4']) await dlg.locator(`[data-course-class-toggle="${c}"]`).click();
  await dlg.getByLabel('시작일').fill('2026-11-02');
  await dlg.locator('[data-progress-paste]').evaluate((el, text) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', text);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, TABLE);
  await dlg.locator('[data-progress-preview] li[data-slot]').first().waitFor({ timeout: 10000 });

  await dlg.locator('[data-course-preview="5-2"]').click();
  await page.waitForTimeout(300);
  const s52 = await previewSlots(dlg);
  check('미리보기 5-2 탭: 11-02 3교시, 11-04 1교시, 11-06 2교시 …', s52.slice(0, 3).join(',') === '2026-11-02#3,2026-11-04#1,2026-11-06#2', s52.slice(0, 4).join(','));
  await dlg.locator('[data-course-preview="5-1"]').click();
  await page.waitForTimeout(300);
  const s51 = await previewSlots(dlg);
  check('미리보기 5-1 탭: 11-02 1교시, 11-04 2교시, 11-06 1교시 …', s51.slice(0, 3).join(',') === '2026-11-02#1,2026-11-04#2,2026-11-06#1', s51.slice(0, 4).join(','));

  await dlg.getByRole('button', { name: '💾 저장' }).click();
  await page.getByText("'5학년 과학' 진도를 저장했습니다").first().waitFor({ timeout: 10000 });
  const [plans] = await serverUntil(coursePlans, (v) => v.length === 1);
  const saved = plans[0]?.data();
  check(
    '서버: subject 과학, classes 5-1~5-4, key 5-1 과학, 6차시',
    saved?.subject === '과학' && (saved?.classes || []).join(',') === '5-1,5-2,5-3,5-4' && saved?.key === '5-1 과학' && saved?.lessons?.length === 6,
    JSON.stringify({ subject: saved?.subject, classes: saved?.classes, key: saved?.key })
  );
  const planRef = plans[0].ref;
  const listText = (await dlg.locator(`[data-progress-plan="${planRef.id}"]`).innerText()).replace(/\s+/g, ' ');
  check("목록에 '5학년 과학 · 5-1, 5-2, 5-3, 5-4'", /5학년 과학 · 5-1, 5-2, 5-3, 5-4/.test(listText), listText);
  await page.screenshot({ path: 'tools/report/course-modal.png' }).catch(() => {});
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── 수업 칸: 반마다 따로 센다 ────────────────────────────────
  await goDate('2026-11-02');
  const a1 = await markText('2026-11-02', 1);
  const a3 = await markText('2026-11-02', 3);
  check('11-02 1교시(5-1)·3교시(5-2) 모두 1/6차시', /1\/6차시/.test(a1) && /1\/6차시/.test(a3), `${a1} | ${a3}`);
  await goDate('2026-11-04');
  const b1 = await markText('2026-11-04', 1);
  const b2 = await markText('2026-11-04', 2);
  check('11-04 1교시(5-2)·2교시(5-1) 모두 2/6차시', /2\/6차시/.test(b1) && /2\/6차시/.test(b2), `${b1} | ${b2}`);

  // ── 한 반만 밀기 ─────────────────────────────────────────────
  await goDate('2026-11-02');
  await card('2026-11-02', 3).hover();
  await card('2026-11-02', 3).getByRole('button', { name: '이 교시 밀기' }).click();
  const [bumped] = await serverUntil(
    async () => ((await getDocFromServer(planRef)).data().bumps || []).join(','),
    (v) => v === '2026-11-02#3'
  );
  check('5-2의 11-02 3교시 밀기 → 서버 bumps 한 칸', bumped === '2026-11-02#3', bumped);
  await goDate('2026-11-04');
  await page.waitForTimeout(800);
  const c1 = await markText('2026-11-04', 1);
  const c2 = await markText('2026-11-04', 2);
  check('5-2만 밀린다: 11-04 1교시(5-2) 1/6, 2교시(5-1)는 그대로 2/6', /1\/6차시/.test(c1) && /2\/6차시/.test(c2), `${c1} | ${c2}`);

  // 진도 줄을 누르면 창이 그 반 탭으로
  await card('2026-11-04', 1).locator('[data-progress-mark] button').first().click();
  dlg = page.getByRole('dialog').filter({ hasText: '차시 목록' }).first();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator('[data-course-preview="5-2"]').waitFor({ timeout: 10000 });
  check('진도 줄을 누르면 창이 5-2 탭으로 열린다', (await dlg.locator('[data-course-preview="5-2"]').getAttribute('aria-selected')) === 'true');
  const row = dlg.locator('[data-progress-preview] li[data-slot="2026-11-02#3"]');
  await row.getByRole('button', { name: '되돌리기' }).click();
  const [undone] = await serverUntil(async () => (await getDocFromServer(planRef)).data().bumps || [], (v) => v.length === 0);
  check('창에서 되돌리기 → bumps가 빈다', undone.length === 0);

  // ── 반 빼기 ─────────────────────────────────────────────────
  await dlg.locator('[data-course-class-toggle="5-4"]').click();
  await dlg.getByRole('button', { name: '💾 저장' }).click();
  const [less] = await serverUntil(async () => (await getDocFromServer(planRef)).data().classes || [], (v) => v.join(',') === '5-1,5-2,5-3');
  check('5-4를 빼고 저장 → 서버 classes 5-1,5-2,5-3', less.join(',') === '5-1,5-2,5-3', less.join(','));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await goDate('2026-11-03'); // 화: 2교시 5-3, 4교시 5-4
  await page.waitForTimeout(800);
  const d2 = await markText('2026-11-03', 2);
  const d4 = await markText('2026-11-03', 4);
  check('뺀 반(5-4) 수업 칸에는 진도가 없고 5-3은 그대로', /1\/6차시/.test(d2) && d4 === '', `${d2} | ${d4 || '없음'}`);
  await page.screenshot({ path: 'tools/report/course-day.png' }).catch(() => {});

  // ── 지우기 → 휴지통 → 복원 ───────────────────────────────────
  dlg = await openProgress();
  await dlg.locator(`[data-progress-plan="${planRef.id}"]`).click().catch(() => {});
  await dlg.getByRole('button', { name: '🗑️ 지우기' }).click();
  await page.getByText("'5학년 과학' 진도를 지웠습니다").first().waitFor({ timeout: 10000 });
  check('지우면 v4_progress에서 빠진다', !(await getDocFromServer(planRef)).exists());
  await page.keyboard.press('Escape');
  await page.getByTitle(/^휴지통/).first().click();
  const trashRow = page.locator('div.bg-white.border.rounded-xl').filter({ hasText: '5학년 과학 진도' }).first();
  await trashRow.waitFor({ timeout: 10000 });
  await trashRow.getByRole('button', { name: '복원' }).click();
  await page.getByText('복원되었습니다').first().waitFor({ timeout: 10000 });
  const [back] = await serverUntil(coursePlans, (v) => v.length === 1);
  const bd = back[0]?.data();
  check('복원하면 과목·반째 돌아온다', bd?.subject === '과학' && (bd?.classes || []).join(',') === '5-1,5-2,5-3', JSON.stringify(bd?.classes));
  await page.keyboard.press('Escape');

  // ── 회귀: 초등 담임 ──────────────────────────────────────────
  await openApp('');
  dlg = await openProgress();
  check("초등 담임(teacher) 진도 관리 창의 새 진도는 과목 하나 (과정 단추 없음)", (await dlg.locator('[data-new-course]').count()) === 0);
  await page.keyboard.press('Escape');

  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
  await page.screenshot({ path: 'tools/report/course-fail.png' }).catch(() => {});
} finally {
  await cleanup();
  await browser.close();
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
