// tools/inspect-refine-u1.mjs
//
// 19번 U1 '버그 셋' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U1).
//   - teacher3: 명렬표에 없는 반(6-3)을 시간표에만 적어도 수업 칸 ▼에 나온다
//   - teacher3: '5-3 과학'이 적힌 칸에 들어가면 ▼ 목록에 다른 반(5-1)도 나온다, 글자를 치면 거른다, ESC는 목록만 닫는다
//   - teacher3: 환경설정 '가르치는 반'에 '7-1~7-2' → 계정에 저장, ▼ 목록과 진도 관리의 반 칩에 나온다
//   - teacher(휴대폰 폭): 월간 날짜 목록의 라벨 칩을 누르면 완료, 다시 누르면 풀림 (일정을 열지 않는다)
//   - 회귀: teacher 수업 칸은 예전 그대로 (콤보 없음)
// 점검이 바꾼 시간표·교사 유형·일정 문서는 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u1.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;
const DAY = '2026-11-03'; // 화요일 - seed: 2교시 '5-3 과학'
const SHEET_DAY = '2026-10-14';

async function account(email) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, `inspect-u1-${email}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const { user } = await signInWithEmailAndPassword(auth, email, 'test1234');
  const ref = (...path) => doc(db, 'users', user.uid, ...path);
  const read = async (r) => {
    const s = await getDocFromServer(r);
    return s.exists() ? s.data() : null;
  };
  return { ref, read };
}
const t1 = await account('teacher@example.com');
const t3 = await account('teacher3@example.com');

async function serverUntil(read, ok, timeout = 8000) {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await read();
  }
  return [v, Date.now() - t0];
}
async function restore(r, before) {
  if (before) await setDoc(r, before);
  else await deleteDoc(r);
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const logs = [];
async function open(as, viewport = { width: 1400, height: 900 }) {
  const ctx = await browser.newContext({ viewport, ...(viewport.width < 600 ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => logs.push(`pageerror(${as || 1}): ${e.message.slice(0, 200)}`));
  await page.goto(`${V4}${as ? `?as=${as}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  if (viewport.width >= 600) {
    // 보던 화면이 기억된다 - 하루 화면으로
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  }
  await page.waitForTimeout(1000);
  return { ctx, page };
}
async function goDate(page, date) {
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
const comboOptions = (page) =>
  page.locator('[data-combobox-list] [data-combobox-option]').evaluateAll((els) => els.map((e) => e.getAttribute('data-combobox-option')));
/** 목록이 n개 넘게 뜰 때까지 (명렬표·시간표 구독이 늦게 올 수 있다) */
const waitComboAtLeast = (page, n) =>
  page
    .waitForFunction((k) => document.querySelectorAll('[data-combobox-list] [data-combobox-option]').length >= k, n, { timeout: 8000 })
    .catch(() => {});

const tt3 = t3.ref('settings', 'timetable_v5');
const tm3 = t3.ref('settings', 'v4_teaching');
const ev1 = t1.ref('events', SHEET_DAY);
const tt3Before = await t3.read(tt3);
const tm3Before = await t3.read(tm3);
const ev1Before = await t1.read(ev1);

try {
  // 시간표에만 6-3 (명렬표에는 5학년 네 반뿐)
  {
    const t = JSON.parse(JSON.stringify(tt3Before || { templates: {} }));
    const name = Object.keys(t.templates || {})[0] || '1학기 시간표';
    t.templates = t.templates || {};
    t.templates[name] = t.templates[name] || { names: ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'], data: {} };
    t.templates[name].data = t.templates[name].data || {};
    t.templates[name].data.fri = { ...(t.templates[name].data.fri || {}), 6: '6-3 과학' };
    await setDoc(tt3, t);
  }

  // ── teacher3: 하루 수업 칸 ▼ ───────────────────────────────────
  {
    const { ctx, page } = await open(3);
    await goDate(page, DAY);
    const card = page.locator(`[data-focus-key="period:${DAY}:2"]`).first();
    await card.waitFor({ timeout: 15000 });
    await card.click();
    const input = page.locator('input[data-slot-input]');
    await input.waitFor({ timeout: 5000 });
    check("teacher3: 수업 칸에 '5-3 과학'이 적혀 있다", (await input.inputValue()) === '5-3 과학', await input.inputValue());
    await waitComboAtLeast(page, 5);
    let opts = await comboOptions(page);
    check("teacher3: 칸에 들어가면 ▼ 목록이 전체 - 다른 반 '5-1 과학'도", opts.includes('5-1 과학') && opts.includes('5-4 과학'), opts.join(','));
    check("teacher3: 명렬표에 없는 반을 시간표에만 적어도 나온다 '6-3 과학'", opts.includes('6-3 과학'));

    await input.fill('6');
    await page.waitForTimeout(200);
    opts = await comboOptions(page);
    check("teacher3: 글자를 치면 거른다 ('6' → '6-3 과학'만)", opts.join(',') === '6-3 과학', opts.join(','));

    await input.press('Escape');
    await page.waitForTimeout(200);
    check('teacher3: ESC는 목록만 닫는다 (칸은 그대로)', (await page.locator('[data-combobox-list]').count()) === 0 && (await input.count()) === 1);

    await card.locator('[data-combobox-toggle]').click();
    await page.waitForTimeout(200);
    opts = await comboOptions(page);
    check("teacher3: '6'이 적힌 채 ▼를 눌러도 전체 목록", opts.includes('5-1 과학') && opts.includes('6-3 과학'), String(opts.length));
    await page.locator('[data-combobox-option="5-2 과학"]').click();
    await page.waitForTimeout(200);
    check("teacher3: 목록에서 고르면 칸에 '5-2 과학', 수정 칸은 열린 채", (await input.inputValue()) === '5-2 과학');
    await input.press('Escape'); // 목록은 고르며 닫혔다 - 수정 취소
    await page.waitForTimeout(300);
    check('teacher3: 목록이 닫힌 뒤의 ESC는 수정 칸을 닫는다', (await input.count()) === 0);

    // ── 환경설정 '가르치는 반' ─────────────────────────────────
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /환경설정/ }).first().click();
    const classInput = page.locator('[data-teaching-class-input]');
    await classInput.waitFor({ timeout: 10000 });
    await classInput.scrollIntoViewIfNeeded();
    await classInput.fill('7-1~7-2');
    await classInput.press('Enter');
    const [tm] = await serverUntil(() => t3.read(tm3), (v) => (v?.classes || []).includes('7-2'));
    check("teacher3: 환경설정 '가르치는 반' '7-1~7-2' → 계정에 7-1·7-2", ['7-1', '7-2'].every((c) => (tm?.classes || []).includes(c)), JSON.stringify(tm?.classes));
    await page.locator('[data-teaching-class="7-1"]').waitFor({ timeout: 5000 }).catch(() => {});
    check('teacher3: 저장한 반이 칩으로 보인다', (await page.locator('[data-teaching-class="7-1"]').count()) === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    await card.click();
    await input.waitFor({ timeout: 5000 });
    await waitComboAtLeast(page, 7);
    opts = await comboOptions(page);
    check("teacher3: 설정의 반도 ▼ 목록에 '7-1 과학'", opts.includes('7-1 과학'), opts.join(','));
    await input.press('Escape');
    await input.press('Escape');
    await page.waitForTimeout(300);

    // ── 진도 관리 반 칩 ────────────────────────────────────────
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /진도 관리/ }).click();
    const dlg = page.getByRole('dialog').filter({ hasText: '차시 목록' }).first();
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator('[data-new-course]').click();
    await dlg.locator('[data-course-form]').waitFor({ timeout: 5000 });
    await dlg.locator('[data-course-class-toggle="6-3"]').waitFor({ timeout: 8000 }).catch(() => {});
    const chips = await dlg.locator('[data-course-class-toggle]').evaluateAll((els) => els.map((e) => e.getAttribute('data-course-class-toggle')));
    check("teacher3: 진도 관리 반 칩에 시간표(6-3)·설정(7-1)의 반도", ['5-1', '6-3', '7-1'].every((c) => chips.includes(c)), chips.join(','));
    await ctx.close();
  }

  // ── teacher 휴대폰: 월간 날짜 목록 칩 완료 ─────────────────────
  {
    const before = ev1Before || { eventList: [] };
    const id = 'ev_inspect_u1_chip';
    await setDoc(ev1, {
      ...before,
      eventList: [...(before.eventList || []), { id, content: 'U1 칩 점검', completed: false, label: '달력', labelIds: ['ev_1'], linkedItems: [], attachments: [] }],
    });
    const { ctx, page } = await open(null, { width: 390, height: 844 });
    await page.locator('nav.fixed').getByText('월간', { exact: true }).click();
    // 2026-10월이 보이는지 (오늘 달)
    const cell = page.locator(`[data-date="${SHEET_DAY}"]`).first();
    await cell.waitFor({ timeout: 15000 });
    await cell.click();
    const chip = page.locator(`[data-sheet-event-chip="${id}"]`);
    await chip.waitFor({ timeout: 8000 });
    await chip.click();
    const done = (v) => (v?.eventList || []).find((e) => e.id === id)?.completed;
    let [v, ms] = await serverUntil(() => t1.read(ev1), (x) => done(x) === true);
    check('teacher 휴대폰: 월간 목록의 라벨 칩을 누르면 완료', done(v) === true, `${ms}ms`);
    check('teacher 휴대폰: 칩을 눌러도 일정 쓰는 칸은 열리지 않는다', (await page.locator('[role=dialog]').count()) === 0);
    await page.waitForTimeout(500);
    await chip.click();
    [v, ms] = await serverUntil(() => t1.read(ev1), (x) => done(x) === false);
    check('teacher 휴대폰: 다시 누르면 완료가 풀린다', done(v) === false, `${ms}ms`);
    await ctx.close();
  }

  // ── 회귀: teacher 수업 칸은 그대로 ─────────────────────────────
  {
    const { ctx, page } = await open();
    await goDate(page, DAY);
    const card = page.locator(`[data-focus-key^="period:${DAY}:"]`).first();
    await card.waitFor({ timeout: 15000 });
    await card.click();
    await page.waitForTimeout(500);
    check("teacher: 수업 칸에 콤보(▼)가 없다, placeholder '과목'", (await page.locator('[role=combobox]').count()) === 0 && (await page.locator('input[placeholder="과목"]').count()) >= 1);
    await page.keyboard.press('Escape');
    await ctx.close();
  }
} catch (e) {
  check('점검 도중 오류', false, String(e?.message || e).slice(0, 300));
} finally {
  await restore(tt3, tt3Before);
  await restore(tm3, tm3Before);
  await restore(ev1, ev1Before);
  await browser.close();
}

if (logs.length) console.log(logs.join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
