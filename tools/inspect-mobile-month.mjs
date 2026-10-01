// tools/inspect-mobile-month.mjs
//
// ROADMAP 15 휴대폰 월간 - 바뀐 부분만, 휴대폰 폭(390px) 크롬으로 본다 (이 항목이 휴대폰 것이라 이 폭만).
//   - 과목 칩을 그리지 않는다, 기간 일정 막대는 휴대폰 칸에도
//   - 날짜를 누르면 아래 탭바 위에 그날 목록(수업·일정), 칸에 테, 다른 날을 누르면 그날로
//   - 목록의 일정 → 오른쪽 일정 칸, 같은 날 한 번 더 → 하루 화면, ✕ 닫기, 달을 넘기면 닫힘
//   이번 달 셋째 주에 점검 기간 일정·일정을 심었다가 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-mobile-month.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-mobile-month');
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const t0 = new Date();
t0.setHours(0, 0, 0, 0);
const first = new Date(t0.getFullYear(), t0.getMonth(), 1);
const sun2 = new Date(first);
sun2.setDate(1 + ((7 - first.getDay()) % 7) + 7);
const at = (n) => {
  const d = new Date(sun2);
  d.setDate(sun2.getDate() + n);
  return ymd(d);
};
const A = [at(3), at(4), at(5)];
const ONE = at(2);
const evRef = (d) => doc(db, 'users', uid, 'events', d);
const schRef = (d) => doc(db, 'users', uid, 'schedules', d);
const originals = new Map();
const pieces = new Map();
A.forEach((d, i) => pieces.set(d, [{ id: `ev_mm_${i}`, content: `점검폰기간 (${i + 1}/3)`, completed: false, groupId: 'group_mm', period: true }]));
pieces.set(ONE, [{ id: 'ev_mm_one', content: '점검폰일정 긴 제목도 그날 목록에서는 끝까지 보인다', completed: false, label: '달력', labelIds: ['ev_1'] }]);
let origSch = null;

async function seed() {
  for (const [d, list] of pieces) {
    const orig = (await getDocFromServer(evRef(d))).data() || null;
    originals.set(d, orig);
    const base = (orig?.eventList || []).filter((e) => !String(e.id).startsWith('ev_mm_'));
    await setDoc(evRef(d), { eventList: [...base, ...list], updatedAt: Date.now() }, { merge: true });
  }
  origSch = (await getDocFromServer(schRef(ONE))).data() || null;
  await setDoc(schRef(ONE), { periods: { 1: { subject: '점검국어' }, 2: { subject: '점검수학' } }, updatedAt: Date.now() }, { merge: true });
}
async function restore() {
  for (const [d, orig] of originals) {
    if (orig) await setDoc(evRef(d), orig);
    else await deleteDoc(evRef(d)).catch(() => {});
  }
  if (origSch) await setDoc(schRef(ONE), origSch);
  else await deleteDoc(schRef(ONE)).catch(() => {});
}
await seed();

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
const tab = (name) => page.locator('nav.fixed').getByText(name, { exact: true });
const cell = (d) => page.locator(`[data-date="${d}"]`);
const sheet = page.locator('[data-month-day-sheet]');

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await tab('월간').click();
  await page.locator('[data-month-week]').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(800);

  check('과목 칩을 그리지 않는다', (await page.locator('[data-date] [title$="교시)"]').count()) === 0);
  check('기간 일정 막대는 휴대폰에도', (await page.locator('[data-period-bar^="group_mm|"]').count()) === 1);

  await cell(ONE).click();
  await sheet.waitFor({ timeout: 5000 });
  check('날짜를 누르면 그날 목록, 칸에 테', (await sheet.getAttribute('data-month-day-sheet')) === ONE && (await cell(ONE).getAttribute('data-selected')) === 'true');
  check('그날 수업이 목록에', (await sheet.locator('[data-sheet-classes]').innerText()).includes('점검국어'));
  const evBtn = sheet.locator('[data-sheet-event="ev_mm_one"]');
  check('일정은 잘리지 않고 끝까지', (await evBtn.innerText()).includes('끝까지 보인다'));
  const sb = await sheet.boundingBox();
  const nb = await page.locator('nav.fixed').boundingBox();
  check('아래 탭바 위에 붙는다', Math.abs(sb.y + sb.height - nb.y) <= 2, `목록 아래 ${Math.round(sb.y + sb.height)} / 탭바 위 ${Math.round(nb.y)}`);
  await page.screenshot({ path: 'tools/report/mobile-month-sheet.png' });

  await cell(A[1]).click();
  await page.waitForTimeout(300);
  check('다른 날을 누르면 그날로', (await sheet.getAttribute('data-month-day-sheet')) === A[1] && (await sheet.innerText()).includes('점검폰기간 (2/3)'));

  await cell(ONE).click();
  await page.waitForTimeout(300);
  await sheet.locator('[data-sheet-event="ev_mm_one"]').click();
  // 휴대폰에서 일정 칸은 오른쪽에서 덮는 칸이다 (PC의 aside가 아니다)
  await page.getByRole('heading', { name: '일정 수정' }).waitFor({ timeout: 10000 });
  const val = await page.getByPlaceholder('새로운 일정을 입력하세요...').inputValue();
  check('목록의 일정 → 일정 칸', val.startsWith('점검폰일정'), val);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  await sheet.getByTitle('닫기').click();
  await page.waitForTimeout(300);
  check('✕ 로 닫는다', (await sheet.count()) === 0);

  await cell(ONE).click();
  await sheet.waitFor({ timeout: 5000 });
  await page.getByRole('button', { name: '다음' }).or(page.locator('button:has-text("▶")')).first().click();
  await page.waitForTimeout(800);
  check('달을 넘기면 닫힌다', (await sheet.count()) === 0);
  await page.getByRole('button', { name: '이전' }).or(page.locator('button:has-text("◀")')).first().click();
  await page.waitForTimeout(800);

  await cell(ONE).click();
  await sheet.waitFor({ timeout: 5000 });
  await cell(ONE).click();
  await page.waitForTimeout(1000);
  check('같은 날을 한 번 더 → 하루 화면', (await page.locator('[data-month-week]').count()) === 0 && (await sheet.count()) === 0);
} catch (e) {
  check('예상 못 한 오류', false, String(e).slice(0, 300));
  await page.screenshot({ path: 'tools/report/mobile-month-error.png' }).catch(() => {});
} finally {
  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await tab('하루').click().catch(() => {});
  await page.waitForTimeout(300);
  await browser.close();
  await restore();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
