// tools/inspect-seating.mjs
//
// 자리표(docs/ROADMAP.md 8-1)를 실제 크롬으로 누르고 서버를 확인한다.
//   - ⋮ 메뉴 → 자리표, 학급 고르기, 빈 학급은 '+ 자리표 만들기' → 재학생만 번호 차례로 앉는다(전출 빠짐)
//   - 끌어다 놓기로 맞바꾸기, '자리 고치기'에서 두 자리 눌러 바꾸기·고정·책상 없애기
//   - 떨어뜨릴 학생 더하기(v4_classHub), 섞기(고정 칸 그대로, 떨어뜨릴 학생 안 붙음, 남녀 짝, 지난 짝 기록) → 되돌리기
//   - 줄 줄이기 → 자리 없는 학생, 새 자리표·지우기(휴지통) → 되돌리기, 명령 창 '자리', ESC
// 점검용 학급(2030학년도 9학년 9반)을 명렬표 끝에 더하고 끝에 뺀다. 그 학급의 자리표·허브·휴지통 항목도 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-seating.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  setDoc,
  deleteDoc,
  getDocFromServer,
  getDocsFromServer,
  query,
  where,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'seating');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const CLASS = { year: 2030, grade: '9', classNum: '9' };
const KEY = '2030_9_9';
const NAMES = ['가람', '나래', '다온', '라온', '마루', '바다', '사랑', '아라', '자람', '차오', '카이', '타라'];
// 12명, 남녀 번갈아, 12번은 전출
const STUDENTS = NAMES.map((name, i) => ({
  num: i + 1,
  name: `${name}${i + 1}`,
  gender: i % 2 ? 'F' : 'M',
  isActive: i !== 11,
  note: '',
}));
const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const hubRef = doc(db, 'users', uid, 'v4_classHub', KEY);
const chartsQuery = query(collection(db, 'users', uid, 'v4_seating'), where('classKey', '==', KEY));

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
/** 화면은 로컬 쓰기를 먼저 보여 주므로 서버는 기다려 읽는다 */
const until = async (read, pred, ms = 8000) => {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await read();
    if (pred(v)) return v;
    await sleep(300);
  }
  return v;
};
const serverCharts = async () =>
  (await getDocsFromServer(chartsQuery)).docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => a.createdAt - b.createdAt);
const serverHub = async () => (await getDocFromServer(hubRef)).data() || {};
const near = (a, b) => {
  const [r1, c1] = a.split('-').map(Number);
  const [r2, c2] = b.split('-').map(Number);
  return Math.abs(r1 - r2) <= 1 && Math.abs(c1 - c2) <= 1;
};
const where_ = (seats, n) => Object.keys(seats).find((k) => seats[k] === n);

async function cleanup() {
  for (const c of (await getDocsFromServer(chartsQuery)).docs) await deleteDoc(c.ref);
  await deleteDoc(hubRef);
  const trash = await getDocsFromServer(query(collection(db, 'users', uid, 'trash'), where('type', '==', 'seating')));
  for (const t of trash.docs) if (t.data().data?.classKey === KEY) await deleteDoc(t.ref);
  const now = (await getDocFromServer(rosterRef)).data();
  const list = (now?.classList || []).filter((c) => !(String(c.year) === '2030' && c.grade === '9' && c.classNum === '9'));
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
}

const run = async () => {
  await cleanup();
  const now = (await getDocFromServer(rosterRef)).data();
  const list = [...(now?.classList || []), { ...CLASS, students: STUDENTS }];
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  const modal = () => page.getByRole('dialog').filter({ has: page.locator('[data-seating-grid], [aria-label="학급"]') });
  const seat = (k) => page.locator(`[data-seat="${k}"]`);
  const toast = (text) => page.locator('#sp4-toast-container [role=status]', { hasText: text }).last();
  const btn = (name) => modal().getByRole('button', { name, exact: true });

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 1. 열기·만들기 ──
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /자리표/ }).click();
    await modal().getByRole('combobox', { name: '학급' }).waitFor({ timeout: 10000 });
    check('⋮ 메뉴 → 자리표 창', await modal().isVisible());
    await modal().getByRole('combobox', { name: '학급' }).selectOption(KEY);
    await modal().getByRole('button', { name: '+ 자리표 만들기' }).waitFor({ timeout: 10000 });
    check('자리표가 없는 학급은 만들기 단추', true);
    await modal().getByRole('button', { name: '+ 자리표 만들기' }).click();
    await page.locator('[data-seating-grid]').waitFor({ timeout: 10000 });
    let charts = await until(serverCharts, (cs) => cs.length === 1);
    let ch = charts[0];
    const seatedNums = Object.values(ch?.seats || {}).sort((a, b) => a - b);
    check('서버에 자리표 한 장, 재학생 11명만 (전출 12번 빠짐)', seatedNums.length === 11 && !seatedNums.includes(12), seatedNums.join(','));
    check('번호 차례로 앞줄부터', ch?.seats['0-0'] === 1 && ch?.seats['0-5'] === 6 && ch?.seats['1-4'] === 11);
    check('화면 첫 칸에 1번 이름', (await seat('0-0').innerText()).includes('가람1'));
    check('칸이 0줄 6열 + 1줄 6열', (await page.locator('[data-seat]').count()) === 12);
    await page.screenshot({ path: 'tools/report/seating-new.png' });

    // ── 2. 끌어다 놓기 ──
    await seat('0-0').dragTo(seat('0-1'));
    ch = (await until(serverCharts, (cs) => cs[0]?.seats['0-0'] === 2))[0];
    check('끌어다 놓으면 맞바꾼다 (서버)', ch.seats['0-0'] === 2 && ch.seats['0-1'] === 1, JSON.stringify([ch.seats['0-0'], ch.seats['0-1']]));
    await seat('0-2').dragTo(seat('1-5'));
    ch = (await until(serverCharts, (cs) => cs[0]?.seats['1-5'] === 3))[0];
    check('빈 자리로 끌면 옮긴다', ch.seats['1-5'] === 3 && ch.seats['0-2'] === undefined);
    await seat('1-5').dragTo(page.locator('[data-unseated]'));
    ch = (await until(serverCharts, (cs) => cs[0]?.seats['1-5'] === undefined))[0];
    check('자리 없는 학생 칸으로 끌면 비운다', ch.seats['1-5'] === undefined && (await page.locator('[data-unseated-num="3"]').count()) === 1);
    await page.locator('[data-unseated-num="3"]').dragTo(seat('0-2'));
    ch = (await until(serverCharts, (cs) => cs[0]?.seats['0-2'] === 3))[0];
    check('자리 없는 학생을 자리로 끌어 앉힌다', ch.seats['0-2'] === 3);

    // ── 3. 자리 고치기 (눌러서) ──
    await seat('0-0').click();
    check('고치기를 켜지 않고 누르면 안내만', await toast('자리를 바꾸려면').isVisible().catch(() => false));
    await btn('✏️ 자리 고치기').click();
    await seat('0-0').click();
    await seat('1-0').click();
    ch = (await until(serverCharts, (cs) => cs[0]?.seats['1-0'] === 2))[0];
    check('두 자리를 차례로 누르면 바꾼다', ch.seats['1-0'] === 2 && ch.seats['0-0'] === 7, JSON.stringify([ch.seats['0-0'], ch.seats['1-0']]));
    await seat('0-0').click();
    await page.locator('[data-seat-actions]').getByRole('button', { name: '🔒 고정' }).click();
    ch = (await until(serverCharts, (cs) => (cs[0]?.locked || []).includes('0-0')))[0];
    check('고정 (서버 locked)', ch.locked.includes('0-0'));
    check('고정 칸에 🔒', (await seat('0-0').getByLabel('고정').count()) === 1);
    await seat('1-5').click();
    await page.locator('[data-seat-actions]').getByRole('button', { name: '책상 없애기' }).click();
    ch = (await until(serverCharts, (cs) => (cs[0]?.off || []).includes('1-5')))[0];
    check('책상 없애기 (서버 off)', ch.off.includes('1-5') && (await page.locator('[data-seat="1-5"][data-seat-off]').count()) === 1);
    await btn('✏️ 자리 고치기').click();
    check('고치기를 끄면 책상 없는 칸은 안 보인다', (await page.locator('[data-seat="1-5"]').count()) === 0);

    // ── 4. 떨어뜨릴 학생 ──
    await btn('🚫 떨어뜨릴 학생').click();
    await modal().getByRole('combobox', { name: '떨어뜨릴 학생 1' }).selectOption('1');
    await modal().getByRole('combobox', { name: '떨어뜨릴 학생 2' }).selectOption('3');
    await modal().getByRole('button', { name: '＋ 더하기' }).click();
    let hub = await until(serverHub, (h) => (h.apart || []).includes('1-3'));
    check('떨어뜨릴 학생 쌍 (서버 v4_classHub)', (hub.apart || []).includes('1-3'));
    check('쌍이 보인다', await page.locator('[data-apart="1-3"]').isVisible());
    // 1번(0-1)과 3번(0-2)은 지금 붙어 있다
    check('붙어 있으면 ⚠️', (await seat('0-1').getByLabel('떨어뜨릴 학생이 붙어 있음').count()) === 1);
    await modal().getByRole('combobox', { name: '떨어뜨릴 학생 1' }).selectOption('5');
    await modal().getByRole('combobox', { name: '떨어뜨릴 학생 2' }).selectOption('6');
    await modal().getByRole('button', { name: '＋ 더하기' }).click();
    hub = await until(serverHub, (h) => (h.apart || []).length === 2);
    check('두 번째 쌍 (덮지 않고 더한다)', (hub.apart || []).length === 2);

    // ── 5. 섞기 ──
    await modal().getByLabel('남녀 짝').check();
    const before = (await serverCharts())[0];
    await btn('🎲 섞기').click();
    ch = (await until(serverCharts, (cs) => (cs[0]?.history || []).length === 1))[0];
    const moved = Object.keys(before.seats).filter((k) => before.seats[k] !== ch.seats[k]).length;
    check('섞으면 자리가 바뀐다', moved > 3, `${moved}칸 바뀜`);
    check('고정 칸 그대로', ch.seats['0-0'] === 7);
    check('책상 없는 칸은 비어 있다', ch.seats['1-5'] === undefined);
    check('재학생 11명 모두 앉는다', Object.values(ch.seats).length === 11 && !Object.values(ch.seats).includes(12));
    check('떨어뜨릴 학생이 붙지 않는다', !near(where_(ch.seats, 1), where_(ch.seats, 3)) && !near(where_(ch.seats, 5), where_(ch.seats, 6)));
    check('섞기 전 짝을 지난 짝으로 기록', ch.history[0].pairs.length > 0, ch.history[0].pairs.join(' '));
    const shuffleToast = toast('섞었습니다');
    check('안내에 되돌리기', await shuffleToast.getByRole('button', { name: '되돌리기' }).isVisible(), await shuffleToast.innerText());
    await page.screenshot({ path: 'tools/report/seating-shuffled.png' });
    await shuffleToast.getByRole('button', { name: '되돌리기' }).click();
    ch = (await until(serverCharts, (cs) => (cs[0]?.history || []).length === 0))[0];
    check('되돌리기 → 섞기 전 자리 (서버)', JSON.stringify(ch.seats) === JSON.stringify(before.seats) || Object.keys(before.seats).every((k) => before.seats[k] === ch.seats[k]));

    // ── 6. 모양 ──
    await btn('⚙️ 모양').click();
    await modal().getByRole('button', { name: '줄 줄이기' }).click();
    ch = (await until(serverCharts, (cs) => cs[0]?.rows === 1))[0];
    check('줄 줄이기 → 서버 rows 1', ch.rows === 1);
    check('밖으로 나간 학생은 자리 없음', (await page.locator('[data-unseated-num]').count()) === 5, String(await page.locator('[data-unseated-num]').count()));
    await modal().getByRole('button', { name: '줄 늘리기' }).click();
    await modal().getByRole('button', { name: '아래 (교탁에서)' }).click();
    ch = (await until(serverCharts, (cs) => cs[0]?.front === 'bottom'))[0];
    check('교탁 아래 → 180도 (첫 줄 첫 칸이 오른쪽 아래)', ch.front === 'bottom' && (await page.locator('[data-seat]').last().getAttribute('data-seat')) === '0-0');
    await modal().getByLabel('자리표 이름').fill('2학기');
    await modal().getByLabel('자리표 이름').press('Enter');
    ch = (await until(serverCharts, (cs) => cs[0]?.name === '2학기'))[0];
    check('이름 바꾸기', ch.name === '2학기' && (await modal().getByRole('tab', { name: '2학기' }).count()) === 1);

    // ── 7. 새 자리표·지우기·되돌리기 ──
    await modal().getByRole('button', { name: '+ 새 자리표' }).click();
    charts = await until(serverCharts, (cs) => cs.length === 2);
    check('새 자리표 → 두 장', charts.length === 2 && (await modal().getByRole('tab').count()) === 2);
    check('새 자리표가 골라진다', (await modal().getByRole('tab', { selected: true }).innerText()).includes('자리표 2'));
    // 모양 칸은 자리표를 바꿔도 열린 채로 남는다
    if ((await modal().locator('[data-seating-panel="shape"]').count()) === 0) await btn('⚙️ 모양').click();
    await modal().getByRole('button', { name: '🗑️ 이 자리표 지우기' }).click();
    charts = await until(serverCharts, (cs) => cs.length === 1);
    const trash = await getDocsFromServer(query(collection(db, 'users', uid, 'trash'), where('type', '==', 'seating')));
    check('지우면 서버에서 빠지고 휴지통에', charts.length === 1 && trash.docs.some((t) => t.data().data?.classKey === KEY));
    await toast('지웠습니다').getByRole('button', { name: '되돌리기' }).click();
    charts = await until(serverCharts, (cs) => cs.length === 2);
    check('되돌리기 → 다시 두 장', charts.length === 2);
    await until(async () => modal().getByRole('tab').count(), (n) => n === 2, 5000);
    check('화면에도 두 장', (await modal().getByRole('tab').count()) === 2);

    // ── 8. ESC·명령 창 ──
    await page.keyboard.press('Escape');
    await page.waitForTimeout(400);
    check('ESC로 닫힌다', (await modal().count()) === 0);
    await page.locator('body').click({ position: { x: 5, y: 300 } });
    await page.keyboard.press('Control+k');
    await page.getByRole('combobox', { name: '명령 창' }).fill('자리');
    await page.waitForTimeout(300);
    check('명령 창 "자리" 맨 위가 자리표', (await page.locator('[role=option][aria-selected=true]').innerText()).includes('자리표'));
    await page.keyboard.press('Enter');
    await page.locator('[data-seating-grid]').waitFor({ timeout: 10000 });
    check('Enter → 자리표 창, 보던 학급·자리표 그대로', (await modal().getByRole('combobox', { name: '학급' }).inputValue()) === KEY);
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/seating-error.png' }).catch(() => {});
  } finally {
    check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
    await browser.close();
    await cleanup();
  }
};

await run();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
