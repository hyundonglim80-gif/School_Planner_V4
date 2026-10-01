// tools/inspect-groups.mjs
//
// 자리표의 모둠(docs/ROADMAP.md 8-4)을 실제 크롬으로 누르고 서버를 확인한다.
//   - 👥 모둠 칸: 무작위(떨어뜨릴 학생은 다른 모둠) → 저장 전 → 이름 붙여 저장 → 서버 v4_classHub/{학급}.groupSets
//   - 자리에 모둠 색, 학생 옮기기(저장한 모둠은 바로 저장), 자리대로(앞뒤 넷씩)·⚠️, 버리기, 칸을 닫으면 색이 걷힌다
//   - 조사표 '조별 평가' → 조 나누기에서 저장한 모둠 → 만든 조사표의 groups가 그 모둠
//   - 지우기 → 휴지통 → 안내의 되돌리기로 되살림
// 점검용 학급(2030학년도 9학년 9반)·자리표·학급 허브를 심고 끝에 지운다. 오늘 조사표는 점검용만 뺀다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-groups.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-groups');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const CLASS = { year: 2030, grade: '9', classNum: '9' };
const KEY = '2030_9_9';
const NAMES = ['가람', '나래', '다온', '라온', '마루', '바다', '사랑', '아라', '자람', '차오', '카이', '타라'];
const STUDENTS = NAMES.map((name, i) => ({ num: i + 1, name: `${name}${i + 1}`, gender: i % 2 ? 'F' : 'M', isActive: i !== 11 }));
// 앞줄 1~6, 뒷줄 7~10(0~3열), 11번은 자리 없음, 12번은 전출
const SEATS = Object.fromEntries(STUDENTS.slice(0, 10).map((s, i) => [`${Math.floor(i / 6)}-${i % 6}`, s.num]));
const ACTIVE = STUDENTS.filter((s) => s.isActive).map((s) => s.num);
const CHART_ID = 'st_inspect_groups';
const EVAL_TITLE = '점검 모둠 평가';

const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const chartRef = doc(db, 'users', uid, 'v4_seating', CHART_ID);
const hubRef = doc(db, 'users', uid, 'v4_classHub', KEY);
const evalRef = doc(db, 'users', uid, 'evaluations', TODAY);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
const serverSets = async () => Object.entries((await getDocFromServer(hubRef)).data()?.groupSets || {});
const sorted = (l) => [...l].sort((a, b) => a - b);
const sameNums = (a, b) => JSON.stringify(sorted(a)) === JSON.stringify(sorted(b));

let hadEvalDoc = false;
async function cleanup() {
  await deleteDoc(chartRef).catch(() => {});
  await deleteDoc(hubRef).catch(() => {});
  const ev = (await getDocFromServer(evalRef)).data();
  if (ev) {
    const list = (ev.evalList || ev.list || []).filter((e) => e?.title !== EVAL_TITLE);
    if (list.length === 0 && !hadEvalDoc) await deleteDoc(evalRef);
    else await setDoc(evalRef, { ...ev, list, evalList: list });
  }
  const now = (await getDocFromServer(rosterRef)).data();
  const list = (now?.classList || []).filter((c) => !(String(c.year) === '2030' && c.grade === '9' && c.classNum === '9'));
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
}

const run = async () => {
  await cleanup();
  hadEvalDoc = !!(await getDocFromServer(evalRef)).data();
  const now = (await getDocFromServer(rosterRef)).data();
  const list = [...(now?.classList || []), { ...CLASS, students: STUDENTS }];
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
  await setDoc(chartRef, {
    classKey: KEY, name: '점검 자리표', rows: 2, cols: 6, groupCols: 2, front: 'top',
    seats: SEATS, off: [], locked: [], history: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  await setDoc(hubRef, { classKey: KEY, apart: ['1-2', '3-4'], updatedAt: Date.now() });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

  const modal = () => page.getByRole('dialog').filter({ hasText: '🪑 자리표' });
  const panel = () => page.locator('[data-seating-panel="groups"]');
  const toast = (text) => page.locator('#sp4-toast-container [role=status]', { hasText: text }).last();
  /** 화면의 모둠: [[번호…], …] */
  const shownGroups = () =>
    panel().locator('[data-group-index]').evaluateAll((els) =>
      els.map((el) => [...el.querySelectorAll('[data-group-member]')].map((m) => Number(m.getAttribute('data-group-member'))))
    );
  const groupOfNum = (groups, n) => groups.findIndex((g) => g.includes(n));

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 1. 모둠 칸 열기 ──
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /자리표/ }).click();
    const classSelect = modal().getByRole('combobox', { name: '학급' }).first();
    await classSelect.waitFor({ timeout: 10000 });
    await classSelect.selectOption(KEY);
    await page.locator('[data-seating-grid]').waitFor({ timeout: 10000 });
    await modal().getByRole('button', { name: '👥 모둠' }).click();
    await panel().waitFor({ timeout: 4000 });
    check('👥 모둠 → 모둠 칸, 저장한 모둠 없음 안내', (await panel().innerText()).includes('저장한 모둠이 없습니다'));
    check('모둠 수 처음은 넷씩 (11명 → 3)', (await panel().getByLabel('모둠 수').inputValue()) === '3');

    // ── 2. 무작위 ──
    await panel().getByRole('button', { name: '🎲 무작위로' }).click();
    await panel().locator('[data-group-view="draft"]').waitFor({ timeout: 4000 });
    let groups = await shownGroups();
    check('무작위 → 저장 전, 3모둠', groups.length === 3 && (await panel().innerText()).includes('저장 전'), JSON.stringify(groups));
    check('재학생 11명이 한 번씩 (전출 12번 없음)', sameNums(groups.flat(), ACTIVE));
    const sizes = groups.map((g) => g.length);
    check('크기는 많아야 한 명 차이', Math.max(...sizes) - Math.min(...sizes) <= 1, sizes.join(','));
    check('떨어뜨릴 학생(1-2, 3-4)은 다른 모둠', groupOfNum(groups, 1) !== groupOfNum(groups, 2) && groupOfNum(groups, 3) !== groupOfNum(groups, 4));
    check('⚠️ 없음', (await panel().locator('[data-group-apart-warn]').count()) === 0);
    check('자리마다 모둠 색 (앉은 10명 + 자리 없는 11번)', (await page.locator('[data-seat-group]').count()) === 11, String(await page.locator('[data-seat-group]').count()));
    const seat1Group = Number(await page.locator('[data-seat="0-0"]').getAttribute('data-seat-group'));
    check('자리의 색이 그 학생의 모둠', seat1Group === groupOfNum(groups, 1));
    check('저장 전에는 서버에 없다', (await serverSets()).length === 0);

    // ── 3. 이름 붙여 저장 ──
    await panel().getByLabel('모둠 이름').fill('점검 모둠');
    await panel().getByRole('button', { name: '💾 저장' }).click();
    let sets = await until(serverSets, (s) => s.length === 1);
    const [setId, saved] = sets[0] || [];
    check('저장 → 서버 groupSets에 한 벌', !!saved && saved.name === '점검 모둠', JSON.stringify(saved));
    check('서버 모둠 = 화면 모둠 (1모둠부터)',
      !!saved && JSON.stringify(saved.groups.map((g) => sorted(g.members))) === JSON.stringify(groups.map(sorted)) &&
        saved.groups[0].name === '1모둠');
    check('id는 필드 경로로 쓸 수 있는 모양', /^gs_[a-z0-9]+_[a-z0-9]+$/.test(setId || ''), setId);
    await panel().locator('[data-group-view="saved"]').waitFor({ timeout: 4000 });
    check('저장한 모둠 단추가 눌린 채', (await panel().locator(`[data-group-set="${setId}"]`).getAttribute('aria-pressed')) === 'true');

    // ── 4. 학생 옮기기 (저장한 모둠은 바로 저장) ──
    const mover = groups[0][0];
    await panel().locator(`[data-group-member="${mover}"]`).click();
    await panel().locator('[data-group-index="1"] [data-group-head]').click();
    sets = await until(serverSets, (s) => (s[0]?.[1]?.groups?.[1]?.members || []).includes(mover));
    const movedGroups = sets[0]?.[1]?.groups || [];
    check('학생을 누르고 다른 모둠 → 서버에 옮겨 저장', movedGroups[1]?.members.includes(mover) && !movedGroups[0]?.members.includes(mover), JSON.stringify(movedGroups.map((g) => g.members)));
    await until(async () => (await shownGroups())[1] || [], (g) => g.includes(mover), 4000);
    check('화면도 옮겨진다', (await shownGroups())[1].includes(mover));
    check('옮긴 학생의 자리 색도 바뀐다', Number(await page.locator(`[data-seat-num="${mover}"], [data-unseated-num="${mover}"]`).first().getAttribute('data-seat-group')) === 1);
    // 다른 모둠의 학생을 누르면 서로 바꾼다
    const a = movedGroups[0].members[0];
    const b = movedGroups[2].members[0];
    await panel().locator(`[data-group-member="${a}"]`).click();
    await panel().locator(`[data-group-member="${b}"]`).click();
    sets = await until(serverSets, (s) => (s[0]?.[1]?.groups?.[2]?.members || []).includes(a));
    const swapped = sets[0]?.[1]?.groups || [];
    check('학생 → 다른 모둠의 학생 → 서로 바뀐다 (크기 그대로)',
      swapped[2]?.members.includes(a) && swapped[0]?.members.includes(b) && swapped[0].members.length === movedGroups[0].members.length,
      JSON.stringify(swapped.map((g) => g.members)));
    movedGroups.splice(0, movedGroups.length, ...swapped);
    await page.screenshot({ path: 'tools/report/groups-saved.png' });

    // ── 5. 자리대로 ──
    await panel().getByRole('button', { name: /자리대로/ }).click();
    await panel().locator('[data-group-view="draft"]').waitFor({ timeout: 4000 });
    groups = await shownGroups();
    check('자리대로: 앞뒤 넷씩 (1·2·7·8 / 3·4·9·10 / 5·6 + 자리 없는 11)',
      JSON.stringify(groups) === JSON.stringify([[1, 2, 7, 8], [3, 4, 9, 10], [5, 6, 11]]), JSON.stringify(groups));
    check('떨어뜨릴 학생이 같은 모둠이면 ⚠️', (await panel().locator('[data-group-apart-warn]').innerText().catch(() => '')).includes('가람1'));
    await page.screenshot({ path: 'tools/report/groups-seats.png' });
    await panel().getByRole('button', { name: '버리기' }).click();
    await panel().locator('[data-group-view="saved"]').waitFor({ timeout: 4000 });
    check('버리기 → 저장한 모둠으로, 서버는 그대로 한 벌', (await serverSets()).length === 1);

    // ── 6. 닫으면 색이 걷히고, 다시 열면 그 모둠 ──
    await modal().getByRole('button', { name: '👥 모둠' }).click();
    await page.waitForTimeout(200);
    check('모둠 칸을 닫으면 자리 색이 걷힌다', (await page.locator('[data-seat-group]').count()) === 0);
    await modal().getByRole('button', { name: '👥 모둠' }).click();
    await panel().locator('[data-group-view="saved"]').waitFor({ timeout: 4000 }).catch(() => {});
    // 자리 색은 칸이 그려진 다음에 칠해진다 - 기다려 센다
    const colored = await until(() => page.locator('[data-seat-group]').count(), (n) => n === 11, 4000);
    check('다시 열면 고르던 모둠이 보인다', colored === 11, String(colored));

    // ── 7. 조사표 '조별 평가' → 저장한 모둠 불러오기 ──
    await modal().getByRole('button', { name: '닫기' }).last().click();
    await page.waitForTimeout(300);
    const period = page.locator('[data-focus-key^="period"]').first();
    await period.hover();
    await period.getByTitle(/조사표/).click();
    const evalDialog = page.getByRole('dialog').filter({ hasText: '조사표' }).last();
    const createBtn = evalDialog.getByRole('button', { name: '+ 새 조사표' });
    await createBtn.or(evalDialog.getByRole('button', { name: '생성', exact: true })).first().waitFor({ timeout: 8000 });
    if (await createBtn.count()) await createBtn.click();
    await evalDialog.locator('select').filter({ has: page.locator('option', { hasText: '2030학년도 9학년 9반' }) }).selectOption({ label: '2030학년도 9학년 9반 (12명)' });
    await evalDialog.getByPlaceholder(/1단원 평가/).fill(EVAL_TITLE);
    await evalDialog.getByText('조별 평가').click();
    const groupPick = evalDialog.getByLabel('조 나누기');
    await groupPick.locator('option', { hasText: '점검 모둠' }).waitFor({ state: 'attached', timeout: 6000 });
    check('조 나누기에 저장한 모둠', (await groupPick.innerText()).includes('점검 모둠 (3모둠 · 11명)'), (await groupPick.innerText()).replace(/\n/g, ' / '));
    await groupPick.selectOption(setId);
    check('고르면 모둠 미리보기 (조 갯수 칸 대신)',
      (await evalDialog.locator('[data-eval-group-preview]').innerText()).includes('1모둠') && (await evalDialog.getByText(/조 갯수/).count()) === 0);
    await evalDialog.getByRole('button', { name: '생성', exact: true }).click();
    const evs = await until(
      async () => ((await getDocFromServer(evalRef)).data()?.evalList || []).filter((e) => e.title === EVAL_TITLE),
      (l) => l.length === 1
    );
    const madeGroups = evs[0]?.groups || [];
    check('만든 조사표의 조 = 저장한 모둠', JSON.stringify(madeGroups.map((g) => sorted(g.members))) === JSON.stringify(movedGroups.map((g) => sorted(g.members))) &&
      madeGroups[0]?.name === '1모둠', JSON.stringify(madeGroups));
    check('조별 평가로 만들어짐', evs[0]?.methodObj?.group === true);
    await evalDialog.getByText('전체 일괄 적용').waitFor({ timeout: 6000 }).catch(() => {});
    const row = evalDialog.locator('tr', { has: page.locator('td', { hasText: /^가람1$/ }) });
    const g1 = movedGroups.find((g) => g.members.includes(1));
    check('표의 조 칸에 모둠 이름', (await row.locator('input').first().inputValue().catch(() => '')) === g1?.name, g1?.name);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(500);

    // ── 8. 지우기 → 휴지통 → 되돌리기 ──
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /자리표/ }).click();
    await page.locator('[data-seating-grid]').waitFor({ timeout: 10000 });
    if (!(await panel().count())) await modal().getByRole('button', { name: '👥 모둠' }).click();
    await panel().locator('[data-group-view="saved"]').waitFor({ timeout: 4000 });
    await panel().getByRole('button', { name: '🗑️ 지우기' }).click();
    sets = await until(serverSets, (s) => s.length === 0);
    check('지우기 → 서버에서 빠진다', sets.length === 0);
    await toast('모둠').getByRole('button', { name: '되돌리기' }).click();
    sets = await until(serverSets, (s) => s.length === 1);
    check('안내의 되돌리기 → 휴지통에서 되살아난다', sets.length === 1 && sets[0][1].name === '점검 모둠' && sets[0][0] === setId);
    await panel().locator(`[data-group-set="${setId}"]`).waitFor({ timeout: 4000 }).catch(() => {});
    check('되살린 모둠이 칸에 다시 보인다', (await panel().locator(`[data-group-set="${setId}"]`).count()) === 1);
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/groups-error.png' }).catch(() => {});
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
