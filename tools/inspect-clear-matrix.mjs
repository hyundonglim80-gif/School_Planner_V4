// 어떤 저장소가 살아남을 때 오늘 일정이 안 보이는지 하나씩 갈라 본다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = 'http://localhost:4190/School_Planner_V4/';
const ORIGIN = new URL(V4).origin;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'mx');
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

const ALL = ['local_storage','cookies','cache_storage','service_workers','indexeddb','websql','shader_cache'];
const CASES = [
  { tag: '전부지움',            keep: [] },
  { tag: 'SW와SW캐시만살아남음', keep: ['cache_storage','service_workers'] },
  { tag: 'SW캐시만살아남음',     keep: ['cache_storage'] },
  { tag: 'IndexedDB만살아남음',  keep: ['indexeddb'] },
  { tag: '쿠키만살아남음',       keep: ['cookies'] },
];

const browser = await chromium.launch({ channel: 'chrome', headless: true });
console.log('\n── 무엇이 살아남으면 깨지는가 ──');
for (const c of CASES) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  // 1) 평소처럼 한 번 쓴다 (캐시와 서비스워커가 자리잡는다)
  let page = await ctx.newPage();
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 }).catch(()=>{});
  await page.waitForTimeout(6000);
  // 2) 탭을 열어 둔 채로 지운다 (일부는 못 지우고 넘어간 상황)
  const cdp = await ctx.newCDPSession(page);
  const types = ALL.filter((t) => !c.keep.includes(t)).join(',');
  await cdp.send('Storage.clearDataForOrigin', { origin: ORIGIN, storageTypes: types });
  await page.close();
  // 3) 다시 들어간다
  page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0,120)));
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  const up = await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 30000 }).then(()=>true).catch(()=>false);
  await page.waitForTimeout(9000);
  const body = up ? await page.locator('body').innerText() : '';
  const seen = body.includes(MARK);
  console.log(`  ${seen ? '✔' : '✘'} ${c.tag.padEnd(22)} 일정화면 ${up ? '뜸' : '못뜸'}${errs.length ? ' / 오류 ' + errs[0] : ''}`);
  if (!seen) await page.screenshot({ path: `tools/report/mx-${c.tag}.png`, fullPage: true });
  await ctx.close();
}
await browser.close(); process.exit(0);
