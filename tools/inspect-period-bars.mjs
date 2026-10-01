// tools/inspect-period-bars.mjs
//
// ROADMAP 13 기간 일정을 막대로 - 바뀐 부분만 실제 크롬으로 본다.
//   - 월간: 나란한 날의 조각이 한 막대(칸을 건너 이어짐), 주가 바뀌면 다음 줄에서 이어짐, 겹치면 다른 줄,
//     V3가 만든 조각(period 표시 없음)도 막대, 조각은 날짜 칸 안에 따로 나오지 않는다, 막대의 그날 조각을 누르면 그 조각을 고친다
//   - 년간: 처음 날에 한 번만 범위와 함께, 나머지 날에는 조각이 없다
//   이번 달 셋째·넷째 주에 점검 기간 일정을 심었다가 처음 모습으로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-period-bars.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-period-bars');
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
// 이번 달 둘째 일요일 다음의 수요일 = 달력 셋째 줄쯤 (언제 돌려도 이번 달 안)
const first = new Date(t0.getFullYear(), t0.getMonth(), 1);
const sun2 = new Date(first);
sun2.setDate(1 + ((7 - first.getDay()) % 7) + 7);
const at = (n) => {
  const d = new Date(sun2);
  d.setDate(sun2.getDate() + n);
  return ymd(d);
};
// A: 수·목·금 | (토·일 건너뜀) | 월·화 - 5일, V4 모양(period: true), '달력' 라벨
const A = [at(3), at(4), at(5), at(8), at(9)];
// B: 목·금 - A와 겹친다, 라벨 없음
const B = [at(4), at(5)];
// C: V3가 만든 모양 (period 표시 없음) - 다음 주 수·목
const C = [at(10), at(11)];
const NAME_A = '점검시험';
const NAME_B = '점검체험';
const NAME_C = '점검방학';

const evRef = (d) => doc(db, 'users', uid, 'events', d);
const originals = new Map();
const pieces = new Map();
const add = (dates, name, group, extra) =>
  dates.forEach((d, i) => {
    const content = `${name} (${i + 1}/${dates.length})`;
    if (!pieces.has(d)) pieces.set(d, []);
    pieces.get(d).push({ id: `ev_pb_${group}_${i}`, content, text: content, completed: false, groupId: `group_pb_${group}`, date: d, ...extra });
  });
add(A, NAME_A, 'a', { period: true, label: '달력', labelIds: ['ev_1'] });
add(B, NAME_B, 'b', { period: true, label: '', labelIds: [] });
add(C, NAME_C, 'c', { label: '', labelIds: [] });

async function seed() {
  for (const [d, list] of pieces) {
    const orig = (await getDocFromServer(evRef(d))).data() || null;
    originals.set(d, orig);
    const base = (orig?.eventList || []).filter((e) => !String(e.id).startsWith('ev_pb_'));
    await setDoc(evRef(d), { eventList: [...base, ...list], updatedAt: Date.now() }, { merge: true });
  }
}
async function restore() {
  for (const [d, orig] of originals) {
    if (orig) await setDoc(evRef(d), orig);
    else await deleteDoc(evRef(d)).catch(() => {});
  }
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
const box = async (loc) => (await loc.boundingBox()) || { x: 0, y: 0, width: 0, height: 0 };

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });

  // ── 월간 ──
  await page.getByRole('button', { name: '월간', exact: true }).first().click();
  const barA = page.locator('[data-period-bar="group_pb_a|점검시험|5"]');
  await barA.first().waitFor({ timeout: 15000 });
  check('A: 주가 바뀌어 막대 둘 (수~금, 월~화)', (await barA.count()) === 2, String(await barA.count()));

  const cell = (d) => page.locator(`[data-date="${d}"]`);
  const a1 = await box(barA.nth(0));
  const wed = await box(cell(A[0]));
  const fri = await box(cell(A[2]));
  check('A 첫 막대가 수·목·금 칸을 건너 이어진다', Math.abs(a1.x - wed.x) < 8 && Math.abs(a1.x + a1.width - (fri.x + fri.width)) < 8,
    `막대 ${Math.round(a1.x)}~${Math.round(a1.x + a1.width)} / 칸 ${Math.round(wed.x)}~${Math.round(fri.x + fri.width)}`);
  check('A 첫 막대는 뒤로 이어짐, 둘째는 앞에서 이어짐',
    (await barA.nth(0).getAttribute('title')).includes('뒤로 이어짐') && (await barA.nth(1).getAttribute('title')).includes('앞에서 이어짐'));
  check('막대에 본문과 며칠째 (1~3/5)', /점검시험/.test(await barA.nth(0).innerText()) && (await barA.nth(0).innerText()).includes('1~3/5'), await barA.nth(0).innerText());
  check('날짜 칸 안에는 조각이 따로 없다', (await cell(A[1]).getByText(/점검시험 \(\d\/5\)/).count()) === 0);

  const barB = page.locator('[data-period-bar="group_pb_b|점검체험|2"]');
  const b1 = await box(barB.first());
  check('B: 겹치는 기간은 다른 줄', (await barB.count()) === 1 && Math.abs(b1.y - a1.y) >= 10, `A y=${Math.round(a1.y)} B y=${Math.round(b1.y)}`);
  const thu = await box(cell(A[1]));
  check('B는 목·금 칸에', Math.abs(b1.x - thu.x) < 8 && Math.abs(b1.x + b1.width - (fri.x + fri.width)) < 8);

  const barC = page.locator('[data-period-bar="group_pb_c|점검방학|2"]');
  check('C: V3 모양(period 표시 없음)도 막대', (await barC.count()) === 1);

  // 막대의 목요일 조각을 누르면 그 조각(2/5)을 고친다
  await barA.nth(0).locator(`[data-period-cell="${A[1]}"]`).click();
  const panel = page.locator('aside[aria-label="일정 쓰기"]');
  await panel.waitFor({ timeout: 10000 });
  const val = await panel.getByPlaceholder('새로운 일정을 입력하세요...').inputValue();
  check('막대의 그날 조각을 누르면 그 조각을 고친다', val === `${NAME_A} (2/5)`, val);
  await panel.getByPlaceholder('새로운 일정을 입력하세요...').press('Escape');
  await page.waitForTimeout(400);

  await page.screenshot({ path: 'tools/report/period-bars-month.png', fullPage: true });

  // 막대의 조각을 다른 날로 끌면 묶음이라 범위를 묻는다 (달력 요약이 groupId를 넘겨야 한다)
  await barA.nth(0).locator(`[data-period-cell="${A[1]}"]`).dragTo(cell(at(1)));
  const moveDlg = page.getByRole('dialog').filter({ hasText: '연결된 일정 옮기기' });
  await moveDlg.waitFor({ timeout: 8000 }).catch(() => {});
  check('조각을 끌면 묶음 범위를 묻는다', await moveDlg.isVisible());
  await moveDlg.getByRole('button', { name: '닫기' }).last().click().catch(() => {});
  await page.waitForTimeout(400);

  // ── 년간 ──
  await page.getByRole('button', { name: '년간', exact: true }).first().click();
  const monthLabel = `${t0.getMonth() + 1}월`;
  const groupA = page.locator('[data-period-group="group_pb_a"]');
  await groupA.first().waitFor({ timeout: 15000 });
  check('년간: A는 한 번만', (await groupA.count()) === 1, `${monthLabel} ${await groupA.count()}`);
  const md = (d) => `${Number(d.slice(5, 7))}.${Number(d.slice(8, 10))}`;
  const rangeA = await groupA.locator('[data-period-range]').innerText();
  check('년간: 범위와 날 수', rangeA.includes(`${md(A[0])} ~ ${md(A[4])} · 5일`) && rangeA.includes('1~5/5'), rangeA);
  const startRow = page.locator(`[data-date="${A[0]}"]`);
  check('년간: 첫날 줄에 묶음', (await startRow.locator('[data-period-group="group_pb_a"]').count()) === 1);
  check('년간: 다른 날에는 조각이 없다', (await page.getByText(/점검시험 \(\d\/5\)/).count()) === 0);
  await groupA.scrollIntoViewIfNeeded();
  await page.screenshot({ path: 'tools/report/period-bars-year.png' });
} catch (e) {
  check('예상 못 한 오류', false, String(e).slice(0, 300));
  await page.screenshot({ path: 'tools/report/period-bars-error.png' }).catch(() => {});
} finally {
  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  // 다음 점검이 하루 화면에서 시작하게
  await page.getByRole('button', { name: '하루', exact: true }).first().click().catch(() => {});
  await page.waitForTimeout(300);
  await browser.close();
  await restore();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
