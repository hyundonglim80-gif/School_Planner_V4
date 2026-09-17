// 자료가 없는 계정으로 들어갔을 때, 화면이 그 사실을 말해 주는가.
// (신고 상황: 일정·D-Day·시간표·라벨이 전부 사라져 보임 = users/{uid} 전체가 빔)
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, collection, getDocsFromServer, query, limit } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = 'http://localhost:4190/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'wa');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

// teacher2 계정을 '자료 없는 계정'으로 만든다
const { user: u2 } = await signInWithEmailAndPassword(auth, 'teacher2@example.com', 'test1234');
const col2 = collection(db, 'users', u2.uid, 'events');
const existing = await getDocsFromServer(col2);
for (const d of existing.docs) await deleteDoc(d.ref);
console.log(`teacher2 일정 문서 ${existing.size}건 지움 (자료 없는 계정으로 만듦)`);

// teacher 계정은 오늘만 비워 둔다 (자료는 있는 상태)
const { user: u1 } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const p2 = (n) => String(n).padStart(2, '0');
const today = (d=>`${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`)(new Date());
await deleteDoc(doc(db, 'users', u1.uid, 'events', today)).catch(()=>{});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
async function look(url, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(12000);
  const body = await page.locator('body').innerText();
  const warned = body.includes('이 계정에는 일정이 하나도 없습니다');
  const quiet = body.includes('이 계정에 일정 자료는 있습니다');
  const empty = body.includes('오늘의 일정이 없습니다');
  console.log(`  ${tag}: 경고 ${warned ? '떴다' : '안 뜸'} / 조용한 안내 ${quiet ? '떴다' : '안 뜸'} / 하루가 비었나 ${empty ? '비었다' : '차 있다'}`);
  await page.screenshot({ path: `tools/report/acct-${tag}.png`, fullPage: true });
  await ctx.close();
  return { warned, quiet, empty };
}

console.log('\n── 자료 없는 계정으로 들어갔을 때 ──');
const a = await look(`${BASE}?as=2`, '자료없는계정');
console.log('\n── 자료는 있고 오늘만 빈 계정 ──');
const b = await look(BASE, '오늘만빈계정');

const ok = a.warned && !a.quiet && !b.warned && b.quiet;
console.log(`\n${ok ? '✔ 두 경우를 제대로 가른다' : '✘ 기대와 다르다'}`);
await browser.close(); process.exit(ok ? 0 : 1);
