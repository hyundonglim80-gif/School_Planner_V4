// tools/inspect-partial-clear.mjs
//
// 선생님 관찰: 사용기록을 '한 번' 지우고 V4에 들어가면 오늘 일정이 안 나오는데,
// '두 번' 지우고 들어가면 잘 나온다.
//
// 두 번 지워야 낫는다는 건 첫 번째 삭제가 덜 지워진다는 뜻이다. 지우는 순간
// V4 탭이 열려 있으면 그 탭이 IndexedDB를 붙잡고 있어, 브라우저가 그 데이터베이스는
// 지우지 못하고 넘어간다(삭제가 blocked 된다). 그러면 localStorage/쿠키는 사라졌는데
// Firestore의 오프라인 캐시만 살아남는 어긋난 상태가 된다.
//
// 그 상태를 그대로 만들어 본다: indexeddb만 빼고 전부 지운다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = 'http://localhost:4190/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'pc');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const p2 = (n) => String(n).padStart(2, '0');
const today = (d => `${d.getFullYear()}-${p2(d.getMonth()+1)}-${p2(d.getDate())}`)(new Date());
const MARK = '오늘의표시일정ABC';

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function openAndLook(ctx, tag) {
  const page = await ctx.newPage();
  const logs = [];
  page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0,160)}`));
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0,160)}`));
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  const ok = await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 }).then(()=>true).catch(()=>false);
  await page.waitForTimeout(10000);
  const body = ok ? await page.locator('body').innerText() : '';
  console.log(`  ${tag}: 일정화면 ${ok ? '떴다' : '못 떴다'} / 오늘 일정 ${body.includes(MARK) ? '✔ 보인다' : '✘ 안 보인다'}`);
  await page.screenshot({ path: `tools/report/pc-${tag}.png` });
  const bad = [...new Set(logs.filter((l)=>/error|ASSERTION|denied|실패|Tc\.get/i.test(l)))];
  if (bad.length) bad.slice(0,6).forEach((l)=>console.log('      ' + l));
  return { page, ok, seen: body.includes(MARK) };
}

// 오늘 일정을 서버에 둔다
await setDoc(doc(db, 'users', uid, 'events', today), {
  eventList: [{ id: 'ev_mark', content: MARK, completed: false, calendar: true }],
  eventText: MARK, updatedAt: Date.now(),
});

const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
console.log('\n[1] 평소처럼 한 번 쓴다 (캐시가 만들어진다)');
const first = await openAndLook(ctx, '1-정상');

console.log('\n[2] 탭을 열어 둔 채 지운다 — IndexedDB는 잠겨 못 지워진 상황을 그대로 만든다');
const cdp = await ctx.newCDPSession(first.page);
await cdp.send('Storage.clearDataForOrigin', {
  origin: new URL(V4).origin,
  // indexeddb 를 일부러 뺀다 = 브라우저가 그것만 못 지우고 넘어간 상태
  storageTypes: 'local_storage,cookies,cache_storage,service_workers,websql,shader_cache',
});
await first.page.close();
await openAndLook(ctx, '2-한번지움');

console.log('\n[3] 한 번 더 지운다 (이번엔 IndexedDB까지) — 선생님이 두 번 지웠을 때');
const page3 = await ctx.newPage();
await page3.goto('about:blank');
const cdp3 = await ctx.newCDPSession(page3);
await cdp3.send('Storage.clearDataForOrigin', { origin: new URL(V4).origin, storageTypes: 'all' });
await page3.close();
await openAndLook(ctx, '3-두번지움');

await browser.close(); process.exit(0);
