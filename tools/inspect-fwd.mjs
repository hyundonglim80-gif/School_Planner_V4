// tools/inspect-fwd.mjs — 과거 일정의 '모양'을 바꿔 가며 무엇이 이월되는지 본다
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'fwd');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const p2 = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const today = ds(new Date()); const past = ds(new Date(Date.now() - 3 * 86400000));

const CASES = [
  { id: 'a', content: 'A_라벨이름+forward거짓', label: 'ToDo', labelIds: ['lbl_ev_b'], forward: false },
  { id: 'b', content: 'B_라벨이름만_forward없음', label: 'ToDo', labelIds: ['lbl_ev_b'] },
  { id: 'c', content: 'C_라벨id만_forward없음', labelIds: ['lbl_ev_b'] },
  { id: 'd', content: 'D_forward참', forward: true },
];

await setDoc(doc(db, 'users', uid, 'settings', 'labels'), {
  eventLabels: [
    { id: 'lbl_ev_a', name: '회의', color: 'blue', isForward: false },
    { id: 'lbl_ev_b', name: 'ToDo', color: 'orange', isForward: true },
  ], updatedAt: Date.now(),
});
await setDoc(doc(db, 'users', uid, 'events', past), {
  eventList: CASES.map((c) => ({ id: 'ev_' + c.id, completed: false, calendar: true, ...c })),
  eventText: CASES.map((c) => c.content).join('\n'), updatedAt: Date.now(),
});
await deleteDoc(doc(db, 'users', uid, 'events', today)).catch(() => {});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
let ctx = await browser.newContext(); let page = await ctx.newPage();
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.evaluate(async () => { localStorage.clear(); sessionStorage.clear();
  if (indexedDB.databases) for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name); });
await ctx.close();

ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
page = await ctx.newPage();
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
await page.waitForTimeout(9000);
const snap = await getDocFromServer(doc(db, 'users', uid, 'events', today));
const moved = (snap.data()?.eventList || []).map((e) => e.content);
console.log('\n── 오늘로 이월된 것 ──');
for (const c of CASES) console.log(`  ${moved.some((m) => m.includes(c.content)) ? '✔' : '✘'} ${c.content}`);
await browser.close(); process.exit(0);
