// tools/inspect-course-evals.mjs
//
// 18번 교과 전담 S8 '수업 칸 → 반 도구 + 조사표 반 자동 + 여러 반에 같은 조사표' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3에 과정(5-1~5-4, 2026-11-02 시작, 6차시)을 심고 시작
//   - 11-02 1교시(5-1) 카드의 반 도구 줄(자리표·뽑기·조사표), 조사표 → 학급 5-1·교과 '과학'이 골라져 있다
//   - '같은 과정의 다른 반에도' 안내: 5-2 11/2(월) 3교시 · 5-3 11/3(화) 2교시 · 5-4 11/3(화) 4교시
//   - 만들기 → 서버: 11-02 1교시(5-1)·3교시(5-2), 11-03 2교시(5-3)·4교시(5-4)에 같은 제목, rosterMeta·명단이 반마다 맞다,
//     V3 이름(evalList)과 V4 이름(list) 둘 다
//   - 자리표 단추 → 자리표가 5-1로 열린다
//   - 회귀: teacher(초등 담임) 카드에는 반 도구 줄이 없다
//   점검이 만든 조사표·과정은 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-course-evals.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, deleteDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-course-evals');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const uid = user.uid;
const planRef = doc(db, 'users', uid, 'v4_progress', 'pg_inspect_evals');
const evalRef = (d) => doc(db, 'users', uid, 'evaluations', d);
const DAYS = ['2026-11-02', '2026-11-03'];
const TITLE = '점검 과정 평가';

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
async function serverUntil(fn, ok, timeout = 10000) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await fn();
  }
  return [v, Date.now() - t0];
}

const before = {};
async function setup() {
  for (const d of DAYS) before[d] = (await getDocFromServer(evalRef(d))).data() || null;
  const lessons = Array.from({ length: 6 }, (_, i) => ({ unit: '', no: String(i + 1), content: `점검 평가 차시 ${i + 1}`, supplies: '' }));
  await setDoc(planRef, { key: '5-1 과학', subject: '과학', classes: ['5-1', '5-2', '5-3', '5-4'], startDate: '2026-11-02', lessons, bumps: [], updatedAt: Date.now() });
}
async function cleanup() {
  await deleteDoc(planRef);
  for (const d of DAYS) {
    if (before[d]) await setDoc(evalRef(d), before[d]);
    else await deleteDoc(evalRef(d));
  }
}
const ourEvals = async (d) => {
  const data = (await getDocFromServer(evalRef(d))).data() || {};
  const list = data.evalList || data.list || [];
  return { list: list.filter((e) => e.title === TITLE), v3: (data.evalList || []).filter((e) => e.title === TITLE).length, v4: (data.list || []).filter((e) => e.title === TITLE).length };
};

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
  await goDate(DAYS[0]);

  const tools = card(DAYS[0], 1).locator('[data-class-tools]');
  await tools.waitFor({ timeout: 10000 });
  const toolText = (await tools.innerText()).replace(/\s+/g, ' ');
  check('1교시(5-1) 카드에 반 도구 줄 (자리표·뽑기·조사표)', /자리표/.test(toolText) && /뽑기/.test(toolText) && /조사표/.test(toolText), toolText);

  await tools.locator('[data-class-tool-btn="eval"]').click();
  const dlg = page.getByRole('dialog').filter({ hasText: '조사표 제목' }).first();
  await dlg.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  const rosterText = await dlg.getByLabel('적용할 명렬표').evaluate((el) => el.options[el.selectedIndex]?.text || '');
  const subj = await dlg.getByLabel('교과').inputValue();
  check("학급 5-1·교과 '과학'이 골라져 있다", /2026학년도 5학년 1반/.test(rosterText) && subj === '과학', `${rosterText} / ${subj}`);

  const box = dlg.locator('[data-course-evals]');
  await box.waitFor({ timeout: 10000 });
  const boxText = (await box.innerText()).replace(/\s+/g, ' ');
  check("'같은 과정의 다른 반에도': 5-2 11/2(월) 3교시 · 5-3 11/3(화) 2교시 · 5-4 11/3(화) 4교시",
    /5-2 11\/2\(월\) 3교시 · 5-3 11\/3\(화\) 2교시 · 5-4 11\/3\(화\) 4교시/.test(boxText), boxText);
  await box.locator('input[type=checkbox]').check();
  await dlg.getByPlaceholder(/1단원 평가/).fill(TITLE);
  await dlg.getByRole('button', { name: '생성', exact: true }).click();
  await page.getByText(/에도 만들었습니다/).first().waitFor({ timeout: 15000 });

  const [d2] = await serverUntil(() => ourEvals(DAYS[0]), (v) => v.list.length === 2);
  const [d3] = await serverUntil(() => ourEvals(DAYS[1]), (v) => v.list.length === 2);
  const at = (v, p) => v.list.find((e) => String(e.periodStr) === String(p));
  const ok = (e, cls, first) => !!e && e.rosterMeta?.classNum === cls && e.subject === '과학' && e.studentsSnapshot?.[0]?.name === first;
  check('서버 11-02: 1교시 5-1(가1…)·3교시 5-2(나1…)', ok(at(d2, 1), '1', '가1') && ok(at(d2, 3), '2', '나1'),
    d2.list.map((e) => `${e.periodStr}교시 ${e.rosterMeta?.classNum}반 ${e.studentsSnapshot?.[0]?.name}`).join(', '));
  check('서버 11-03: 2교시 5-3(다1…)·4교시 5-4(라1…)', ok(at(d3, 2), '3', '다1') && ok(at(d3, 4), '4', '라1'),
    d3.list.map((e) => `${e.periodStr}교시 ${e.rosterMeta?.classNum}반 ${e.studentsSnapshot?.[0]?.name}`).join(', '));
  check('V3 이름(evalList)·V4 이름(list) 둘 다 쓴다', d2.v3 === 2 && d2.v4 === 2 && d3.v3 === 2 && d3.v4 === 2, `${d2.v3}/${d2.v4} ${d3.v3}/${d3.v4}`);
  const ids = [...d2.list, ...d3.list].map((e) => e.id);
  check('조사표 id가 모두 다르다', new Set(ids).size === 4, ids.join(','));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // 다른 반 카드에 조사표 표식
  const badge3 = card(DAYS[0], 3).getByTitle(/조사표 1건/);
  check('11-02 3교시(5-2) 카드에 조사표 1건 표식', await badge3.count().then((n) => n > 0));

  // 자리표 단추 → 5-1
  await card(DAYS[0], 1).locator('[data-class-tool-btn="seating"]').click();
  const seat = page.getByRole('dialog').filter({ hasText: '🪑 자리표' }).first();
  await seat.waitFor({ timeout: 10000 });
  const seatClass = await seat.getByLabel('학급').evaluate((el) => el.options[el.selectedIndex]?.text || '');
  check('자리표 단추 → 자리표가 5-1로 열린다', /5학년 1반/.test(seatClass), seatClass);
  await page.keyboard.press('Escape');

  // ── 회귀: 초등 담임 ──────────────────────────────────────────
  await openApp('');
  await page.locator('[data-focus-key^="period:"]').first().waitFor({ timeout: 15000 });
  check('초등 담임(teacher) 카드에는 반 도구 줄이 없다', (await page.locator('[data-class-tools]').count()) === 0);

  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
  await page.screenshot({ path: 'tools/report/course-evals-fail.png' }).catch(() => {});
} finally {
  await cleanup();
  await browser.close();
}

const okN = results.filter(Boolean).length;
console.log(`\n${okN}/${results.length} 통과`);
process.exit(okN === results.length ? 0 : 1);
