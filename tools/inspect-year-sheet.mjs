// tools/inspect-year-sheet.mjs
//
// ROADMAP 14 년간을 학사력 한 장으로 - 바뀐 부분만 실제 크롬으로 본다.
//   - 년간은 처음에 '📅 학사력': 열두 달 작은 달력, 수업 칩 없음, 공휴일 빨강·D-Day 고리·학사일정·달력 일정 점, 기간은 막대
//   - 달 아래 목록: 공휴일·D-Day·기간(처음 날 한 번, ~끝날)·일정, 누르면 오른쪽 일정 칸 / 달 이름 → 그 달 월간
//   - 학기 칩, 주말 끄기(다섯 칸), '📋 자세히'로 예전 모양(이 기기에 남는다), 🖨️ 인쇄(A4 가로, 넉 달씩)
//   이번 달 셋째·넷째 주에 점검 기간 일정·일정 하나, D-Day 하나를 심었다가 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-year-sheet.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-year-sheet');
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
const AY = t0.getMonth() >= 2 ? t0.getFullYear() : t0.getFullYear() - 1;
const first = new Date(t0.getFullYear(), t0.getMonth(), 1);
const sun2 = new Date(first);
sun2.setDate(1 + ((7 - first.getDay()) % 7) + 7);
const at = (n) => {
  const d = new Date(sun2);
  d.setDate(sun2.getDate() + n);
  return ymd(d);
};
const md = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
// 기간: 수·목·금 | 월·화 (달력 라벨), 일정 하나 (달력 라벨), D-Day 하나
const A = [at(3), at(4), at(5), at(8), at(9)];
const ONE = at(2);
const DDAY = at(11);

const evRef = (d) => doc(db, 'users', uid, 'events', d);
const prefRef = doc(db, 'users', uid, 'settings', 'preferences');
const originals = new Map();
const pieces = new Map();
A.forEach((d, i) => {
  const content = `점검학사기간 (${i + 1}/${A.length})`;
  pieces.set(d, [{ id: `ev_ys_${i}`, content, completed: false, groupId: 'group_ys_a', period: true, label: '달력', labelIds: ['ev_1'] }]);
});
pieces.set(ONE, [...(pieces.get(ONE) || []), { id: 'ev_ys_one', content: '점검학사일정', completed: false, label: '달력', labelIds: ['ev_1'] }]);
let origPref = null;

async function seed() {
  for (const [d, list] of pieces) {
    const orig = (await getDocFromServer(evRef(d))).data() || null;
    originals.set(d, orig);
    const base = (orig?.eventList || []).filter((e) => !String(e.id).startsWith('ev_ys_'));
    await setDoc(evRef(d), { eventList: [...base, ...list], updatedAt: Date.now() }, { merge: true });
  }
  origPref = (await getDocFromServer(prefRef)).data() || null;
  const list = (origPref?.dDayList || []).filter((x) => x.id !== 'dd_ys');
  await setDoc(prefRef, { dDayList: [...list, { id: 'dd_ys', title: '점검학사디데이', date: DDAY }] }, { merge: true });
}
async function restore() {
  for (const [d, orig] of originals) {
    if (orig) await setDoc(evRef(d), orig);
    else await deleteDoc(evRef(d)).catch(() => {});
  }
  const now = (await getDocFromServer(prefRef)).data() || {};
  await setDoc(prefRef, { dDayList: (now.dDayList || []).filter((x) => x.id !== 'dd_ys') }, { merge: true });
}
await seed();

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
await ctx.addInitScript(() => {
  window.print = () => {};
});
const thisMonth = page.locator(`[data-sheet-month="${t0.getFullYear()}-${t0.getMonth() + 1}"]`);
const dateCell = (d) => page.locator(`[data-sheet-date="${d}"]`);

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '년간', exact: true }).first().click();
  await page.locator('[data-year-sheet]').waitFor({ timeout: 15000 });
  await page.waitForFunction(() => document.querySelectorAll('[data-sheet-month]').length === 12, null, { timeout: 15000 }).catch(() => {});

  check('년간은 처음에 학사력, 열두 달', (await page.locator('[data-sheet-month]').count()) === 12 &&
    (await page.locator('[data-year-view="sheet"]').getAttribute('aria-pressed')) === 'true');
  check('수업 칩은 그리지 않는다', (await page.locator('[data-year-sheet] [title$="교시)"]').count()) === 0);
  const sheetBox = await page.locator('[data-year-sheet]').boundingBox();
  const cardBox = await page.locator('[data-sheet-month]').first().boundingBox();
  check('1400px에서 넉 달씩', Math.round(sheetBox.width / cardBox.width) === 4, `${Math.round(sheetBox.width)} / ${Math.round(cardBox.width)}`);

  await thisMonth.scrollIntoViewIfNeeded();
  await page.locator('[data-sheet-bar="group_ys_a"]').first().waitFor({ timeout: 10000 });
  check('기간은 막대 (주가 바뀌어 둘)', (await page.locator('[data-sheet-bar="group_ys_a"]').count()) === 2);
  const periodItem = thisMonth.locator('[data-sheet-item="period"]', { hasText: '점검학사기간' });
  check('목록: 기간은 처음 날 한 번, ~끝날', (await periodItem.count()) === 1 && (await periodItem.innerText()).includes(`~${md(A[4])}`), await periodItem.innerText().catch(() => ''));
  const ddayItem = thisMonth.locator('[data-sheet-item="dday"]', { hasText: '점검학사디데이' });
  check('D-Day: 목록과 날짜 고리', (await ddayItem.count()) === 1 && /ring-amber/.test(await dateCell(DDAY).locator('span').first().getAttribute('class')));
  const dots = await dateCell(ONE).locator('span.rounded-full.w-\\[4px\\]').count();
  check('달력 일정은 날짜 칸에 점', dots >= 1, `${dots}개`);
  check('풍선에 그날 것', (await dateCell(A[1]).getAttribute('title')).includes('📆 점검학사기간'), await dateCell(A[1]).getAttribute('title'));

  // 공휴일 (이 학년도 3·1절)
  const mar1 = page.locator(`[data-sheet-month="${AY}-3"] [data-sheet-item="holiday"]`).first();
  check('공휴일은 목록에 빨갛게', (await mar1.count()) === 1 && /3\.?1절|삼일절/.test(await mar1.innerText()), await mar1.innerText().catch(() => ''));

  // 목록이 길면 '+N개 더'로 펼친다. 목록의 일정을 누르면 오른쪽 일정 칸
  const more = thisMonth.getByRole('button', { name: /개 더$/ });
  if (await more.count()) {
    await more.click();
    check('+N개 더 → 펼친다', await thisMonth.locator('[data-sheet-item="event"]', { hasText: '점검학사일정' }).first().isVisible());
  }
  await thisMonth.locator('[data-sheet-item="event"]', { hasText: '점검학사일정' }).first().click();
  const panel = page.locator('aside[aria-label="일정 쓰기"]');
  await panel.waitFor({ timeout: 10000 });
  check('목록의 일정 → 오른쪽 일정 칸', (await panel.getByPlaceholder('새로운 일정을 입력하세요...').inputValue()) === '점검학사일정');
  await panel.getByPlaceholder('새로운 일정을 입력하세요...').press('Escape');
  await page.waitForTimeout(400);

  // 학기 칩
  await page.getByRole('button', { name: '1학기', exact: true }).click();
  await page.waitForTimeout(800);
  const s1 = await page.locator('[data-sheet-month]').count();
  await page.getByRole('button', { name: '전체', exact: true }).click();
  await page.waitForTimeout(800);
  check('1학기 칩 → 그 학기 달만', s1 === 6, `${s1}달`);

  // 주말 끄기 → 다섯 칸
  await page.getByRole('button', { name: '주말', exact: true }).click();
  await page.waitForTimeout(800);
  const colsOff = await thisMonth.locator('[data-sheet-date]').first().evaluate((el) => getComputedStyle(el.parentElement).gridTemplateColumns.split(' ').length);
  await page.getByRole('button', { name: '주말', exact: true }).click();
  await page.waitForTimeout(800);
  check('주말을 끄면 다섯 칸', colsOff === 5, String(colsOff));

  // 인쇄
  await page.locator('[data-year-print]').click();
  const title = await page.locator('#sp4-print-root .sp4-print-title').innerText();
  const rule = await page.evaluate(() => document.getElementById('sp4-print-root-page')?.textContent || '');
  check('🖨️ 인쇄 → A4 가로, 학년도 학사력', /landscape/.test(rule) && title === `${AY}학년도 학사력`, title);
  await page.emulateMedia({ media: 'print' });
  const printCols = await page.locator('#sp4-print-root [data-year-sheet]').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const hiddenExtra = await page.locator('#sp4-print-root [data-sheet-extra]').count();
  const extraShown = hiddenExtra === 0 || (await page.locator('#sp4-print-root [data-sheet-extra]').first().evaluate((el) => getComputedStyle(el).display)) !== 'none';
  await page.setViewportSize({ width: 1123, height: 794 });
  await page.screenshot({ path: 'tools/report/year-sheet-print.png', fullPage: false });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.emulateMedia({ media: 'screen' });
  check('인쇄 모양: 넉 달씩, 접어 둔 목록 줄도', printCols === 4 && extraShown, `${printCols}열, 접힌 줄 ${hiddenExtra}`);
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

  await page.screenshot({ path: 'tools/report/year-sheet.png' });

  // 달 이름 → 그 달 월간
  await thisMonth.getByRole('button', { name: `${t0.getMonth() + 1}월`, exact: true }).click();
  await page.waitForTimeout(1200);
  check('달 이름 → 그 달 월간', (await page.getByText(`${t0.getFullYear()}년 ${t0.getMonth() + 1}월`).count()) > 0 && (await page.locator('[data-month-week]').count()) > 0);

  // 자세히 → 예전 모양, 다시 열어도 자세히 (이 기기)
  await page.getByRole('button', { name: '년간', exact: true }).first().click();
  await page.locator('[data-year-view="detail"]').click();
  await page.getByRole('button', { name: '+ 일정' }).first().waitFor({ timeout: 10000 });
  check('📋 자세히 → 예전 모양(날마다 수업·일정)', (await page.locator('[data-year-sheet]').count()) === 0);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '년간', exact: true }).first().click();
  await page.locator('[data-year-view="detail"][aria-pressed="true"]').waitFor({ timeout: 15000 });
  check('다시 열어도 자세히 (이 기기에 남는다)', (await page.locator('[data-year-sheet]').count()) === 0);
  await page.locator('[data-year-view="sheet"]').click();
  await page.locator('[data-year-sheet]').waitFor({ timeout: 10000 });
} catch (e) {
  check('예상 못 한 오류', false, String(e).slice(0, 300));
  await page.screenshot({ path: 'tools/report/year-sheet-error.png' }).catch(() => {});
} finally {
  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await page.getByRole('button', { name: '하루', exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await browser.close();
  await restore();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
