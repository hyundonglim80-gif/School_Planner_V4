// tools/inspect-memo-open.mjs
//
// 메모 화면을 열 때의 거르개(docs/ROADMAP.md 6-5)를 실제 크롬으로 본다.
//   - 즐겨찾기한 메모가 하나도 없으면 ⭐ 즐겨찾기를 기억해 두었어도 '전체 메모'로 연다
//   - 손으로 ⭐를 누르면 빈 즐겨찾기와 ☆ 안내
//   - ☆를 하나 붙여 두면 다음에 열 때 즐겨찾기로 연다
// 테스트 계정 메모의 즐겨찾기를 잠시 떼었다가 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-memo-open.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, collection, doc, getDocsFromServer, updateDoc, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'memo-open');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const MEMO_ID = 'memo_open_check';
const MEMO_TEXT = `즐겨찾기 없을 때 점검 메모 ${uid.slice(0, 6)}`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const run = async () => {
  // 즐겨찾기를 모두 떼고(끝에 되돌린다), 보일 메모 하나를 심는다
  const tasks = collection(db, 'users', uid, 'tasks');
  const favIds = (await getDocsFromServer(tasks)).docs.filter((d) => d.data().favorite).map((d) => d.id);
  for (const id of favIds) await updateDoc(doc(tasks, id), { favorite: false });
  await setDoc(doc(tasks, MEMO_ID), { text: MEMO_TEXT, content: MEMO_TEXT, labels: [], favorite: false, completed: false, createdAt: Date.now(), order: -Date.now() });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  const nav = () => page.getByRole('navigation', { name: '메모 라벨 거르개' });
  const chip = (name) => nav().getByRole('button', { name: new RegExp(name) });
  const reopenMemo = async () => {
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 10000 });
    await page.getByRole('button', { name: '메모', exact: true }).first().click();
    await nav().waitFor({ timeout: 10000 });
    await page.waitForTimeout(800);
  };

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '메모', exact: true }).first().click();
    await nav().waitFor({ timeout: 10000 });

    // ── 1. ⭐를 손으로 고르면 빈 즐겨찾기와 안내 (이것이 기억된다) ──
    await chip('⭐ 즐겨찾기').click();
    check('⭐를 누르면 즐겨찾기가 골라진다', (await chip('⭐ 즐겨찾기').getAttribute('aria-pressed')) === 'true');
    check('빈 즐겨찾기에 ☆ 안내가 보인다', await page.getByText(/즐겨찾기한 메모가 없습니다/).isVisible());

    // ── 2. 다른 화면에 갔다 오면: 즐겨찾기가 없으니 전체로 연다 ──
    await reopenMemo();
    check('즐겨찾기가 없으면 전체 메모로 연다', (await chip('전체 메모').getAttribute('aria-pressed')) === 'true');
    check('메모가 보인다(빈 화면이 아니다)', await page.getByText(MEMO_TEXT).first().isVisible());
    await page.screenshot({ path: 'tools/report/memo-open-all.png' });

    // ── 3. ☆를 붙여 두면 다음에는 즐겨찾기로 연다 ──
    await updateDoc(doc(tasks, MEMO_ID), { favorite: true });
    await page.waitForTimeout(800);
    check('보던 중에 ☆가 붙어도 화면은 그대로 전체', (await chip('전체 메모').getAttribute('aria-pressed')) === 'true');
    await reopenMemo();
    check('즐겨찾기가 생기면 다음에는 즐겨찾기로 연다', (await chip('⭐ 즐겨찾기').getAttribute('aria-pressed')) === 'true');
    check('즐겨찾기 메모가 보인다', await page.getByText(MEMO_TEXT).first().isVisible());
  } finally {
    // 되돌리기: 심은 메모는 지우고, 원래 즐겨찾기를 되붙인다
    await deleteDoc(doc(tasks, MEMO_ID));
    for (const id of favIds) await updateDoc(doc(tasks, id), { favorite: true });
  }

  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과 (즐겨찾기 ${favIds.length}개 되돌림)`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
