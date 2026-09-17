// tools/inspect-watchdog.mjs
//
// 두 가지를 본다.
//  1) 평소에는 감시가 괜히 끼어들지 않는가 (새로고침이 일어나면 안 된다)
//  2) Firestore가 조용히 멈춘 상태에서는 스스로 캐시를 비우고 살아나는가
//
// 2번은 Firestore로 가는 통신을 막아 '아무 답도 없는' 상태를 흉내 낸다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = 'http://localhost:4190/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'wd');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const p2 = (n) => String(n).padStart(2, '0');
const today = (d=>`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`)(new Date());
const MARK = '오늘의표시일정ABC';
await setDoc(doc(db, 'users', user.uid, 'events', today), {
  eventList: [{ id: 'ev_mark', content: MARK, completed: false, calendar: true }],
  eventText: MARK, updatedAt: Date.now(),
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });

// ── 1) 평소 ────────────────────────────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  let reloads = 0;
  page.on('framenavigated', (f) => { if (f === page.mainFrame()) reloads++; });
  const warns = [];
  page.on('console', (m) => { if (m.text().includes('아무 답도')) warns.push(m.text()); });
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(18000); // 감시 시간(10초)을 충분히 넘긴다
  const body = await page.locator('body').innerText();
  console.log(`\n① 평소: 오늘 일정 ${body.includes(MARK) ? '✔ 보인다' : '✘ 안 보인다'} / 화면 이동 ${reloads}회 / 감시 경고 ${warns.length}건`);
  console.log(`   ${reloads <= 1 && warns.length === 0 ? '✔ 감시가 괜히 끼어들지 않는다' : '✘ 괜히 끼어들었다'}`);
  await ctx.close();
}

// ── 2) Firestore가 조용히 멈춘 상태 ─────────────────────────
{
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  // Firestore 통신만 통째로 삼킨다(응답도 오류도 주지 않는다)
  let blocking = true;
  await ctx.route('**://127.0.0.1:8080/**', async (route) => {
    if (blocking) return; // 아무 응답도 주지 않고 매달아 둔다
    await route.continue();
  });
  const page = await ctx.newPage();
  const warns = [];
  page.on('console', (m) => { if (m.text().includes('아무 답도')) warns.push(m.text()); });
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(16000);
  console.log(`\n② 멈춘 상태: 감시가 알아차렸나 ${warns.length > 0 ? '✔ 알아차렸다' : '✘ 못 알아차렸다'}`);
  if (warns[0]) console.log(`   ${warns[0].slice(0, 120)}`);
  await ctx.close();
}

await browser.close(); process.exit(0);
