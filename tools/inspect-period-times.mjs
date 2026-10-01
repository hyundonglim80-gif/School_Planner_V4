// tools/inspect-period-times.mjs
//
// 교시 시각과 '지금 몇 교시'(docs/ROADMAP.md 2-2)를 실제 크롬으로 확인한다.
// 시간표 설정(⚙️)의 '빠르게 채우기'로 1교시가 지금 10분 전에 시작한 것으로 채워 저장하고,
// 하루 화면의 1교시에 '지금 · 30분 남음'이, 주간의 오늘 카드에 지금 교시 짚기가 보이는지 본다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-period-times.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, deleteDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'period-times');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const ref = doc(db, 'users', user.uid, 'settings', 'v4_periodTimes');

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const p2 = (n) => String(n).padStart(2, '0');
const start = new Date(Date.now() - 10 * 60 * 1000);
const firstStart = `${p2(start.getHours())}:${p2(start.getMinutes())}`;

await deleteDoc(ref).catch(() => {});
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '수업' }).first().waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);
check('시각을 적기 전에는 지금 표시가 없다', (await page.locator('[data-now-line]').count()) === 0);

await page.getByRole('button', { name: '⚙️ 설정' }).first().click();
const box = page.locator('[data-period-times]');
await box.waitFor({ timeout: 10000 });
await box.getByLabel('빠르게 채우기 - 1교시 시작').fill(firstStart);
await box.getByLabel('수업 길이(분)').fill('40');
await box.getByRole('button', { name: '채우기' }).click();
check('채우기로 1교시가 채워진다', (await box.getByLabel('1교시 시작', { exact: true }).inputValue()) === firstStart);
await box.getByRole('button', { name: '교시 시각 저장' }).click();
await page.getByText('교시 시각을 저장했습니다').first().waitFor({ timeout: 10000 });
await page.screenshot({ path: 'tools/report/period-times-editor.png' });
const saved = (await getDoc()).times;
async function getDoc() {
  const s = await getDocFromServer(ref);
  return s.data() || {};
}
check('V4 전용 문서에 저장됐다', saved?.['1']?.start === firstStart, JSON.stringify(saved?.['1']));
await page.keyboard.press('Escape');
await page.waitForTimeout(1500);

const line = page.locator('[data-now-line]');
await line.waitFor({ timeout: 10000 });
const lineText = await line.innerText();
check('수업 칸 제목 줄에 지금 1교시', /지금 1교시/.test(lineText), lineText);
const nowCard = page.locator('[data-now="true"]').first();
check('1교시 카드에 지금 · N분 남음', /지금 · 3[01]분 남음/.test(await nowCard.innerText()), (await nowCard.innerText()).split('\n').slice(0, 3).join(' '));
await page.screenshot({ path: 'tools/report/period-times-day.png' });

await page.getByRole('button', { name: '주간', exact: true }).first().click();
await page.waitForTimeout(2000);
check('주간의 오늘 카드도 지금 교시를 짚는다', (await page.locator('[data-today="true"] [data-now="true"]').count()) === 1);

await browser.close();
const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
