// tools/inspect-course-overview.mjs
//
// 18번 교과 전담 S9 '과정별 평가 모아 보기' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3에 과정(5-1~5-4)과 조사표를 서버에 직접 심는다: '점검 평가A'(평가) 5-1·5-2·5-3 - 반마다 날짜가 다르다,
//     '점검 체크B'(체크) 5-1만, 수학 조사표(과정 과목이 아니다) 5-1
//   - 평가 모아 보기 '과정별' 탭: 줄 4개(5-1~5-4), 칸 2개(수학은 빠진다), 5-4 평가A '-', 5-1 '완료 0/5'
//   - 5-2 평가A에 점수 둘을 넣고 다시 열면 '완료 2/5', 칸을 누르면 그 조사표 창(5-2)
//   - 회귀: teacher(초등 담임)는 탭이 없다
//   심은 문서는 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-course-overview.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, deleteDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-course-overview');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const uid = user.uid;
const planRef = doc(db, 'users', uid, 'v4_progress', 'pg_inspect_overview');
const evalRef = (d) => doc(db, 'users', uid, 'evaluations', d);
const HEADS = { 1: '가', 2: '나', 3: '다', 4: '라' };
const ev = (id, title, date, period, classNum, extra = {}) => ({
  id,
  authorId: uid,
  title,
  subject: '과학',
  type: 'eval',
  methodObj: { indiv: true, group: false },
  steps: ['잘함', '보통', '노력요함'],
  groups: [],
  dateStr: date,
  periodStr: period,
  context: { source: 'schedule', period },
  rosterMeta: { year: 2026, grade: '5', classNum: String(classNum) },
  studentsSnapshot: [1, 2, 3, 4, 5].map((n) => ({ num: n, name: `${HEADS[classNum]}${n}`, gender: '' })),
  records: {},
  ...extra,
});
const SEED = {
  '2026-11-02': [ev('ov_a1', '점검 평가A', '2026-11-02', 1, 1), ev('ov_a2', '점검 평가A', '2026-11-02', 3, 2)],
  '2026-11-03': [ev('ov_a3', '점검 평가A', '2026-11-03', 2, 3)],
  '2026-11-06': [ev('ov_b1', '점검 체크B', '2026-11-06', 1, 1, { type: 'check', steps: [] }), ev('ov_m1', '점검 수학', '2026-11-06', 1, 1, { subject: '수학' })],
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const before = {};
async function setup() {
  for (const d of Object.keys(SEED)) before[d] = (await getDocFromServer(evalRef(d))).data() || null;
  for (const [d, list] of Object.entries(SEED)) await setDoc(evalRef(d), { list, evalList: list, updatedAt: Date.now() });
  const lessons = Array.from({ length: 6 }, (_, i) => ({ unit: '', no: String(i + 1), content: `점검 ${i + 1}`, supplies: '' }));
  await setDoc(planRef, { key: '5-1 과학', subject: '과학', classes: ['5-1', '5-2', '5-3', '5-4'], startDate: '2026-11-02', lessons, bumps: [], updatedAt: Date.now() });
}
async function cleanup() {
  await deleteDoc(planRef);
  for (const d of Object.keys(SEED)) {
    if (before[d]) await setDoc(evalRef(d), before[d]);
    else await deleteDoc(evalRef(d));
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
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
async function openOverview() {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /평가 모아 보기/ }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: '📊 평가 모아 보기' }).first();
  await dlg.waitFor({ timeout: 10000 });
  return dlg;
}
const cellText = async (dlg, cls, title) => (await dlg.locator(`[data-course-cell="${cls}|${title}"]`).innerText()).trim();

try {
  await setup();
  await openApp();
  let dlg = await openOverview();
  const tab = dlg.locator('[data-overview-course]');
  check("교과 모드 평가 모아 보기에 '과정별' 탭", (await tab.count()) === 1);
  await tab.click();
  const table = dlg.locator('[data-course-overview-table]');
  await table.waitFor({ timeout: 15000 });
  const rows = await table.locator('[data-course-overview-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-course-overview-row')));
  check('줄 4개 (5-1~5-4)', rows.join(',') === '5-1,5-2,5-3,5-4', rows.join(','));
  const heads = await table.locator('thead th').allInnerTexts();
  check("칸 2개 - 평가A·체크B (수학 조사표는 빠진다)", heads.length === 3 && /점검 평가A/.test(heads[1]) && /점검 체크B/.test(heads[2]), heads.map((h) => h.replace(/\s+/g, ' ')).join(' | '));
  const c41 = await cellText(dlg, '5-4', '점검 평가A');
  const c11 = await cellText(dlg, '5-1', '점검 평가A');
  const c2b = await cellText(dlg, '5-2', '점검 체크B');
  check("5-4 평가A '-', 5-1 '완료 0/5', 5-2 체크B '-'", c41 === '-' && c11 === '완료 0/5' && c2b === '-', `${c41} / ${c11} / ${c2b}`);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 5-2 평가A에 점수 둘 (서버에 직접 - 다른 기기에서 넣은 것처럼)
  const d2 = (await getDocFromServer(evalRef('2026-11-02'))).data();
  const list = d2.evalList.map((e) => (e.id === 'ov_a2' ? { ...e, records: { 1: { indivScore: '잘함' }, 4: { indivScore: '보통' } } } : e));
  await setDoc(evalRef('2026-11-02'), { list, evalList: list, updatedAt: Date.now() });

  dlg = await openOverview();
  await dlg.locator('[data-overview-course]').click();
  await dlg.locator('[data-course-overview-table]').waitFor({ timeout: 15000 });
  const c21 = await cellText(dlg, '5-2', '점검 평가A');
  check("다시 열면 5-2 평가A '완료 2/5'", c21 === '완료 2/5', c21);
  await page.screenshot({ path: 'tools/report/course-overview.png' }).catch(() => {});

  await dlg.locator('[data-course-cell="5-2|점검 평가A"]').click();
  const evDlg = page.getByRole('dialog').filter({ hasText: '점검 평가A' }).filter({ hasText: '5학년 2반' }).first();
  const opened = await evDlg.waitFor({ timeout: 10000 }).then(() => true, () => false);
  check('칸을 누르면 그 반(5-2) 조사표 창', opened);
  await page.keyboard.press('Escape');

  // ── 회귀: 초등 담임 ──────────────────────────────────────────
  await openApp('');
  dlg = await openOverview();
  check("초등 담임(teacher)은 '과정별' 탭이 없다", (await dlg.locator('[data-overview-course]').count()) === 0);
  await page.keyboard.press('Escape');

  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
  await page.screenshot({ path: 'tools/report/course-overview-fail.png' }).catch(() => {});
} finally {
  await cleanup();
  await browser.close();
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
