// tools/inspect-check-lines.mjs
//
// 메모 카드의 체크 줄(docs/ROADMAP.md 6-6)을 실제 크롬으로 본다.
//   - '☐ 우유' 줄을 누르면 서버 글에서 그 줄만 ☑ 로 바뀐다 (다른 줄·V3가 읽는 text도)
//   - 누르는 것으로 메모 쓰는 칸이 열리지 않는다, 다시 누르면 ☐ 로
//   - 체크 줄이 아닌 곳을 누르면 지금처럼 쓰는 칸이 열린다
// Keep 목록 모양의 메모 하나를 심었다가 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-check-lines.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'check-lines');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const memoRef = doc(db, 'users', user.uid, 'tasks', 'memo_check_lines');
const TEXT = '체크 줄 점검 장보기\n☐ 우유\n  ☑ 식빵 두 봉\n☐ 계란 https://example.com';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
/** 화면은 로컬 쓰기를 먼저 보여 주므로 서버는 기다려 읽는다 */
const serverUntil = async (pred, ms = 8000) => {
  const end = Date.now() + ms;
  let data;
  while (Date.now() < end) {
    data = (await getDocFromServer(memoRef)).data();
    if (pred(data)) return data;
    await new Promise((r) => setTimeout(r, 300));
  }
  return data;
};

const run = async () => {
  await setDoc(memoRef, { text: TEXT, content: TEXT, labels: [], favorite: true, completed: false, createdAt: Date.now(), order: -Date.now() });
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '메모', exact: true }).first().click();
    const nav = page.getByRole('navigation', { name: '메모 라벨로 보기' });
    await nav.waitFor({ timeout: 10000 });
    await nav.getByRole('button', { name: /전체 메모/ }).click();

    const card = page.locator('[data-focus-key]').filter({ hasText: '체크 줄 점검 장보기' });
    await card.waitFor({ timeout: 10000 });
    const milk = card.getByRole('checkbox', { name: '☐ 우유' });
    check('☐ 줄은 체크하지 않은 체크 칸', (await milk.getAttribute('aria-checked')) === 'false');
    check('☑ 줄은 체크한 칸', (await card.getByRole('checkbox', { name: /식빵/ }).getAttribute('aria-checked')) === 'true');

    // ── 1. 누르면 그 줄만 ☑ ──
    await milk.click();
    const after = await serverUntil((d) => d?.text?.includes('☑ 우유'));
    check('서버 글에서 그 줄만 ☑ 로 바뀌었다', after?.text === TEXT.replace('☐ 우유', '☑ 우유'), JSON.stringify(after?.text));
    check('text·content 둘 다 같은 글 (V3는 text를 읽는다)', after?.text === after?.content);
    check('누르는 것으로 쓰는 칸이 열리지 않는다', (await page.getByRole('complementary', { name: '메모 쓰기' }).count()) === 0);
    await card.getByRole('checkbox', { name: '☑ 우유' }).waitFor({ timeout: 5000 });
    check('화면에도 ☑ 로 체크되어 보인다', (await card.getByRole('checkbox', { name: '☑ 우유' }).getAttribute('aria-checked')) === 'true');
    await page.screenshot({ path: 'tools/report/check-lines.png' });

    // ── 2. 다시 누르면 ☐ ──
    await card.getByRole('checkbox', { name: '☑ 우유' }).click();
    const back = await serverUntil((d) => d?.text === TEXT);
    check('다시 누르면 처음 글로 돌아온다', back?.text === TEXT, JSON.stringify(back?.text));

    // ── 3. 링크가 든 줄도, 줄 밖을 누르면 쓰는 칸 ──
    await card.getByRole('checkbox', { name: /계란/ }).click({ position: { x: 4, y: 6 } });
    const egg = await serverUntil((d) => d?.text?.includes('☑ 계란'));
    check('링크가 든 줄도 체크된다(링크는 그대로)', egg?.text?.endsWith('☑ 계란 https://example.com'), JSON.stringify(egg?.text));
    await card.getByText('체크 줄 점검 장보기').click();
    await page.getByRole('complementary', { name: '메모 쓰기' }).waitFor({ timeout: 5000 }).catch(() => {});
    check('체크 줄이 아닌 곳을 누르면 쓰는 칸이 열린다', (await page.getByRole('complementary', { name: '메모 쓰기' }).count()) === 1);
    await page.keyboard.press('Escape');
  } finally {
    await deleteDoc(memoRef);
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
