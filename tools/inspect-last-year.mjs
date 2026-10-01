// tools/inspect-last-year.mjs
//
// 작년 이맘때(docs/ROADMAP.md 7)를 실제 크롬으로 본다.
//   - 주간 화면 '🕰️ 작년 이맘때'를 켜면 요일 카드 아래에 작년 학년도 같은 주 같은 요일의 일정·기록이 흐리게 붙는다
//   - 같은 주는 학년도 몇째 주: 2029학년도 1주(2.26 주, 개학 3.2 금) ↔ 2028학년도 1주(2.28 주, 개학 3.2 목)
//   - V3 글만 있는 날도 읽는다, 작년 항목을 눌러도 하루 화면으로 가지 않는다, 다음 주 줄에는 붙지 않는다
//   - 주를 넘기면 작년 주도 따라간다, 명령 창 '작년'은 다른 화면에서 주간으로 가서 켠다
// 자료는 2028-02-28 주(작년)에 심고 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-last-year.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'last-year');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const ref = (col, date) => doc(db, 'users', user.uid, col, date);

const SEED = [
  [
    ref('events', '2028-02-28'),
    {
      eventList: [{ id: 'ly_e1', content: '작년 입학식 준비 점검', label: '달력', labelIds: ['ev_1'], completed: false }],
      eventText: '[달력] 작년 입학식 준비 점검',
    },
  ],
  // V3 글만 있는 날 (eventList 없이 eventText만)
  [ref('events', '2028-03-02'), { eventText: '작년 V3 글만 있는 일정' }],
  [
    ref('journals', '2028-03-01'),
    { entries: [{ id: 'ly_j1', content: '작년 첫 주 학급 규칙 정함\n둘째 줄', labelIds: ['j_1'], createdAt: Date.now() }] },
  ],
];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const run = async () => {
  for (const [r, data] of SEED) await setDoc(r, data);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  const toggle = () => page.locator('[data-last-year-toggle]');
  const label = () => page.locator('[data-last-year-label]');
  const lastDay = (d) => page.locator(`[data-last-year="${d}"]`);
  const box = () => page.getByRole('combobox', { name: '명령 창' });

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    await page.getByRole('button', { name: '주간', exact: true }).first().click();
    await toggle().waitFor({ timeout: 10000 });

    // 2029-02-28이 든 주로 (명령 창, 주간에 남는 줄)
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+k');
    await box().waitFor({ timeout: 10000 });
    await box().fill('2029-02-28');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Enter');
    await page.locator('[data-date="2029-02-26"]').first().waitFor({ timeout: 10000 });

    // ── 1. 처음에는 꺼져 있다 ──
    check('처음에는 꺼짐', (await toggle().getAttribute('aria-pressed')) === 'false');
    check('꺼져 있으면 작년 칸이 없다', (await page.locator('[data-last-year]').count()) === 0);

    // ── 2. 켜면 작년 같은 주 ──
    await toggle().click();
    check('켜짐', (await toggle().getAttribute('aria-pressed')) === 'true');
    const text = (await label().innerText()).replace(/\s+/g, ' ');
    check('작년 같은 주 = 2028학년도 1주 (개학 주끼리)', text.includes('2028학년도 1주 · 2028.2.28 (월) ~ 3.5 (일)'), text);
    await lastDay('2028-02-28').getByText('작년 입학식 준비 점검').waitFor({ timeout: 10000 }).catch(() => {});
    const mon = page.locator('[data-date="2029-02-26"]').first();
    const monLast = mon.locator('[data-last-year="2028-02-28"] [data-last-year-item="event"]');
    check(
      '월요일 카드 아래에 작년 월요일 일정 (라벨 칩째)',
      (await monLast.count()) === 1 &&
        (await monLast.locator('span').first().innerText()) === '달력' &&
        (await monLast.innerText()).includes('작년 입학식 준비 점검')
    );
    check(
      '수요일 카드에 작년 수요일 기록 (라벨 이름째)',
      (await page.locator('[data-date="2029-02-28"]').first().locator('[data-last-year="2028-03-01"]').innerText()).includes('[학급활동]')
    );
    check('V3 글만 있는 날의 일정도 보인다', (await lastDay('2028-03-02').innerText()).includes('작년 V3 글만 있는 일정'));
    check('작년에 아무것도 없는 날은 \'없음\'', (await lastDay('2028-03-03').innerText()).includes('없음'));
    check('다음 주 줄에는 붙지 않는다', (await page.locator('section[aria-label="다음 주"] [data-last-year]').count()) === 0);
    await page.screenshot({ path: 'tools/report/last-year.png' });

    // ── 3. 작년 항목을 눌러도 하루 화면으로 가지 않는다 ──
    await lastDay('2028-02-28').getByText('작년 입학식 준비 점검').click();
    await page.waitForTimeout(400);
    check('작년 항목을 눌러도 주간에 남는다', (await toggle().count()) === 1);

    // ── 4. 주를 넘기면 작년 주도 따라간다 ──
    await page.getByTitle(/^이전 날짜/).click();
    await page.waitForFunction(() => document.querySelector('[data-last-year-label]')?.textContent?.includes('52주'), null, { timeout: 8000 }).catch(() => {});
    const prev = (await label().innerText()).replace(/\s+/g, ' ');
    check('이전 주 → 2027학년도 52주 (2028.2.21 주)', prev.includes('2027학년도 52주 · 2028.2.21 (월) ~ 2.27 (일)'), prev);

    // ── 5. 끄기, 명령 창 '작년'은 다른 화면에서 주간으로 가서 켠다 ──
    await toggle().click();
    check('다시 누르면 꺼지고 작년 칸이 사라진다', (await page.locator('[data-last-year]').count()) === 0);
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+k');
    await box().waitFor({ timeout: 10000 });
    await box().fill('작년');
    const first = (await page.locator('[role=option][aria-selected=true]').innerText()).replace(/\s+/g, ' ');
    check('명령 창 \'작년\' → 작년 이맘때', first.includes('작년 이맘때'), first);
    await page.keyboard.press('Enter');
    await toggle().waitFor({ timeout: 10000 }).catch(() => {});
    check('하루 화면에서 → 주간으로 가서 켠다', (await toggle().getAttribute('aria-pressed').catch(() => null)) === 'true');
    await toggle().click(); // 이 기기에 남으므로 꺼 두고 끝낸다
  } finally {
    for (const [r] of SEED) await deleteDoc(r);
  }

  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
