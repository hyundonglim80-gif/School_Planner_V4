// tools/inspect-subject-timetable.mjs
//
// 18번 교과 전담 S2 '반 표기 읽기 + 시간표·수업 칸 입력' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3(교과 전담) 시간표 창: placeholder '5-2 과학', ▼ 목록 '5-1 과학'~'5-4 과학' (19번 U1부터 datalist 대신 SlotCombobox),
//     '5학년 2반 과학' → 칸을 떠나면 '5-2 과학', 엑셀식 붙여 넣기 '5 - 3 과학\t5학년4반 과학' → 정규화,
//     저장하지 않고 닫으면 서버 시간표는 그대로
//   - teacher3 하루(2026-11-03) 2교시 과목 '5-1과학' 저장 → 서버 '5-1 과학' → 처음 값으로 되돌린다
//   - 회귀: teacher(초등 담임) 시간표 칸 '3 - 2 국어'는 칸을 떠나도·저장해도 그대로 → 되돌린다
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-subject-timetable.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;
const DAY = '2026-11-03'; // 화요일 - seed: 2교시 '5-3 과학', 4교시 '5-4 과학'

async function account(email) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, `inspect-slot-${email}`);
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

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const logs = [];
async function open(as) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('dialog', (d) => d.accept());
  page.on('pageerror', (e) => logs.push(`pageerror(${as || 1}): ${e.message.slice(0, 200)}`));
  await page.goto(`${V4}${as ? `?as=${as}` : ''}`, { waitUntil: 'domcontentloaded' });
  // 보던 화면이 기억된다 - 하루 화면으로
  const day = page.getByRole('button', { name: '하루', exact: true }).first();
  await day.waitFor({ timeout: 40000 });
  await day.click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1000);
  return { ctx, page };
}
async function openTimetable(page) {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /^⏰\s*시간표/ }).click();
  await page.getByRole('button', { name: /시간표 저장/ }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1000); // 클라우드 값을 읽어 표를 채운다
}
// 전담 칸은 학년-반(data-cell) + 과목 두 칸 (2026-10-07) - 반 칸과 같은 칸의 과목 칸
const cell = (page, rc) => page.locator(`input[data-cell="${rc}"]`);
const subjOf = (page, rc) => cell(page, rc).locator('xpath=ancestor::*[@data-slot-pair][1]').locator('input[data-slot-subject-input]');
const pairValue = async (page, rc) => `${await cell(page, rc).inputValue()} ${await subjOf(page, rc).inputValue()}`.trim();
async function typeAndLeave(page, rc, text) {
  await cell(page, rc).fill(text);
  await cell(page, rc).evaluate((el) => el.blur());
  await page.waitForTimeout(200);
  return cell(page, rc).inputValue();
}
/** 엑셀에서 복사한 줄처럼 붙여 넣는다 */
async function pasteInto(page, rc, text) {
  await cell(page, rc).evaluate((el, t) => {
    el.focus();
    const dt = new DataTransfer();
    dt.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
  }, text);
  await page.waitForTimeout(300);
}
/** ▼ 목록(SlotCombobox, 19번 U1 - 예전 datalist). 명렬표 구독이 늦게 올 수 있다 - n개가 될 때까지 기다린다 */
const waitOptions = (page, n) =>
  page.waitForFunction((k) => document.querySelectorAll('[data-combobox-list] [data-combobox-option]').length >= k, n, { timeout: 8000 }).catch(() => {});
const comboOptions = (page) =>
  page.locator('[data-combobox-list] [data-combobox-option]').evaluateAll((os) => os.map((o) => o.getAttribute('data-combobox-option')));
/** 시간표 문서를 처음 값으로 (없었으면 지운다) */
async function restore(r, before) {
  if (before) await setDoc(r, before);
  else await deleteDoc(r);
}

const tt3 = t3.ref('settings', 'timetable_v5');
const tt1 = t1.ref('settings', 'timetable_v5');
const day3 = t3.ref('schedules', DAY);
const tt3Before = await t3.read(tt3);
const tt1Before = await t1.read(tt1);
const day3Before = await t3.read(day3);

try {
  // ── teacher3: 시간표 창 ──────────────────────────────────────
  {
    const { ctx, page } = await open(3);
    await openTimetable(page);
    check("teacher3: 시간표 칸은 두 칸 - placeholder '학년-반'·'과목'", (await cell(page, '0-1').getAttribute('placeholder')) === '학년-반' && (await subjOf(page, '0-1').getAttribute('placeholder')) === '과목');
    check('teacher3: 두 칸 모두 ▼ 콤보', (await cell(page, '0-1').getAttribute('role')) === 'combobox' && (await subjOf(page, '0-1').getAttribute('role')) === 'combobox');
    // 표는 화살표로 칸을 옮겨 다녀서 들어갈 때 목록을 열지 않는다 - ▼로 연다
    await cell(page, '0-1').click();
    check('teacher3: 시간표 칸에 들어가도 목록은 닫혀 있다', (await page.locator('[data-combobox-list]').count()) === 0);
    await cell(page, '0-1').locator('xpath=..').locator('[data-combobox-toggle]').click();
    await waitOptions(page, 4);
    const opts = await comboOptions(page);
    check("teacher3: 반 ▼ 목록 '5-1'~'5-4'", ['5-1', '5-2', '5-3', '5-4'].every((o) => opts.includes(o)), opts.join(','));
    await page.keyboard.press('Escape');
    await subjOf(page, '0-1').click();
    await subjOf(page, '0-1').locator('xpath=..').locator('[data-combobox-toggle]').click();
    await waitOptions(page, 1);
    check("teacher3: 과목 ▼ 목록에 '과학'", (await comboOptions(page)).includes('과학'), (await comboOptions(page)).join(','));
    await page.keyboard.press('Escape');

    const v1 = await typeAndLeave(page, '0-1', '5학년 2반');
    await subjOf(page, '0-1').fill('과학');
    await page.waitForTimeout(200);
    check("teacher3: 반 '5학년 2반' → 칸을 떠나면 '5-2', 과목 '과학'", v1 === '5-2' && (await pairValue(page, '0-1')) === '5-2 과학', await pairValue(page, '0-1'));

    await pasteInto(page, '0-2', '5 - 3 과학\t5학년4반 과학');
    const p1 = await pairValue(page, '0-2');
    const p2 = await pairValue(page, '0-3');
    check("teacher3: 붙여 넣기 '5 - 3 과학', '5학년4반 과학' → '5-3'·'과학', '5-4'·'과학'", p1 === '5-3 과학' && p2 === '5-4 과학', `${p1} / ${p2}`);

    await page.getByTitle('닫기').first().click();
    await page.waitForTimeout(800);
    const after = await t3.read(tt3);
    check('teacher3: 저장하지 않고 닫으면 서버 시간표는 그대로', JSON.stringify(after) === JSON.stringify(tt3Before));

    // ── teacher3: 하루 화면 수업 칸 ─────────────────────────────
    await page.getByTitle(/달력에서 날짜 선택/).first().hover();
    await page.waitForTimeout(300);
    const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
    if (!(await direct.count())) {
      await page.getByTitle(/달력에서 날짜 선택/).first().click();
      await page.waitForTimeout(300);
    }
    await direct.fill(DAY);
    await page.mouse.move(5, 600);
    await page.waitForTimeout(1500);

    const card = page.locator(`[data-focus-key="period:${DAY}:2"]`);
    await card.first().waitFor({ timeout: 15000 });
    await card.first().click();
    const subj = page.locator('input[data-slot-class-input]');
    await subj.waitFor({ timeout: 5000 });
    await waitOptions(page, 4);
    const dayOpts = (await comboOptions(page)).length;
    check('teacher3: 하루 수업 칸 학년-반 입력에 ▼ 목록(네 반)', dayOpts >= 4, String(dayOpts));
    await subj.press('Escape');
    await subj.fill('5-1');
    await page.locator('input[data-slot-subject-input]').fill('과학');
    await card.first().getByRole('button', { name: '저장', exact: true }).click();
    const [d, ms] = await serverUntil(() => t3.read(day3), (v) => v?.periods?.['2']?.subject === '5-1 과학');
    const p2d = d?.periods?.['2'] || {};
    check("teacher3: 하루 2교시 반 '5-1'·과목 '과학' 저장 → 서버 '5-1 과학'", p2d.subject === '5-1 과학', `${p2d.subject} ${ms}ms`);
    check('teacher3: 다른 교시(4교시)는 그대로', d?.periods?.['4']?.subject === '5-4 과학', d?.periods?.['4']?.subject);

    // 주간 교시 칸을 눌러 여는 수정 팝업도 같은 제안 목록
    await page.getByRole('button', { name: '주간', exact: true }).first().click();
    await page.getByTitle('4교시 5-4 과학').first().click();
    const detail = page.locator('[role=dialog] input[data-slot-class-input]');
    await detail.waitFor({ timeout: 5000 }).catch(() => {});
    await detail.click();
    await waitOptions(page, 4);
    const detailOpts = (await comboOptions(page)).length;
    check('teacher3: 주간 교시 수정 팝업의 과목 칸에도 ▼ 목록', (await detail.count()) === 1 && detailOpts >= 4, String(detailOpts));
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    await ctx.close();
  }

  // ── 회귀: teacher(초등 담임) - 정규화하지 않는다 ───────────────
  {
    const { ctx, page } = await open();
    await openTimetable(page);
    check("teacher: 시간표 칸 placeholder '과목', ▼ 콤보 없음",
      (await cell(page, '0-1').getAttribute('placeholder')) === '과목' && (await page.locator('[role=combobox]').count()) === 0);
    const v = await typeAndLeave(page, '0-1', '3 - 2 국어');
    check("teacher: '3 - 2 국어'는 칸을 떠나도 그대로", v === '3 - 2 국어', v);
    await page.getByRole('button', { name: /시간표 저장/ }).click();
    const has = (t) => Object.values(t?.templates || {}).some((tpl) => tpl?.data?.mon?.['1'] === '3 - 2 국어');
    const [, ms] = await serverUntil(() => t1.read(tt1), has);
    check("teacher: 저장해도 서버에 '3 - 2 국어' 그대로", has(await t1.read(tt1)), `${ms}ms`);
    await ctx.close();
  }
} catch (e) {
  check('점검 도중 오류', false, String(e?.message || e).slice(0, 300));
} finally {
  await restore(tt3, tt3Before);
  await restore(tt1, tt1Before);
  await restore(day3, day3Before);
  await browser.close();
}

if (logs.length) console.log(logs.join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
