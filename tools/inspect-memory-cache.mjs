// 오프라인 저장소를 못 쓰는 상태로 시작해도 앱이 제대로 도는가.
// (저장소가 잠겨 failed-precondition이 나던 상황의 해법)
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = 'http://localhost:4190/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'mc');
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
await setDoc(doc(db, 'users', user.uid, 'schedules', today), {
  periods: { 1: { subject: '405', content: '' }, 2: { subject: '406', content: '' } },
  updatedAt: Date.now(),
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();
const warns = [];
page.on('console', (m) => { if (m.text().includes('[SP4]')) warns.push(m.text().slice(0, 140)); });

// 저장소를 못 쓰는 상태로 시작하도록 표시를 심어 둔다
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.evaluate(() => sessionStorage.setItem('sp4-memory-cache', '1'));
await page.reload({ waitUntil: 'domcontentloaded' });

await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(9000);
const body = await page.locator('body').innerText();
console.log(`\n── 오프라인 저장소 없이(메모리 캐시) 시작 ──`);
console.log(`  오늘 일정  : ${body.includes(MARK) ? '✔ 보인다' : '✘ 안 보인다'}`);
console.log(`  오늘 수업  : ${body.includes('405') ? '✔ 보인다' : '✘ 안 보인다'}`);
console.log(`  경고 상자  : ${body.includes('저장 공간을 열지 못했습니다') ? '✘ 떴다(나쁨)' : '✔ 안 떴다'}`);
warns.slice(0, 4).forEach((w) => console.log(`  로그: ${w}`));
await page.screenshot({ path: 'tools/report/memory-cache.png', fullPage: true });
await browser.close(); process.exit(0);
