// tools/inspect-clear-live.mjs
//
// 지금까지의 재현은 전부 '빈 브라우저로 새로 연다'였다. 선생님이 하시는 건
// 그게 아니다. 앱을 열어 둔 채로 인터넷 사용 기록을 지우고, 그 다음에 다시 본다.
// 열려 있는 탭이 IndexedDB를 붙잡고 있는 상태에서 지우는 것이 핵심이다.
// 실제로 그때 FIRESTORE INTERNAL ASSERTION FAILED (b815)가 올라왔었다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'clr');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const p2 = (n) => String(n).padStart(2, '0');
const today = (d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`)(new Date());
const MARK = '오늘의표시일정ABC';

await setDoc(doc(db, 'users', uid, 'events', today), {
  eventList: [{ id: 'ev_mark', content: MARK, completed: false, calendar: true }],
  eventText: MARK, updatedAt: Date.now(),
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();
const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0,180)}`));
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0,180)}`));

// 1) 평소처럼 쓰던 상태
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(5000);
let body = await page.locator('body').innerText();
console.log(`\n① 평소 상태에서 오늘 일정: ${body.includes(MARK) ? '✔ 보인다' : '✘ 안 보인다'}`);

// 2) 앱을 열어 둔 채로 사이트 데이터를 지운다 (= 인터넷 사용 기록 삭제)
const cdp = await ctx.newCDPSession(page);
await cdp.send('Storage.clearDataForOrigin', {
  origin: new URL(V4).origin,
  storageTypes: 'all',
});
console.log('② 앱을 열어 둔 채로 사이트 데이터를 지웠다');
await page.waitForTimeout(3000);

// 3) 그 다음에 다시 접속한다
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(12000);
body = await page.locator('body').innerText();
const heading = await page.getByRole('heading', { name: '일정' }).count();
console.log(`③ 지운 뒤 다시 접속 — 일정 화면: ${heading ? '떴다' : '못 떴다'} / 오늘 일정: ${body.includes(MARK) ? '✔ 보인다' : '✘ 안 보인다'}`);
console.log(`   서버 확인: ${(await getDocFromServer(doc(db,'users',uid,'events',today))).exists() ? '오늘 문서 있음' : '오늘 문서 없음'}`);
await page.screenshot({ path: 'tools/report/clear-live.png', fullPage: true });

// 4) 한 번 더 새로고침하면 돌아오나 (선생님이 F5로 풀리던 그것)
await page.reload({ waitUntil: 'domcontentloaded' });
await page.waitForTimeout(10000);
body = await page.locator('body').innerText();
console.log(`④ 새로고침 한 번 더 — 오늘 일정: ${body.includes(MARK) ? '✔ 보인다' : '✘ 안 보인다'}`);

const bad = logs.filter((l) => /error|ASSERTION|denied|실패|Tc\.get|Unexpected state/i.test(l));
if (bad.length) { console.log('\n── 콘솔 ──'); [...new Set(bad)].slice(0,18).forEach((l)=>console.log('  '+l)); }
else console.log('\n(콘솔에 오류 없음)');
await browser.close(); process.exit(0);
