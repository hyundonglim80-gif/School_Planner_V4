// tools/inspect-add-forward.mjs
//
// 신고: 지난 날짜에 이월 일정을 등록하면 '팝업이 닫히는 순간' 오늘로 이월되어야
// 하는데, 새로고침을 해야 이월됐다. 그리고 그때 비로소 다른 오늘 일정도 나타났다.
//
// 기기를 비운 직후(= 사용기록 삭제 직후)의 차가운 상태에서, 새로고침 없이
// 지난 날짜에 이월 일정을 만들어 보고 오늘 문서가 실제로 바뀌는지 본다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = 'http://localhost:4190/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'af');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const p2 = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`;
const today = ds(new Date());
const back3 = ds(new Date(Date.now() - 3 * 86400000));
const OLD = '전에 묶여 있던 이월 일정';
const NEW = '방금 만든 이월 일정';

await setDoc(doc(db, 'users', uid, 'settings', 'labels'), {
  eventLabels: [
    { id: 'lbl_ev_a', name: '회의', color: 'blue', isForward: false },
    { id: 'lbl_ev_b', name: 'ToDo', color: 'orange', isForward: true },
  ], updatedAt: Date.now(),
});
// 오래전부터 이월되지 못하고 묶여 있던 일정 하나 (신고의 '다른 오늘 일정')
await setDoc(doc(db, 'users', uid, 'events', ds(new Date(Date.now() - 9 * 86400000))), {
  eventList: [{ id: 'ev_old', content: OLD, completed: false, label: 'ToDo', labelIds: ['lbl_ev_b'], forward: false, calendar: true }],
  eventText: OLD, updatedAt: Date.now(),
});
await deleteDoc(doc(db, 'users', uid, 'events', back3)).catch(()=>{});
await deleteDoc(doc(db, 'users', uid, 'events', today)).catch(()=>{});

const todayList = async () => {
  const s = await getDocFromServer(doc(db, 'users', uid, 'events', today));
  return (s.data()?.eventList || []).map((e) => e.content);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
// 기기를 비운 상태에서 시작
let page = await ctx.newPage();
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => {
  localStorage.clear(); sessionStorage.clear();
  if (indexedDB.databases) for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name);
  if (window.caches) for (const k of await caches.keys()) await caches.delete(k);
});
await page.close();

page = await ctx.newPage();
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(9000);
console.log(`\n① 앱을 켜고 가만히 두었을 때 오늘 문서: ${JSON.stringify(await todayList())}`);

// 지난 날짜로 이동 (◀ 세 번)
for (let i = 0; i < 3; i++) { await page.getByRole('button', { name: '이전 날짜' }).or(page.locator('button:has-text("◀")')).first().click(); await page.waitForTimeout(700); }
await page.waitForTimeout(2000);

// 새 일정 + ToDo 라벨로 등록
await page.getByRole('button', { name: '+ 새 일정' }).click();
await page.getByPlaceholder('새로운 일정을 입력하세요...').fill(NEW);
await page.getByRole('button', { name: 'ToDo', exact: true }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: '저장', exact: true }).click();

// 새로고침하지 않는다. 폼이 닫힌 뒤 기다리기만 한다.
await page.waitForTimeout(9000);
const after = await todayList();
console.log(`② 새로고침 없이, 저장만 한 뒤 오늘 문서: ${JSON.stringify(after)}`);
console.log(`   방금 만든 것이 왔나      : ${after.some(c=>c.includes(NEW)) ? '✔' : '✘'}`);
console.log(`   묶여 있던 것도 같이 왔나 : ${after.some(c=>c.includes(OLD)) ? '✔' : '✘'}`);
await page.screenshot({ path: 'tools/report/add-forward.png', fullPage: true });
await browser.close(); process.exit(0);
