// tools/inspect-refine-u3.mjs
//
// 19번 U3 '하루 수업 칸' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U3, PC 1400px).
//   - teacher: 진도 없는 교시를 고치면 '📘 진도 만들기' → 진도 관리 창이 과목 그 글자로 새 진도. 칸 aria '과목'
//   - teacher: 주간에서 연 'N교시 수정' 팝업에도 '📘 진도 만들기'
//   - teacher3: '5-3 과학' 교시 → 과목 과학 + 반 5-3, 칸 placeholder '학년-반 과목'
//   - teacher3: 진도 줄에 단원·📖 교과서 쪽, 카드 차례 진도 줄 → 준비물 → 메모
// 점검이 만든 진도와 고친 수업 문서는 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u3.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검U3';

async function account(email) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, `inspect-u3-${email}`);
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function openApp(as) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(`${V4}${as ? `?as=${as}` : ''}`, { waitUntil: 'domcontentloaded' });
  const day = page.getByRole('button', { name: '하루', exact: true }).first();
  await day.waitFor({ timeout: 40000 });
  await day.click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
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
  await page.locator(`[data-focus-key^="period:${date}:"]`).first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);
}
const card = (page, date, p) => page.locator(`[data-focus-key="period:${date}:${p}"]`).first();
const progressDialog = (page) => page.getByRole('dialog').filter({ hasText: '차시 목록' }).first();

const TDAY = '2026-10-14';
const t1Sched = t1.ref('schedules', TDAY);
const t1Before = await t1.read(t1Sched);
const t3Plan = t3.ref('v4_progress', 'pg_inspect_u3');
const t3Sched = t3.ref('schedules', '2026-11-03');
const t3Before = await t3.read(t3Sched);

try {
  // ── teacher ─────────────────────────────────────────────────
  {
    // 1교시를 진도 없는 과목으로 (점검용 글자)
    const periods = { ...(t1Before?.periods || {}) };
    periods['1'] = { subject: `${MARK}국어`, content: '', memo: '', supplies: '', linkedItems: [], attachments: [] };
    await setDoc(t1Sched, { ...(t1Before || {}), periods, updatedAt: Date.now() });

    const { ctx, page } = await openApp('');
    await goDate(page, TDAY);
    await card(page, TDAY, 1).click();
    const edit = card(page, TDAY, 1);
    await edit.getByLabel('과목', { exact: true }).waitFor({ timeout: 5000 });
    check("teacher: 수업 칸 수정의 과목 칸 aria '과목'", (await edit.getByLabel('과목', { exact: true }).inputValue()) === `${MARK}국어`);
    const create = edit.locator('[data-progress-create]');
    check("진도 없는 교시 수정 중에 '📘 진도 만들기'", (await create.count()) === 1);
    await create.click();
    const dlg = progressDialog(page);
    await dlg.waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    check("진도 관리 창이 과목 그 글자로 새 진도", (await dlg.getByLabel('과목', { exact: true }).inputValue()) === `${MARK}국어`);
    check('새 진도라 ✏️ 새 진도 표시 (저장한 진도가 아님)', (await dlg.getByRole('button', { name: '✏️ 새 진도' }).count()) === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // 주간 'N교시 수정' 팝업
    await page.getByRole('button', { name: '주간', exact: true }).first().click();
    await page.waitForTimeout(2000);
    await page.locator(`[data-date="${TDAY}"] [title^="1교시"]`).first().click();
    const popup = page.getByRole('dialog').filter({ hasText: '1교시 수정' }).first();
    await popup.waitFor({ timeout: 10000 });
    check("'1교시 수정' 팝업에도 '📘 진도 만들기'", (await popup.locator('[data-progress-create]').count()) === 1);
    await popup.locator('[data-progress-create]').click();
    await progressDialog(page).waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);
    check('팝업에서 연 진도 관리 창도 그 과목', (await progressDialog(page).getByLabel('과목', { exact: true }).inputValue()) === `${MARK}국어`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    await page.waitForTimeout(500);
    await ctx.close();
  }

  // ── teacher3 ────────────────────────────────────────────────
  {
    const { ctx, page } = await openApp('3');
    await goDate(page, '2026-11-03'); // 화: 2교시 5-3 과학, 4교시 5-4 과학
    await card(page, '2026-11-03', 2).click();
    const edit = card(page, '2026-11-03', 2);
    const input = edit.locator('input[data-slot-input]');
    await input.waitFor({ timeout: 5000 });
    check("teacher3: 칸 placeholder·aria '학년-반 과목'", /학년-반 과목/.test((await input.getAttribute('placeholder')) || '') && (await input.getAttribute('aria-label')) === '학년-반 과목');
    await edit.locator('[data-progress-create]').click();
    const dlg = progressDialog(page);
    await dlg.waitFor({ timeout: 10000 });
    await dlg.locator('[data-course-form]').waitFor({ timeout: 5000 });
    await page.waitForTimeout(800);
    const subj = await dlg.getByLabel('과목', { exact: true }).inputValue();
    const pressed = await dlg.locator('[data-course-class-toggle][aria-pressed="true"]').evaluateAll((els) => els.map((e) => e.getAttribute('data-course-class-toggle')));
    check("'5-3 과학' 교시 → 과목 과학 + 반 5-3", subj === '과학' && pressed.join(',') === '5-3', `${subj} / ${pressed.join(',')}`);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);
    await ctx.close();

    // 진도 줄: 단원·교과서 쪽, 카드 차례
    await setDoc(t3Plan, {
      key: '5-3 과학',
      subject: '과학',
      classes: ['5-3'],
      startDate: '2026-11-02',
      lessons: [
        { unit: '1. 물질', no: '1', content: `${MARK} 첫 차시`, page: '8~9', supplies: '비커' },
        { unit: '1. 물질', no: '2', content: `${MARK} 둘째`, page: '', supplies: '' },
      ],
      bumps: [],
      updatedAt: Date.now(),
    });
    const periods = { ...(t3Before?.periods || {}) };
    periods['2'] = { ...(periods['2'] || {}), subject: '5-3 과학', memo: `${MARK} 메모`, supplies: `${MARK} 준비물` };
    await setDoc(t3Sched, { ...(t3Before || {}), periods, updatedAt: Date.now() });
  }
  {
    const { ctx, page } = await openApp('3');
    await goDate(page, '2026-11-03');
    const c = card(page, '2026-11-03', 2);
    const m = c.locator('[data-progress-mark]');
    await m.waitFor({ timeout: 10000 });
    const text = (await m.innerText()).replace(/\s+/g, ' ');
    check('진도 줄: 📘 단원 · 1/2차시 · 내용 · 📖 8~9쪽 · 🎒 준비물', /📘 1\. 물질 · 1\/2차시 · 점검U3 첫 차시 · 📖 8~9쪽/.test(text) && /🎒 비커/.test(text), text);
    const order = await c.evaluate((el) => {
      const pos = (sel) => {
        const n = el.querySelector(sel);
        return n ? n.getBoundingClientRect().top * 10000 + n.getBoundingClientRect().left : -1;
      };
      return [pos('[data-progress-mark]'), pos('[data-period-supplies]'), pos('[data-period-memo]')];
    });
    check('카드 차례: 진도 줄 → 준비물 → 메모', order.every((v) => v >= 0) && order[0] < order[1] && order[1] < order[2], order.join(','));
    check("진도가 있는 교시를 고칠 때는 '진도 만들기'가 없다", await (async () => {
      await c.click();
      await c.locator('input[data-slot-input]').waitFor({ timeout: 5000 });
      return (await c.locator('[data-progress-create]').count()) === 0;
    })());
    await page.keyboard.press('Escape');
    await ctx.close();
  }
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  if (t1Before) await setDoc(t1Sched, t1Before);
  else await deleteDoc(t1Sched);
  if (t3Before) await setDoc(t3Sched, t3Before);
  else await deleteDoc(t3Sched);
  await deleteDoc(t3Plan);
  await browser.close();
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
