// tools/inspect-undo.mjs
//
// 안내의 '되돌리기' 단추(docs/ROADMAP.md 6번 첫 일)를 실제 크롬으로 눌러 보고, 서버에 남은 모습을 확인한다.
//   - 하루 화면에서 일정·기록을 지우고 되돌리기 → 그 날 그 자리에 돌아오고 휴지통에서 빠진다
//   - 일정 칸에서 날짜를 옮기고 되돌리기 → 원래 날짜로, 칸도 따라간다
//   - 다중 선택 완료·삭제 뒤 되돌리기 → 완료가 풀리고 지운 것이 돌아온다
//   - 메모 완료·삭제 뒤 되돌리기
//   - 안내에 마우스를 올려 두면 사라지지 않는다
//
//   npm run emu                (다른 창)
//   node tools/serve-both.mjs  (다른 창 - 또는 npx vite preview --port 4173 와 SITE=http://localhost:4173)
//   VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-undo.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'undo');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const p2 = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const plus = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ds(d);
};
const today = ds(new Date());
const RUN = Date.now().toString(36);
const DEL = '지웠다 되돌릴 일정 ' + RUN;
const MOVE = '옮겼다 되돌릴 일정 ' + RUN;
const MA = '여럿 가 ' + RUN;
const MB = '여럿 나 ' + RUN;
const STAY = '그대로 남을 일정 ' + RUN;
const JR = '지웠다 되돌릴 기록 ' + RUN;
const MEMO = '되돌릴 메모 ' + RUN;
const MEMO_ID = 'memo_undo_' + RUN;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

async function seed() {
  const list = [
    { id: 'ev_u_stay', content: STAY, completed: false },
    { id: 'ev_u_del', content: DEL, completed: false },
    { id: 'ev_u_move', content: MOVE, completed: false },
    { id: 'ev_u_ma', content: MA, completed: false },
    { id: 'ev_u_mb', content: MB, completed: false },
  ];
  await setDoc(doc(db, 'users', uid, 'events', today), {
    eventList: list,
    eventText: list.map((e) => e.content).join('\n'),
    updatedAt: Date.now(),
  });
  await setDoc(doc(db, 'users', uid, 'journals', today), {
    entries: [{ id: 'jr_u_del', content: JR, createdAt: Date.now() }],
    updatedAt: Date.now(),
  });
  // 즐겨찾기로 두어 메모 화면 첫 모습에 보이게
  await setDoc(doc(db, 'users', uid, 'tasks', MEMO_ID), {
    text: MEMO,
    content: MEMO,
    completed: false,
    favorite: true,
    order: -Date.now(),
    createdAt: Date.now(),
    labels: [],
    attachments: [],
    linkedItems: [],
  });
}

const events = async (date) => (await getDocFromServer(doc(db, 'users', uid, 'events', date))).data()?.eventList || [];
const has = async (date, id) => (await events(date)).some((e) => e.id === id);
/** 화면은 로컬 쓰기를 먼저 보여 준다 - 서버 확인은 기다려 읽는다 */
async function serverUntil(fn, ms = 8000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    if (await fn()) return true;
    await new Promise((r) => setTimeout(r, 300));
  }
  return false;
}

const run = async () => {
  await seed();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  const toast = (text) => page.locator('#sp4-toast-container [role=status]', { hasText: text }).last();
  const undo = async (text) => {
    const t = toast(text);
    await t.waitFor({ timeout: 15000 });
    await t.getByRole('button', { name: '되돌리기' }).click();
  };
  const clearToasts = () => page.evaluate(() => document.getElementById('sp4-toast-container')?.replaceChildren());

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByText(DEL).first().waitFor({ timeout: 20000 });

  // ── 1. 일정 지우기 → 되돌리기 ──
  const delRow = page.locator('[data-focus-key]', { hasText: DEL }).first();
  await delRow.hover();
  await delRow.getByTitle('일정 삭제').click();
  await toast('일정을 삭제했습니다').waitFor({ timeout: 15000 });
  check('지우면 안내에 되돌리기 단추가 붙는다', await toast('일정을 삭제했습니다').getByRole('button', { name: '되돌리기' }).isVisible());
  await page.screenshot({ path: 'tools/report/undo-toast.png' });
  check('서버에서 빠졌다', await serverUntil(async () => !(await has(today, 'ev_u_del'))));
  await undo('일정을 삭제했습니다');
  await toast('되살렸습니다').waitFor({ timeout: 15000 });
  check('되돌리기 → 그 날에 같은 id로 돌아왔다', await serverUntil(() => has(today, 'ev_u_del')));
  check('화면에도 다시 보인다', await page.getByText(DEL).first().isVisible().catch(() => false));
  const order = (await events(today)).map((e) => e.id);
  check('그날 다른 일정은 그대로', order.includes('ev_u_stay') && order.includes('ev_u_ma'), JSON.stringify(order));
  await page.screenshot({ path: 'tools/report/undo-delete.png' });
  await clearToasts();

  // ── 2. 기록 지우기 → 되돌리기 ──
  const jrCard = page.locator('[data-focus-key]', { hasText: JR }).first();
  await jrCard.hover();
  await jrCard.getByTitle('기록 삭제').click();
  await undo('기록을 삭제했습니다');
  await toast('되살렸습니다').waitFor({ timeout: 15000 });
  const jr = async () => ((await getDocFromServer(doc(db, 'users', uid, 'journals', today))).data()?.entries || []).some((e) => e.id === 'jr_u_del');
  check('기록: 되돌리기 → 돌아왔다', await serverUntil(jr));
  await clearToasts();

  // ── 3. 칸에서 날짜 옮기기 → 되돌리기 ──
  const to = plus(3);
  await page.getByText(MOVE).first().click();
  const panel = page.getByRole('complementary', { name: '일정 쓰기' });
  await panel.getByLabel('일정 날짜').waitFor({ timeout: 10000 });
  await panel.getByLabel('일정 날짜').fill(to);
  await panel.getByRole('button', { name: '옮기고 저장' }).click();
  check('옮겼다', await serverUntil(() => has(to, 'ev_u_move')));
  await undo('옮겼습니다');
  await toast('되돌렸습니다').waitFor({ timeout: 15000 });
  check('옮기기: 되돌리기 → 원래 날짜로', await serverUntil(async () => (await has(today, 'ev_u_move')) && !(await has(to, 'ev_u_move'))));
  await page.waitForTimeout(800);
  check('고치던 칸도 원래 날짜로 따라갔다', (await panel.getByLabel('일정 날짜').inputValue()) === today);
  await panel.getByRole('button', { name: '닫기' }).click();
  await clearToasts();

  // ── 4. 다중 선택: 완료 → 되돌리기, 삭제 → 되돌리기 ──
  const pick = async () => {
    await page.getByRole('button', { name: /더보기|⋮/ }).first().click();
    await page.getByText(/^여러 개 고르기$/).first().click();
    await page.getByText(MA).first().click();
    await page.getByText(MB).first().click();
  };
  await pick();
  await page.getByTitle('선택 일정 일괄 완료 처리').click();
  const done = async (v) => (await events(today)).filter((e) => e.id === 'ev_u_ma' || e.id === 'ev_u_mb').every((e) => !!e.completed === v);
  check('다중 선택 완료', await serverUntil(() => done(true)));
  await undo('완료로 표시했습니다');
  await toast('되돌렸습니다').waitFor({ timeout: 15000 });
  check('다중 선택 완료: 되돌리기 → 둘 다 완료가 풀렸다', await serverUntil(() => done(false)));
  await clearToasts();

  await pick();
  await page.getByTitle('선택 일정 일괄 삭제').click();
  check('다중 선택 삭제', await serverUntil(async () => !(await has(today, 'ev_u_ma')) && !(await has(today, 'ev_u_mb'))));
  await undo('2건을 삭제했습니다');
  await toast('되살렸습니다').waitFor({ timeout: 15000 });
  check('다중 선택 삭제: 되돌리기 → 둘 다 돌아왔다', await serverUntil(async () => (await has(today, 'ev_u_ma')) && (await has(today, 'ev_u_mb'))));
  await clearToasts();

  // ── 5. 마우스를 올려 두면 안내가 사라지지 않는다 ──
  const delRow2 = page.locator('[data-focus-key]', { hasText: DEL }).first();
  await delRow2.hover();
  await delRow2.getByTitle('일정 삭제').click();
  const t = toast('일정을 삭제했습니다');
  await t.waitFor({ timeout: 15000 });
  await t.hover();
  await page.waitForTimeout(8500); // 그냥 두면 7초 뒤 사라진다
  check('마우스를 올려 둔 동안은 안내가 남아 있다', await t.isVisible());
  await t.getByRole('button', { name: '되돌리기' }).click();
  check('그 뒤에 눌러도 되살린다', await serverUntil(() => has(today, 'ev_u_del')));
  await clearToasts();

  // ── 6. 메모: 완료 → 되돌리기, 삭제 → 되돌리기 ──
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  const card = page.locator('[data-focus-key]', { hasText: MEMO }).first();
  await card.waitFor({ timeout: 15000 });
  const memo = async () => (await getDocFromServer(doc(db, 'users', uid, 'tasks', MEMO_ID))).data();
  await card.locator('input[type=checkbox]').first().click();
  check('메모 완료', await serverUntil(async () => (await memo())?.completed === true));
  await undo('메모를 완료로 옮겼습니다');
  await toast('진행으로 되돌렸습니다').waitFor({ timeout: 15000 });
  check('메모 완료: 되돌리기 → 진행으로', await serverUntil(async () => (await memo())?.completed === false));
  await clearToasts();
  const card2 = page.locator('[data-focus-key]', { hasText: MEMO }).first();
  await card2.hover();
  await card2.getByTitle('삭제', { exact: true }).click();
  check('메모 삭제', await serverUntil(async () => !(await memo())));
  await undo('메모를 삭제했습니다');
  await toast('되살렸습니다').waitFor({ timeout: 15000 });
  check('메모 삭제: 되돌리기 → 돌아왔다', await serverUntil(async () => (await memo())?.content === MEMO));
  await page.screenshot({ path: 'tools/report/undo-memo.png' });

  if (logs.length) {
    console.log('\n── 콘솔 ──');
    logs.slice(0, 10).forEach((l) => console.log('  ' + l));
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
};
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
