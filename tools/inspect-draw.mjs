// tools/inspect-draw.mjs
//
// 자리표의 발표자 뽑기(docs/ROADMAP.md 8-3)를 실제 크롬으로 누르고 서버를 확인한다.
//   - ⋮ 메뉴 '발표자 뽑기'로 열면 뽑기 칸이 펼쳐진다
//   - 한 판: 오늘 결석(4번)·전출(12번)은 안 나오고, 나올 수 있는 10명이 한 번씩 → 다 뽑으면 새 판
//   - 뽑힌 자리를 짚기(노랑)·✓, 뽑힌 차례, 서버 v4_classHub/{학급}.draw
//   - 되돌리기 · 새 판(+ 안내의 되돌리기) · 크게 보기(다음 학생 · Enter) · 다른 기기에서 뽑은 것이 보인다
//   - 자리표가 없어도 뽑는다, 그냥 '자리표'로 열면 뽑기 칸이 닫혀 있다
// 점검용 학급(2030학년도 9학년 9반)·자리표·출석부·학급 허브를 심고 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-draw.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-draw');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CLASS = { year: 2030, grade: '9', classNum: '9' };
const KEY = '2030_9_9';
const NAMES = ['가람', '나래', '다온', '라온', '마루', '바다', '사랑', '아라', '자람', '차오', '카이', '타라'];
const STUDENTS = NAMES.map((name, i) => ({ num: i + 1, name: `${name}${i + 1}`, gender: i % 2 ? 'F' : 'M', isActive: i !== 11 }));
// 1~10번은 앉고 11번은 자리 없음, 12번은 전출
const SEATS = Object.fromEntries(STUDENTS.slice(0, 10).map((s, i) => [`${Math.floor(i / 6)}-${i % 6}`, s.num]));
const SEAT_OF = Object.fromEntries(Object.entries(SEATS).map(([k, n]) => [n, k]));
const CHART_ID = 'st_inspect_draw';
/** 오늘 나올 수 있는 학생 - 4번 결석, 12번 전출 */
const POOL = [1, 2, 3, 5, 6, 7, 8, 9, 10, 11];

const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const chartRef = doc(db, 'users', uid, 'v4_seating', CHART_ID);
const attRef = doc(db, 'users', uid, 'attendance', `${KEY}_${TODAY}`);
const hubRef = doc(db, 'users', uid, 'v4_classHub', KEY);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 화면은 로컬 쓰기를 먼저 보여 주므로 서버는 기다려 읽는다 */
const until = async (read, pred, ms = 8000) => {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await read();
    if (pred(v)) return v;
    await sleep(300);
  }
  return v;
};
const serverDraw = async () => (await getDocFromServer(hubRef)).data()?.draw || { picked: [], round: 1 };
const absentDoc = (records) => ({ ...CLASS, classKey: KEY, date: TODAY, updatedAt: Date.now(), records });

async function cleanup() {
  await deleteDoc(chartRef).catch(() => {});
  await deleteDoc(attRef).catch(() => {});
  await deleteDoc(hubRef).catch(() => {});
  const now = (await getDocFromServer(rosterRef)).data();
  const list = (now?.classList || []).filter((c) => !(String(c.year) === '2030' && c.grade === '9' && c.classNum === '9'));
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
}

const run = async () => {
  await cleanup();
  const now = (await getDocFromServer(rosterRef)).data();
  const list = [...(now?.classList || []), { ...CLASS, students: STUDENTS }];
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
  await setDoc(chartRef, {
    classKey: KEY, name: '점검 자리표', rows: 2, cols: 6, groupCols: 2, front: 'top',
    seats: SEATS, off: [], locked: [], history: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  await setDoc(attRef, absentDoc({ 4: { num: 4, name: '라온4', kind: 'absent', reason: 'sick' } }));

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

  const modal = () => page.getByRole('dialog').filter({ hasText: '🪑 자리표' });
  const panel = () => page.locator('[data-seating-panel="draw"]');
  const status = () => panel().locator('[data-draw-status]').innerText();
  const toast = (text) => page.locator('#sp4-toast-container [role=status]', { hasText: text }).last();
  const pickedChips = async () =>
    (await panel().locator('[data-draw-picked-num]').evaluateAll((els) => els.map((e) => Number(e.getAttribute('data-draw-picked-num')))));
  /** 🎯 뽑기를 누르고 멈출 때까지 기다려 뽑힌 번호 */
  const pickOnce = async () => {
    const prev = await panel().locator('[data-draw-result]').getAttribute('data-draw-result');
    await panel().getByRole('button', { name: '🎯 뽑기', exact: true }).click();
    // 누르면 곧 굴리기 시작(빈 값) → 멈추면 번호
    await page.waitForFunction(
      () => document.querySelector('[data-draw-result]')?.getAttribute('data-draw-result') === '',
      null,
      { timeout: 3000 }
    ).catch(() => {});
    await page.waitForFunction(
      () => !!document.querySelector('[data-draw-result]')?.getAttribute('data-draw-result'),
      null,
      { timeout: 5000 }
    );
    const v = Number(await panel().locator('[data-draw-result]').getAttribute('data-draw-result'));
    return { num: v, prev: Number(prev) || null };
  };

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 1. ⋮ 메뉴 '발표자 뽑기'로 열기 ──
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /발표자 뽑기/ }).click();
    const classSelect = modal().getByRole('combobox', { name: '학급' }).first();
    await classSelect.waitFor({ timeout: 10000 });
    check('메뉴로 열면 뽑기 칸이 펼쳐진다', await panel().isVisible());
    await classSelect.selectOption(KEY);
    await page.locator('[data-seating-grid]').waitFor({ timeout: 10000 });
    await until(status, (t) => t.includes('결석 1명'), 6000);
    const st0 = await status();
    check('처음: 1번째 판 · 0/11명 · 남은 10명 · 결석 1명 빼고', st0.includes('1번째 판') && st0.includes('0/11명') && st0.includes('남은 10명') && st0.includes('오늘 결석 1명 빼고'), st0);

    // ── 2. 첫 뽑기 ──
    const first = await pickOnce();
    check('뽑힌 학생은 나올 수 있는 학생 중 하나', POOL.includes(first.num), String(first.num));
    let draw = await until(serverDraw, (dr) => dr.picked?.length === 1);
    // 첫 판은 round를 쓰지 않는다(없으면 1) - 다른 기기가 연 새 판을 덮지 않게 판 번호는 새 판을 열 때만 쓴다
    check('서버 학급 허브에 이번 판 [번호]', JSON.stringify(draw.picked) === JSON.stringify([first.num]) && (draw.round ?? 1) === 1, JSON.stringify(draw));
    const nowSel = first.num === 11 ? `[data-unseated-num="11"]` : `[data-seat="${SEAT_OF[first.num]}"]`;
    check('뽑힌 자리를 짚는다', (await page.locator(`${nowSel}[data-seat-drawn-now]`).count()) === 1);
    check('짚은 자리는 하나', (await page.locator('[data-seat-drawn-now]').count()) === 1);
    check('뽑힌 차례에 그 학생', JSON.stringify(await pickedChips()) === JSON.stringify([first.num]));
    const name = STUDENTS[first.num - 1].name;
    check('칸에 번호와 이름', (await panel().locator('[data-draw-result]').innerText()).includes(name));

    // ── 3. 한 판 끝까지 ──
    const seen = [first.num];
    for (let i = 1; i < POOL.length; i++) seen.push((await pickOnce()).num);
    check('한 판에 10명이 한 번씩 (겹침 없음)', new Set(seen).size === 10, seen.join(','));
    check('결석 4번·전출 12번은 안 나온다', !seen.includes(4) && !seen.includes(12));
    draw = await until(serverDraw, (dr) => dr.picked?.length === 10);
    check('서버에 뽑힌 차례 그대로', JSON.stringify(draw.picked) === JSON.stringify(seen), JSON.stringify(draw.picked));
    check('상태: 다 뽑음 - 다음은 새 판', (await status()).includes('다 뽑음'), await status());
    check('뽑힌 학생 자리에 ✓ 10개', (await page.locator('[data-seat-drawn]').count()) === 10, String(await page.locator('[data-seat-drawn]').count()));

    // ── 4. 새 판 (다 뽑은 뒤) ──
    const next = await pickOnce();
    check('다 뽑으면 새 판을 연다는 안내', await toast('새 판을 엽니다').isVisible().catch(() => false));
    draw = await until(serverDraw, (dr) => dr.round === 2);
    check('서버: 2번째 판, 뽑힌 학생 하나', draw.round === 2 && JSON.stringify(draw.picked) === JSON.stringify([next.num]), JSON.stringify(draw));
    check('새 판에서는 ✓가 하나', (await page.locator('[data-seat-drawn]').count()) === 1);

    // ── 5. 되돌리기 ──
    await panel().getByRole('button', { name: '↩️ 되돌리기' }).click();
    draw = await until(serverDraw, (dr) => (dr.picked || []).length === 0);
    check('되돌리기 → 판에서 빠진다 (판은 그대로)', draw.round === 2 && draw.picked.length === 0, JSON.stringify(draw));
    check('칸이 비고 짚은 자리도 없다', (await panel().locator('[data-draw-result]').getAttribute('data-draw-result')) === '' &&
      (await page.locator('[data-seat-drawn-now]').count()) === 0);
    check('뽑힌 학생이 없으면 새 판 단추는 꺼짐', await panel().getByRole('button', { name: '🔄 새 판' }).isDisabled());

    // ── 6. 새 판 단추 + 안내의 되돌리기 ──
    const a = await pickOnce();
    await until(serverDraw, (dr) => (dr.picked || []).length === 1);
    await panel().getByRole('button', { name: '🔄 새 판' }).click();
    draw = await until(serverDraw, (dr) => dr.round === 3);
    check('🔄 새 판 → 3번째 판, 아무도 안 뽑힘', draw.round === 3 && draw.picked.length === 0, JSON.stringify(draw));
    await toast('새 판을 열었습니다').getByRole('button', { name: '되돌리기' }).click();
    draw = await until(serverDraw, (dr) => dr.round === 2);
    check('안내의 되돌리기 → 앞 판으로', draw.round === 2 && JSON.stringify(draw.picked) === JSON.stringify([a.num]), JSON.stringify(draw));
    await until(status, (t) => t.includes('2번째 판'), 4000);
    check('상태도 2번째 판 · 1/11명', (await status()).includes('2번째 판') && (await status()).includes('1/11명'), await status());

    // ── 7. 크게 보기 ──
    await panel().getByRole('button', { name: '🔍 크게 보기' }).click();
    const big = page.locator('[data-draw-big]');
    await big.waitFor({ timeout: 4000 });
    check('크게 보기가 뜬다', await big.isVisible());
    await big.getByRole('button', { name: '🎯 다음 학생' }).click();
    await page.waitForFunction(() => !!document.querySelector('[data-draw-big-name]')?.getAttribute('data-draw-big-name'), null, { timeout: 5000 });
    const bigNum = Number(await big.locator('[data-draw-big-name]').getAttribute('data-draw-big-name'));
    check('다음 학생 → 크게 이름', POOL.includes(bigNum) && bigNum !== a.num && (await big.innerText()).includes(STUDENTS[bigNum - 1].name), String(bigNum));
    draw = await until(serverDraw, (dr) => (dr.picked || []).length === 2);
    check('크게 보기에서 뽑은 것도 판에 저장', JSON.stringify(draw.picked) === JSON.stringify([a.num, bigNum]));
    await page.keyboard.press('Enter');
    draw = await until(serverDraw, (dr) => (dr.picked || []).length === 3);
    check('Enter로 이어 뽑는다', draw.picked.length === 3, JSON.stringify(draw.picked));
    await page.waitForFunction(() => !!document.querySelector('[data-draw-big-name]')?.getAttribute('data-draw-big-name'), null, { timeout: 5000 });
    await page.screenshot({ path: 'tools/report/draw-big.png' });
    await big.getByRole('button', { name: '크게 보기 닫기' }).click();
    await page.waitForTimeout(200);
    check('✕로 크게 보기만 닫힌다', (await big.count()) === 0 && (await modal().count()) === 1 && (await panel().isVisible()));
    await page.screenshot({ path: 'tools/report/draw-panel.png' });

    // ── 8. 다른 기기에서 뽑은 것 · 결석이 늘면 ──
    const other = POOL.find((n) => !draw.picked.includes(n));
    await setDoc(hubRef, { draw: { picked: [...draw.picked, other], round: 2, updatedAt: Date.now() } }, { merge: true });
    await until(pickedChips, (l) => l.includes(other), 6000);
    check('다른 기기에서 뽑은 학생이 뽑힌 차례에 보인다', (await pickedChips()).includes(other));
    await setDoc(attRef, absentDoc({
      4: { num: 4, name: '라온4', kind: 'absent', reason: 'sick' },
      5: { num: 5, name: '마루5', kind: 'absent', reason: 'sick' },
    }));
    await until(status, (t) => t.includes('결석 2명'), 6000);
    check('결석이 늘면 상태에 바로 (결석 2명)', (await status()).includes('오늘 결석 2명'), await status());

    // ── 9. 그냥 '자리표'로 열면 뽑기 칸은 닫혀 있다 · 단추로 편다 ──
    await modal().getByRole('button', { name: '닫기' }).last().click();
    await page.waitForTimeout(300);
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /자리표/ }).click();
    await page.locator('[data-seating-grid]').waitFor({ timeout: 10000 });
    check("'자리표'로 열면 뽑기 칸이 닫혀 있다", (await panel().count()) === 0);
    await modal().getByRole('button', { name: '🎯 발표자 뽑기' }).click();
    check('🎯 발표자 뽑기 단추로 편다 (판은 이어서)', (await panel().isVisible()) && (await status()).includes('2번째 판'), await status());

    // ── 10. 자리표가 없어도 뽑는다 ──
    await deleteDoc(chartRef);
    await page.getByText('이 학급의 자리표가 아직 없습니다').waitFor({ timeout: 6000 });
    const noChart = await pickOnce();
    check('자리표가 없어도 뽑는다', POOL.includes(noChart.num) && noChart.num !== 5, String(noChart.num));
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/draw-error.png' }).catch(() => {});
  } finally {
    check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
    await browser.close();
    await cleanup();
  }
};

await run();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
