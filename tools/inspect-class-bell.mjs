// tools/inspect-class-bell.mjs
//
// 수업 종 (2026-10-07) - 실제 크롬으로 본다 (PC 1400px, teacher). 시계는 Playwright clock으로 돌린다.
//   - 시간표 창 '🔔 수업 종 울리기' 칸: 켜기·시작 1분 전 고르기 → 서버 v4_classBell
//   - 월요일 08:58:50에서 시계를 돌리면 08:59:00(1교시 1분 전)에 종 + 안내 '1교시 시작 (1분 전)'
//   - 끝 종(09:40 정각) / '이 기기에서 울리기'를 끄면 울리지 않는다
// 점검이 바꾼 교시 시각·종 설정은 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-class-bell.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-bell');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uref = (...p) => doc(db, 'users', user.uid, ...p);
const read = async (r) => {
  const s = await getDocFromServer(r);
  return s.exists() ? s.data() : null;
};
async function until(fn, ok, timeout = 10000) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 300));
    v = await fn();
  }
  return v;
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const timesRef = uref('settings', 'v4_periodTimes');
const bellRef = uref('settings', 'v4_classBell');
const before = { times: await read(timesRef), bell: await read(bellRef) };

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
async function open(atIso) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  if (atIso) await page.clock.install({ time: new Date(atIso) });
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  return { ctx, page };
}

try {
  await setDoc(timesRef, { times: { '1': { start: '09:00', end: '09:40' }, '2': { start: '09:50', end: '10:30' } }, updatedAt: Date.now() });
  await deleteDoc(bellRef);

  // ── 설정 칸 ──
  {
    const { ctx, page } = await open();
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /^⏰\s*시간표/ }).click();
    const panel = page.locator('[data-class-bell]');
    await panel.waitFor();
    await panel.locator('[data-bell-enabled]').check();
    await until(() => read(bellRef), (d) => d?.enabled === true);
    await panel.locator('[data-bell-amount="start"]').fill('1');
    await page.waitForTimeout(800);
    await panel.locator('[data-bell-when="start"]').selectOption('before');
    const saved = await until(() => read(bellRef), (d) => d?.start?.amount === 1 && d?.start?.when === 'before');
    check("시간표 창 '수업 종': 켜기·시작 1분 전 → 서버", saved?.enabled === true && saved?.start?.amount === 1 && saved?.start?.unit === 'min' && saved?.end?.on === true, JSON.stringify(saved));
    await page.waitForTimeout(1500);
    await ctx.close();
  }

  // ── 시계를 돌려 종 ──
  {
    const { ctx, page } = await open('2026-10-12T08:58:40'); // 월요일
    await page.waitForTimeout(2000);
    await page.clock.runFor(25000); // 08:59:05 쯤
    await page.waitForTimeout(500);
    const count = await page.evaluate(() => window.__spBellCount || 0);
    const last = await page.evaluate(() => window.__spBellLast || '');
    check("월 08:59:00(1교시 1분 전)에 종 + 안내 '1교시 시작 (1분 전)'", count === 1 && /1교시 시작 \(1분 전\)/.test(last), `count ${count} ${last}`);
    await page.clock.runFor(41 * 60 * 1000); // 09:40:05 쯤
    await page.waitForTimeout(500);
    const count2 = await page.evaluate(() => window.__spBellCount || 0);
    const last2 = await page.evaluate(() => window.__spBellLast || '');
    check('09:40 정각 끝 종 (그사이 다른 종 없음)', count2 === 2 && /1교시 끝/.test(last2), `count ${count2} ${last2}`);
    await ctx.close();
  }

  // ── 이 기기에서 끄기 ──
  {
    const { ctx, page } = await open('2026-10-12T09:49:50');
    await page.evaluate(() => localStorage.setItem('sp4-class-bell-muted', '1'));
    await page.clock.runFor(20000);
    await page.waitForTimeout(500);
    check("'이 기기에서 울리기'를 끄면 울리지 않는다", (await page.evaluate(() => window.__spBellCount || 0)) === 0);
    await ctx.close();
  }
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await browser.close();
  if (before.times) await setDoc(timesRef, before.times);
  else await deleteDoc(timesRef);
  if (before.bell) await setDoc(bellRef, before.bell);
  else await deleteDoc(bellRef);
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
