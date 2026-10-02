// tools/inspect-course-status.mjs
//
// 18번 교과 전담 S5 '지난 시간 메모 + 반별 진도 현황판' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3: 11-02 3교시(5-2) 수업 메모 '실험 못 끝냄' → 11-04 1교시(5-2) 카드에 '지난 시간 11/2(월) 3교시: 실험 못 끝냄',
//     5-1(11-04 2교시) 카드에는 줄이 없다, 줄을 누르면 11-02로 간다
//   - 과정(5-1~5-4, 2026-09-07 시작)을 심고 진도 창 현황표 4줄(오늘까지 한 차시가 같다), 5-3의 지난 두 교시를 밀면 '2차시 늦음',
//     5-1 '다음 수업 밀기' → 서버 bumps에 오늘 뒤 5-1 교시 하나
//   - 회귀: teacher(초등 담임) 하루 카드에는 지난 시간 줄이 없다
//   심은 수업(2026-09-07~18)·진도·메모는 끝에 되돌린다. 오늘(실제 날짜)이 2026-09-19 ~ 2026-11-01 사이일 때 맞게 짰다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-course-status.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  deleteDoc,
  getDocFromServer,
  setDoc,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-course-status');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const uid = user.uid;
const ref = (...p) => doc(db, 'users', uid, ...p);
const planRef = ref('v4_progress', 'pg_inspect_status');
const today = new Date(Date.now() + 9 * 3600e3).toISOString().slice(0, 10);

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

// seed.mjs와 같은 요일 시간표 (월=1 … 금=5)
const WEEKLY = {
  1: { 1: '5-1 과학', 3: '5-2 과학' },
  2: { 2: '5-3 과학', 4: '5-4 과학' },
  3: { 1: '5-2 과학', 2: '5-1 과학' },
  4: { 3: '5-4 과학', 5: '5-3 과학' },
  5: { 1: '5-1 과학', 2: '5-2 과학', 3: '5-3 과학', 4: '5-4 과학' },
};
const SEPT = [];
for (let d = 7; d <= 18; d++) {
  const date = `2026-09-${String(d).padStart(2, '0')}`;
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay();
  if (dow >= 1 && dow <= 5) SEPT.push([date, dow]);
}
const memoRef = ref('schedules', '2026-11-02');
let memoBefore = null;

async function setup() {
  for (const [date, dow] of SEPT) {
    const periods = Object.fromEntries(Object.entries(WEEKLY[dow]).map(([p, subject]) => [p, { subject, memo: '', supplies: '' }]));
    await setDoc(ref('schedules', date), { periods, updatedAt: Date.now() });
  }
  const lessons = Array.from({ length: 30 }, (_, i) => ({ unit: '', no: String(i + 1), content: `점검 현황 ${i + 1}`, supplies: '' }));
  await setDoc(planRef, {
    key: '5-1 과학',
    subject: '과학',
    classes: ['5-1', '5-2', '5-3', '5-4'],
    startDate: '2026-09-07',
    lessons,
    bumps: [],
    updatedAt: Date.now(),
  });
  memoBefore = (await getDocFromServer(memoRef)).data()?.periods?.['3'] ?? null;
  // 수업 칸 한 교시의 메모만 바꾼다 (다른 교시·칸은 그대로)
  await setDoc(memoRef, { periods: { 3: { memo: '실험 못 끝냄' } } }, { merge: true });
}
async function cleanup() {
  for (const [date] of SEPT) await deleteDoc(ref('schedules', date));
  await deleteDoc(planRef);
  await setDoc(memoRef, { periods: { 3: { memo: memoBefore?.memo ?? '' } } }, { merge: true });
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
  await page.waitForTimeout(1500);
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

try {
  await setup();
  await openApp();

  // ── 지난 시간 메모 ───────────────────────────────────────────
  await goDate('2026-11-04');
  const note = card('2026-11-04', 1).locator('[data-prev-note]');
  await note.waitFor({ timeout: 10000 }).catch(() => {});
  const noteText = (await note.count()) ? (await note.innerText()).replace(/\s+/g, ' ') : '';
  check("11-04 1교시(5-2)에 '지난 시간 11/2(월) 3교시: 실험 못 끝냄'", /지난 시간 11\/2\(월\) 3교시: 실험 못 끝냄/.test(noteText), noteText);
  check('5-1(11-04 2교시) 카드에는 지난 시간 줄이 없다 (앞 수업에 메모 없음)', (await card('2026-11-04', 2).locator('[data-prev-note]').count()) === 0);
  await note.click();
  const moved = await card('2026-11-02', 3).waitFor({ timeout: 8000 }).then(() => true, () => false);
  check('지난 시간 줄을 누르면 11-02로 간다', moved);

  // ── 반별 현황표 ─────────────────────────────────────────────
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /진도 관리/ }).click();
  const dlg = page.getByRole('dialog').filter({ hasText: '차시 목록' }).first();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator('[data-progress-plan="pg_inspect_status"]').click();
  const table = dlg.locator('[data-course-status]');
  await table.waitFor({ timeout: 10000 });
  const rows = table.locator('[data-course-status-row]');
  const texts = (await rows.allInnerTexts()).map((t) => t.replace(/\s+/g, ' '));
  check('현황표 4줄 (5-1~5-4)', texts.length === 4 && /^5-1/.test(texts[0]) && /^5-4/.test(texts[3]), texts.join(' / '));
  check('오늘까지 네 반 모두 6/30, 늦음 없음', texts.every((t) => /6\/30/.test(t)) && (await table.locator('[data-course-behind]').count()) === 0);

  // 5-3의 지난 두 교시를 민다 (미리보기 5-3 탭)
  await dlg.locator('[data-course-preview="5-3"]').click();
  for (const slot of ['2026-09-08#2', '2026-09-10#5']) {
    const li = dlg.locator(`[data-progress-preview] li[data-slot="${slot}"]`);
    await li.getByRole('button', { name: '밀기' }).click();
    await li.getByText('밀림').waitFor({ timeout: 10000 });
  }
  const behind = table.locator('[data-course-status-row="5-3"] [data-course-behind]');
  await behind.waitFor({ timeout: 8000 }).catch(() => {});
  const behindText = (await behind.count()) ? await behind.innerText() : '';
  check("5-3의 두 교시를 밀면 '2차시 늦음' (4/30)", behindText === '2차시 늦음' && /4\/30/.test(await table.locator('[data-course-status-row="5-3"]').innerText()), behindText);
  await page.screenshot({ path: 'tools/report/course-status.png' }).catch(() => {});

  // 다음 수업 밀기 (5-1)
  await table.locator('[data-course-bump="5-1"]').click();
  const [bumps] = await serverUntil(async () => (await getDocFromServer(planRef)).data().bumps || [], (v) => v.length === 3);
  const extra = bumps.filter((b) => !['2026-09-08#2', '2026-09-10#5'].includes(b));
  check('5-1 다음 수업 밀기 → 서버 bumps에 오늘 뒤 5-1 교시 하나', extra.length === 1 && extra[0].slice(0, 10) > today, extra.join(','));
  await page.keyboard.press('Escape');

  // ── 회귀: 초등 담임 ──────────────────────────────────────────
  await openApp('');
  await page.locator('[data-focus-key^="period:"]').first().waitFor({ timeout: 15000 });
  check('초등 담임(teacher) 하루 카드에는 지난 시간 줄이 없다', (await page.locator('[data-prev-note]').count()) === 0);

  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
  await page.screenshot({ path: 'tools/report/course-status-fail.png' }).catch(() => {});
} finally {
  await cleanup();
  await browser.close();
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
