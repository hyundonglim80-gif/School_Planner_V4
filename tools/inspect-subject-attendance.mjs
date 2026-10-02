// tools/inspect-subject-attendance.mjs
//
// 18번 교과 전담 S6 '교과 출결 - 저장과 입력 칸' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3 하루 2026-11-02: 1교시(5-1) '🙋 출결' → 칸 머리 '5-1 · 11/2(월) 1교시 · 과학' → 2번 결과 → 서버 periods.1.2 (질병)
//   - 같은 문서의 다른 교시(다른 기기에서 적은 periods.4.3)는 그대로, 3교시(5-2) 칸도 함께 열어 1번 지각 → 1교시 기록 그대로
//   - 사유 적기 → 서버 note, 새로고침해도 카드에 '결과 1', 2번을 출석으로 → 그 칸만 사라지고 periods.4.3은 남는다
//   - 회귀: teacher(초등 담임) 하루 카드에는 출결 단추가 없다
//   점검이 만든 교과 출결 문서는 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-subject-attendance.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, deleteDoc, getDocFromServer, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const DAY = '2026-11-02'; // 월요일 - seed: 1교시 '5-1 과학', 3교시 '5-2 과학'
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-subject-attendance');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const ref51 = doc(db, 'users', user.uid, 'v4_subjectAttendance', `2026_5_1_${DAY}`);
const ref52 = doc(db, 'users', user.uid, 'v4_subjectAttendance', `2026_5_2_${DAY}`);
const read = async (r) => (await getDocFromServer(r)).data() || null;

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
async function serverUntil(fn, ok, timeout = 8000) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await fn();
  }
  return [v, Date.now() - t0];
}
async function cleanup() {
  await deleteDoc(ref51);
  await deleteDoc(ref52);
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
const card = (p) => page.locator(`[data-focus-key="period:${DAY}:${p}"]`).first();
const panelOf = (cls) => page.locator('[data-subject-attendance-panel]').filter({ hasText: `${cls} · ` }).first();

try {
  await cleanup();
  // 다른 기기에서 같은 날 5-1의 4교시를 적어 둔 것처럼 (같은 문서의 다른 교시)
  await setDoc(ref51, {
    classKey: '2026_5_1', year: 2026, grade: '5', classNum: '1', date: DAY,
    periods: { 4: { 3: { num: 3, name: '가3', kind: 'late', reason: 'other' } } },
    updatedAt: Date.now(),
  });
  await openApp();
  await goDate(DAY);

  const btn1 = card(1).locator('[data-subject-attendance]');
  await btn1.waitFor({ timeout: 10000 });
  check("1교시(5-1) 카드에 '🙋 출결' 단추", /출결/.test(await btn1.innerText()), await btn1.innerText());
  await btn1.click();
  const p1 = panelOf('5-1');
  await p1.waitFor({ timeout: 10000 });
  const title = await p1.locator('[data-subject-attendance-title]').innerText();
  check("칸 머리 '5-1 · 11/2(월) 1교시 · 과학'", /5-1 · 11\/2\(월\) 1교시 · 과학/.test(title), title);
  await p1.locator('[data-subject-att-num="2"]').getByRole('button', { name: '결과', exact: true }).click();
  const [d1] = await serverUntil(() => read(ref51), (v) => v?.periods?.['1']?.['2']?.kind === 'absent');
  check('2번 결과 → 서버 periods.1.2 (결과·질병)', d1?.periods?.['1']?.['2']?.kind === 'absent' && d1?.periods?.['1']?.['2']?.reason === 'sick', JSON.stringify(d1?.periods?.['1']));
  check('같은 문서의 다른 교시(periods.4.3)는 그대로', d1?.periods?.['4']?.['3']?.kind === 'late');

  // 3교시(5-2) 칸도 함께 연다 (오른쪽 줄에 쌓인다)
  await card(3).locator('[data-subject-attendance]').click();
  const p3 = panelOf('5-2');
  await p3.waitFor({ timeout: 10000 });
  await p3.locator('[data-subject-att-num="1"]').getByRole('button', { name: '지각', exact: true }).click();
  const [d3] = await serverUntil(() => read(ref52), (v) => v?.periods?.['3']?.['1']?.kind === 'late');
  const d1b = await read(ref51);
  check('3교시(5-2) 1번 지각 → 서버, 1교시(5-1) 기록은 그대로', d3?.periods?.['3']?.['1']?.kind === 'late' && d1b?.periods?.['1']?.['2']?.kind === 'absent');

  // 사유 적기
  const row2 = p1.locator('[data-subject-att-num="2"]');
  await row2.getByRole('button', { name: /사유 적기/ }).click();
  await row2.getByLabel('2번 사유').fill('보건실');
  await row2.getByLabel('2번 사유').press('Enter');
  const [d1n] = await serverUntil(() => read(ref51), (v) => v?.periods?.['1']?.['2']?.note === '보건실');
  check("사유 '보건실' → 서버 note", d1n?.periods?.['1']?.['2']?.note === '보건실');
  const s1 = await card(1).locator('[data-subject-att-summary]').innerText().catch(() => '');
  check("카드에 '결과 1' 표", s1 === '결과 1', s1);

  // 새로고침
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);
  await openApp();
  await goDate(DAY);
  const s1r = card(1).locator('[data-subject-att-summary]');
  await s1r.waitFor({ timeout: 10000 }).catch(() => {});
  check("새로고침해도 카드에 '결과 1'", ((await s1r.count()) ? await s1r.innerText() : '') === '결과 1');
  await card(1).locator('[data-subject-attendance]').click();
  const p1r = panelOf('5-1');
  await p1r.waitFor({ timeout: 10000 });
  const pressed = await p1r.locator('[data-subject-att-num="2"]').getByRole('button', { name: '결과', exact: true }).getAttribute('aria-pressed');
  check('다시 열면 2번이 결과로 골라져 있다', pressed === 'true');

  // 출석으로 되돌리기
  await p1r.locator('[data-subject-att-num="2"]').getByRole('button', { name: '출석', exact: true }).click();
  const [d1x] = await serverUntil(() => read(ref51), (v) => !v?.periods?.['1']?.['2']);
  check('2번을 출석으로 → 그 칸만 사라지고 periods.4.3은 남는다', !d1x?.periods?.['1']?.['2'] && d1x?.periods?.['4']?.['3']?.kind === 'late', JSON.stringify(d1x?.periods));
  await page.waitForTimeout(500);
  check("카드 표가 다시 '🙋 출결'", /출결/.test(await card(1).locator('[data-subject-attendance]').innerText()));
  await page.screenshot({ path: 'tools/report/subject-attendance.png' }).catch(() => {});
  await page.keyboard.press('Escape');

  // ── 회귀: 초등 담임 ──────────────────────────────────────────
  await openApp('');
  await page.locator('[data-focus-key^="period:"]').first().waitFor({ timeout: 15000 });
  check('초등 담임(teacher) 하루 카드에는 출결 단추가 없다', (await page.locator('[data-subject-attendance]').count()) === 0);

  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
  await page.screenshot({ path: 'tools/report/subject-attendance-fail.png' }).catch(() => {});
} finally {
  await cleanup();
  await browser.close();
}

const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
