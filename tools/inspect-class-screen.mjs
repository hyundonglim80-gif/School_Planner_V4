// tools/inspect-class-screen.mjs
//
// ROADMAP 16 '학급' 탭 - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px, 마지막에 휴대폰 탭바만 390px로 한 번).
//   - 맨 위 '학급' 탭·Shift+6, 메모 다음이 학급(Shift+→), 학급 고르기, 학생 명단, 오늘 출결 한 줄
//   - 도구가 고른 학급으로 열린다: 자리표·조사표 모아 보기(학급 칸), 학생 이름 → 그 학생 기록(누가기록), 오늘 출결 → 그 학급 출석부
//   - 고른 학급은 다시 열어도 남는다, 휴대폰 아래 탭이 여섯
//   올해 학년도 첫 학급의 오늘 출결에 1번 결석을 심었다가 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-class-screen.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-class-screen');
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const pad = (n) => String(n).padStart(2, '0');
const t0 = new Date();
const TODAY = `${t0.getFullYear()}-${pad(t0.getMonth() + 1)}-${pad(t0.getDate())}`;
const AY = t0.getMonth() >= 2 ? t0.getFullYear() : t0.getFullYear() - 1;
const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const rosterData = (await getDocFromServer(rosterRef)).data() || {};
let classes = rosterData.classList || rosterData.rosters || [];
// seed는 기본 계정에 명렬표를 심지 않는다. 올해 학급이 없으면 점검용 두 반(9-1·9-2)을 심었다가 끝에 뺀다.
const PLANTED = !classes.some((c) => Number(c.year) === AY && (c.students || []).length > 1)
  ? ['1', '2'].map((classNum) => ({
      year: AY, grade: '9', classNum,
      students: [1, 2, 3].map((num) => ({ num, name: `점검${classNum}반${num}`, gender: '', isActive: true, note: '' })),
    }))
  : [];
if (PLANTED.length) {
  classes = [...classes, ...PLANTED];
  await setDoc(rosterRef, { classList: classes, rosters: classes, updatedAt: Date.now() }, { merge: true });
}
const CLS = classes.find((c) => Number(c.year) === AY && (c.students || []).length > 1);
const OTHER = classes.find((c) => c !== CLS && (c.students || []).length > 0);
const keyOf = (c) => `${c.year}_${c.grade}_${c.classNum}`;
const KEY = CLS ? keyOf(CLS) : '';
const active = CLS ? CLS.students.filter((s) => s.isActive !== false).sort((a, b) => a.num - b.num) : [];
const S1 = active[0];
const S2 = active[1];
const attRef = doc(db, 'users', uid, 'attendance', `${KEY}_${TODAY}`);
let origAtt = null;
if (CLS) {
  origAtt = (await getDocFromServer(attRef)).data() || null;
  await setDoc(attRef, {
    classKey: KEY, year: Number(CLS.year), grade: String(CLS.grade), classNum: String(CLS.classNum), date: TODAY,
    records: { [S1.num]: { num: S1.num, name: S1.name, kind: 'absent', reason: 'sick' } }, updatedAt: Date.now(),
  });
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
const screen = page.locator('[data-class-screen]');
const closeAll = async () => {
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
};

try {
  check('점검할 올해 학급이 있다', !!CLS, KEY);
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });

  await page.getByRole('button', { name: '학급', exact: true }).first().click();
  await screen.waitFor({ timeout: 10000 });
  check('맨 위 학급 탭 → 학급 화면 (날짜 이동 줄은 없다)', (await page.getByTitle(/달력에서 날짜 선택/).count()) === 0);
  await screen.getByRole('combobox', { name: '학급 고르기' }).selectOption(KEY);
  await page.waitForTimeout(500);
  check('학생 명단 (재적 학생 수)', (await screen.locator('[data-class-student]').count()) === active.length, `${active.length}명`);
  await screen.locator('[data-class-today]').getByText('결석').waitFor({ timeout: 10000 }).catch(() => {});
  const todayText = await screen.locator('[data-class-today]').innerText();
  check('오늘 출결 한 줄에 결석', todayText.includes(S1.name) && todayText.includes('결석'), todayText.replace(/\n/g, ' '));

  // 도구가 고른 학급으로
  await screen.locator('[data-class-tool="seating"]').click();
  const seat = page.getByRole('dialog').filter({ hasText: '자리표' }).last();
  await seat.waitFor({ timeout: 10000 });
  const seatClass = await seat.locator('select').first().inputValue();
  check('🪑 자리표 → 고른 학급으로', seatClass === KEY, seatClass);
  await closeAll();

  await screen.locator('[data-class-tool="evalOverview"]').click();
  const ov = page.getByRole('dialog').filter({ hasText: '조사표 모아 보기' }).last();
  await ov.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check('📊 조사표 모아 보기 → 고른 학급으로', (await ov.getByRole('combobox', { name: '학급' }).inputValue()) === KEY);
  await closeAll();

  await screen.locator(`[data-class-student="${S2.num}"]`).click();
  const rec = page.getByRole('dialog').filter({ hasText: '누가기록' }).last();
  await rec.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check('학생 이름 → 그 학생의 누가기록', (await rec.innerText()).includes(S2.name), S2.name);
  await closeAll();

  await screen.locator('[data-class-today]').click();
  const att = page.locator('aside[aria-label="출석부 쓰기"]');
  await att.waitFor({ timeout: 10000 });
  const attClass = await att.locator('select').first().inputValue();
  check('오늘 출결 → 그 학급 출석부', attClass === KEY, attClass);
  await closeAll();

  // 단축키·옆 화면
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.waitForTimeout(500);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Shift+Digit6');
  await screen.waitFor({ timeout: 5000 }).catch(() => {});
  check('Shift+6 → 학급', (await screen.count()) === 1);
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.waitForTimeout(800);
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press('Shift+ArrowRight');
  await screen.waitFor({ timeout: 5000 }).catch(() => {});
  check('메모 다음(Shift+→)이 학급', (await screen.count()) === 1);

  // 고른 학급이 남는다
  if (OTHER) {
    await screen.getByRole('combobox', { name: '학급 고르기' }).selectOption(keyOf(OTHER));
    await page.reload({ waitUntil: 'domcontentloaded' });
    await screen.waitFor({ timeout: 40000 });
    check('고른 학급은 다시 열어도 남는다', (await screen.getByRole('combobox', { name: '학급 고르기' }).inputValue()) === keyOf(OTHER));
    await screen.getByRole('combobox', { name: '학급 고르기' }).selectOption(KEY);
  }
  await page.screenshot({ path: 'tools/report/class-screen.png' });

  // 휴대폰 아래 탭 여섯
  await page.setViewportSize({ width: 390, height: 844 });
  await page.waitForTimeout(800);
  const tabs = page.locator('[data-mobile-tabbar] button');
  const n = await tabs.count();
  const widths = await tabs.evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  check('휴대폰 아래 탭 여섯, 한 칸 60px 넘게', n === 6 && widths.every((w) => w >= 60) && (await tabs.last().innerText()).includes('학급'), widths.join(','));
  await page.screenshot({ path: 'tools/report/class-screen-mobile.png' });
  await page.setViewportSize({ width: 1400, height: 900 });
} catch (e) {
  check('예상 못 한 오류', false, String(e).slice(0, 300));
  await page.screenshot({ path: 'tools/report/class-screen-error.png' }).catch(() => {});
} finally {
  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await page.getByRole('button', { name: '하루', exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await browser.close();
  if (CLS) {
    if (origAtt) await setDoc(attRef, origAtt);
    else await deleteDoc(attRef).catch(() => {});
  }
  if (PLANTED.length) {
    const now = (await getDocFromServer(rosterRef)).data() || {};
    const left = (now.classList || now.rosters || []).filter((c) => !(Number(c.year) === AY && c.grade === '9'));
    await setDoc(rosterRef, { classList: left, rosters: left, updatedAt: Date.now() }, { merge: true });
  }
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
