// tools/inspect-today.mjs
//
// 신고 그대로를 재현한다: 서버에는 오늘 일정이 멀쩡히 있고, 기기만 비운 뒤
// V3를 열지 않고 V4만 연다. 그때 오늘 일정이 보이는가?
//
//   npm run emu                (다른 창)
//   node tools/serve-both.mjs  (다른 창)
//   node tools/inspect-today.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'today');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const p2 = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const today = ds(new Date());
const past = ds(new Date(Date.now() - 3 * 86400000));

const PLAIN = '오늘 일반 일정 도박중독 추방의 날';
const FWD = 'V4에서 만든 이월 일정';

async function seed() {
  await setDoc(doc(db, 'users', uid, 'settings', 'labels'), {
    eventLabels: [
      { id: 'lbl_ev_a', name: '회의', color: 'blue', isForward: false },
      { id: 'lbl_ev_b', name: 'ToDo', color: 'orange', isForward: true },
    ],
    updatedAt: Date.now(),
  });
  // 오늘: 평범한 일정 하나. 이월이 만들 수 없는 것.
  await setDoc(doc(db, 'users', uid, 'events', today), {
    eventList: [{ id: 'ev_plain_today', content: PLAIN, completed: false, calendar: true }],
    eventText: PLAIN,
    updatedAt: Date.now(),
  });
  // 과거: V4가 만든 모양 그대로 — 이월 라벨이 붙었는데 forward는 false로 굳어 있다
  await setDoc(doc(db, 'users', uid, 'events', past), {
    eventList: [{ id: 'ev_v4_fwd', content: FWD, completed: false, label: 'ToDo', labelIds: ['lbl_ev_b'], forward: false, calendar: true }],
    eventText: FWD,
    updatedAt: Date.now(),
  });
}

async function wipe(browser) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    localStorage.clear(); sessionStorage.clear();
    if (indexedDB.databases) for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name);
    if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
  });
  await ctx.close();
}

const run = async () => {
  await seed();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  await wipe(browser);

  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(9000); // 이월이 돌고 화면이 정착할 시간

  const body = await page.locator('body').innerText();
  await page.screenshot({ path: 'tools/report/today-v4-only.png', fullPage: true });

  const serverToday = await getDocFromServer(doc(db, 'users', uid, 'events', today));
  const serverList = (serverToday.data()?.eventList || []).map((e) => e.content);

  console.log('\n──── V3를 열지 않고 V4만 연 결과 ────');
  console.log(`오늘 일반 일정이 화면에 보이나 : ${body.includes('도박중독') ? '✔ 보인다' : '✘ 안 보인다'}`);
  console.log(`라벨칩(ToDo/회의)이 보이나    : ${['회의', 'ToDo'].filter((n) => body.includes(n)).join(', ') || '✘ 없음'}`);
  console.log(`이월 일정이 오늘로 왔나       : ${body.includes(FWD) ? '✔ 왔다' : '✘ 안 왔다'}`);
  console.log(`서버의 오늘 문서             : ${JSON.stringify(serverList)}`);
  const noisy = logs.filter((l) => /error|Error|실패|denied/.test(l));
  if (noisy.length) { console.log('\n── 콘솔 ──'); noisy.slice(0, 15).forEach((l) => console.log('  ' + l)); }

  await browser.close();
  process.exit(0);
};
run().catch((e) => { console.error(e); process.exit(1); });
