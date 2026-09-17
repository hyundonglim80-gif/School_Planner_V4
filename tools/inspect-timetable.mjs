// tools/inspect-timetable.mjs
//
// 신고: '시간표 마스터 모듈 & 템플릿 설정'에서 교시와 방학 기간을 저장하고
// 클라우드 저장까지 눌렀는데, 인터넷 기록을 지우면 아무것도 남아 있지 않다.
//
// 저장이 서버까지 갔는지(쓰기 문제)와, 기기를 비운 뒤 다시 읽히는지(읽기 문제)를
// 갈라서 본다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, deleteDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'tt');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const ref = doc(db, 'users', user.uid, 'settings', 'timetable_v5');

const serverSays = async () => {
  const s = await getDocFromServer(ref);
  if (!s.exists()) return '문서 없음';
  const d = s.data();
  const names = d.currentNames || [];
  const c = d.semesterConfig || {};
  return `교시 ${names.length}개 ${JSON.stringify(names)} / 여름방학 ${c.summerStart || '없음'}~${c.summerEnd || '없음'} / 템플릿 ${Object.keys(d.templates || {}).join(',')}`;
};

async function openModal(page) {
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /시간표 적용/ }).click();
  await page.getByRole('button', { name: /템플릿 클라우드 저장|불러오는 중/ }).waitFor({ timeout: 20000 });
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

await deleteDoc(ref).catch(() => {});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
await wipe(browser);

// ── 1) 저장한다 ──────────────────────────────────────────────
let ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
let page = await ctx.newPage();
const logs = [];
page.on('console', (m) => { if (/error|denied|실패/i.test(m.text())) logs.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 160)));
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await openModal(page);

await page.getByRole('button', { name: '+ 교시 추가' }).click();
await page.waitForTimeout(300);
const dateInputs = page.locator('input[type="date"]');
await dateInputs.nth(0).fill('2026-07-21');
await dateInputs.nth(1).fill('2026-08-18');
await page.getByRole('button', { name: '방학 기간 저장' }).click();
await page.waitForTimeout(2500);
console.log(`\n① 방학 기간 저장 직후 서버: ${await serverSays()}`);

await page.getByRole('button', { name: /템플릿 클라우드 저장/ }).click();
await page.waitForTimeout(3000);
console.log(`② 템플릿 클라우드 저장 직후 서버: ${await serverSays()}`);
await page.screenshot({ path: 'tools/report/tt-after-save.png' });
await ctx.close();

// ── 2) 기기를 비우고 다시 연다 ────────────────────────────────
await wipe(browser);
ctx = await browser.newContext({ viewport: { width: 1400, height: 1000 } });
page = await ctx.newPage();
page.on('console', (m) => { if (/error|denied|실패/i.test(m.text())) logs.push(m.text().slice(0, 160)); });
page.on('pageerror', (e) => logs.push('pageerror: ' + e.message.slice(0, 160)));
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await openModal(page);
await page.waitForTimeout(3000);
const shown = await page.locator('input[type="date"]').first().inputValue().catch(() => '(없음)');
const periodRows = await page.locator('text=/^\d+교시$/').count().catch(() => -1);
console.log(`\n③ 기기를 비운 뒤 서버: ${await serverSays()}`);
console.log(`④ 기기를 비운 뒤 화면의 여름방학 시작일: ${shown}`);
await page.screenshot({ path: 'tools/report/tt-after-wipe.png' });

if (logs.length) { console.log('\n── 콘솔 ──'); [...new Set(logs)].slice(0, 12).forEach((l) => console.log('  ' + l)); }
await browser.close(); process.exit(0);
