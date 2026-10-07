// tools/inspect-seat-student.mjs
//
// 자리표의 학생 칸(docs/ROADMAP.md 8-2)을 실제 크롬으로 누르고 서버를 확인한다.
//   - 자리에 오늘 출결 표시(미리 심은 결석), 자리를 누르면 학생 칸 · 다시 누르면 닫힘 · 다른 자리로 바뀜 · 자리 없는 학생도
//   - 오늘 출결: 지각 → 교시 → 사유 → 사유 글 → 출석 (출석부 문서에 그 학생만, 다른 학생 그대로, 그날 기록 '출결' 항목)
//   - 오늘 조사표: 이 학급 것만, 개인 평가·근거·체크 → 그 학생 값만 (다른 학생 값 그대로)
//   - 관찰 한 줄 → 개인 공간 오늘 기록에 태그 붙여 한 줄, 되돌리기로 뺌
//   - 누가기록·출석부 단추, '자리 고치기'를 켜면 닫힘
// 점검용 학급(2030학년도 9학년 9반)·자리표를 심고 끝에 지운다. 오늘 조사표·기록 문서는 처음 모습으로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-seat-student.mjs
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

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'seat-student');
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
const TAG1 = '#30090901';
const NAMES = ['가람', '나래', '다온', '라온', '마루', '바다', '사랑', '아라', '자람', '차오', '카이', '타라'];
const STUDENTS = NAMES.map((name, i) => ({
  num: i + 1,
  name: `${name}${i + 1}`,
  gender: i % 2 ? 'F' : 'M',
  isActive: i !== 11,
  note: i === 0 ? '앞자리 필요' : '',
}));
// 1~10번은 앉고 11번은 자리 없음
const SEATS = Object.fromEntries(STUDENTS.slice(0, 10).map((s, i) => [`${Math.floor(i / 6)}-${i % 6}`, s.num]));
const CHART_ID = 'st_inspect_hub';

const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const chartRef = doc(db, 'users', uid, 'v4_seating', CHART_ID);
const attRef = doc(db, 'users', uid, 'attendance', `${KEY}_${TODAY}`);
const evalRef = doc(db, 'users', uid, 'evaluations', TODAY);
const journalRef = doc(db, 'users', uid, 'journals', TODAY);

const meta = { year: 2030, grade: '9', classNum: '9' };
const snapshot = STUDENTS.slice(0, 11).map((s) => ({ num: s.num, name: s.name, gender: s.gender }));
const baseEval = {
  subject: '수학',
  methodObj: { indiv: true, group: false },
  steps: ['잘함', '보통', '노력'],
  groups: [],
  dateStr: TODAY,
  periodStr: 1,
  context: { source: 'schedule', period: 1 },
  rosterMeta: meta,
  studentsSnapshot: snapshot,
};
const TEST_EVALS = [
  { ...baseEval, id: 'ev_hub_eval', title: '점검 단원평가', type: 'eval', records: { 3: { indivScore: '보통', reason: '남의 값' } } },
  { ...baseEval, id: 'ev_hub_check', title: '점검 준비물', type: 'check', records: {} },
  { ...baseEval, id: 'ev_hub_other', title: '다른 학급 조사표', type: 'check', rosterMeta: { year: 2030, grade: '9', classNum: '8' }, records: {} },
];
const isTestEval = (e) => String(e?.id || '').startsWith('ev_hub_');

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
const serverAtt = async () => (await getDocFromServer(attRef)).data()?.records || {};
const serverEvals = async () => {
  const data = (await getDocFromServer(evalRef)).data() || {};
  return data.evalList || data.list || [];
};
const serverJournal = async () => (await getDocFromServer(journalRef)).data()?.entries || [];
const evalOf = (list, id) => list.find((e) => e.id === id) || {};

let origEvalDoc = null;
let origJournalDoc = null;

async function cleanup() {
  await deleteDoc(chartRef).catch(() => {});
  await deleteDoc(attRef).catch(() => {});
  await deleteDoc(doc(db, 'users', uid, 'v4_classHub', KEY)).catch(() => {});
  // 오늘 조사표: 점검용만 빼고 처음 모습으로
  const ev = (await getDocFromServer(evalRef)).data();
  if (ev) {
    const list = (ev.evalList || ev.list || []).filter((e) => !isTestEval(e));
    if (list.length === 0 && !origEvalDoc) await deleteDoc(evalRef);
    else await setDoc(evalRef, { ...ev, list, evalList: list });
  }
  // 오늘 기록: 점검 학급의 출결 항목과 관찰 줄만 뺀다
  const jr = (await getDocFromServer(journalRef)).data();
  if (jr) {
    const entries = (jr.entries || []).filter(
      (e) => e?.id !== `attendance_${KEY}` && !String(e?.content || '').includes('#300909')
    );
    if (entries.length === 0 && !origJournalDoc) await deleteDoc(journalRef);
    else await setDoc(journalRef, { ...jr, entries });
  }
  const now = (await getDocFromServer(rosterRef)).data();
  const list = (now?.classList || []).filter((c) => !(String(c.year) === '2030' && c.grade === '9' && c.classNum === '9'));
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
}

const run = async () => {
  await cleanup();
  origEvalDoc = (await getDocFromServer(evalRef)).data() || null;
  origJournalDoc = (await getDocFromServer(journalRef)).data() || null;

  const now = (await getDocFromServer(rosterRef)).data();
  const list = [...(now?.classList || []), { ...CLASS, students: STUDENTS }];
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
  await setDoc(chartRef, {
    classKey: KEY, name: '점검 자리표', rows: 2, cols: 6, groupCols: 2, front: 'top',
    seats: SEATS, off: [], locked: [], history: [], createdAt: Date.now(), updatedAt: Date.now(),
  });
  // 4번은 미리 결석 (다른 학생을 고쳐도 그대로여야 한다)
  await setDoc(attRef, {
    ...CLASS, classKey: KEY, date: TODAY, updatedAt: Date.now(),
    records: { 4: { num: 4, name: '라온4', kind: 'absent', reason: 'sick', note: '감기' } },
  });
  const evList = [...((origEvalDoc?.evalList || origEvalDoc?.list || []).filter((e) => !isTestEval(e))), ...TEST_EVALS];
  await setDoc(evalRef, { list: evList, evalList: evList, updatedAt: Date.now() }, { merge: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (dl) => dl.accept());

  const modal = () => page.getByRole('dialog').filter({ has: page.locator('[data-seating-grid]') });
  const seat = (k) => page.locator(`[data-seat="${k}"]`);
  const card = (n) => page.locator(`[data-seat-student="${n}"]`);
  const anyCard = () => page.locator('[data-seat-student]');
  const toast = (text) => page.locator('#sp4-toast-container [role=status]', { hasText: text }).last();
  const cbtn = (n, name) => card(n).getByRole('button', { name, exact: true });

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 1. 열기·자리의 오늘 출결 ──
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /자리표/ }).click();
    const classSelect = page.getByRole('dialog').getByRole('combobox', { name: '학급' }).first();
    await classSelect.waitFor({ timeout: 10000 });
    await classSelect.selectOption(KEY);
    await page.locator('[data-seating-grid]').waitFor({ timeout: 10000 });
    await page.locator('[data-seat="0-3"] [data-seat-att]').waitFor({ timeout: 8000 }).catch(() => {});
    check('미리 결석한 4번 자리에 "결석"', (await seat('0-3').innerText()).includes('결석'), await seat('0-3').innerText());

    // ── 2. 자리를 누르면 학생 칸 ──
    await seat('0-0').click();
    await card(1).waitFor({ timeout: 5000 });
    check('자리를 누르면 학생 칸 (1번 가람1)', (await card(1).innerText()).includes('가람1'));
    check('학생 태그·특이사항이 보인다', (await card(1).innerText()).includes(TAG1) && (await card(1).innerText()).includes('앞자리 필요'));
    check('누른 자리가 눌린 표시', (await seat('0-0').getAttribute('aria-pressed')) === 'true');
    check('처음은 출석', (await cbtn(1, '출석').getAttribute('aria-pressed')) === 'true');

    // ── 3. 오늘 출결 ──
    await cbtn(1, '지각').click();
    let att = await until(serverAtt, (r) => r['1']?.kind === 'late');
    check('지각 → 서버 출석부 (사유 질병)', att['1']?.kind === 'late' && att['1']?.reason === 'sick', JSON.stringify(att['1']));
    check('다른 학생(4번 결석)은 그대로', att['4']?.kind === 'absent' && att['4']?.note === '감기');
    await page.locator('[data-seat="0-0"] [data-seat-att="late"]').waitFor({ timeout: 5000 }).catch(() => {});
    check('자리에 "지각"', (await seat('0-0').innerText()).includes('지각'));
    await card(1).getByRole('button', { name: '2교시' }).click();
    att = await until(serverAtt, (r) => (r['1']?.periods || []).includes(2));
    check('교시 2 → 서버', JSON.stringify(att['1']?.periods) === '[2]');
    await cbtn(1, '미인정').click();
    att = await until(serverAtt, (r) => r['1']?.reason === 'unexcused');
    check('사유 미인정 → 서버 (교시 그대로)', att['1']?.reason === 'unexcused' && JSON.stringify(att['1']?.periods) === '[2]');
    await card(1).getByLabel('출결 사유').fill('늦잠');
    await card(1).getByLabel('출결 사유').press('Enter');
    att = await until(serverAtt, (r) => r['1']?.note === '늦잠');
    check('사유 글 → 서버', att['1']?.note === '늦잠');
    let jr = await until(serverJournal, (es) => es.some((e) => e.id === `attendance_${KEY}` && e.content.includes('1번 가람1 지각(미인정) 2교시 - 늦잠')));
    const attEntry = jr.find((e) => e.id === `attendance_${KEY}`);
    check('그날 기록의 출결 항목도 맞춘다', !!attEntry && attEntry.content.includes('4번 라온4 결석(질병) - 감기'), attEntry?.content?.replace(/\n/g, ' / '));
    await cbtn(1, '출석').click();
    att = await until(serverAtt, (r) => !r['1']);
    check('출석 → 그 학생만 빠진다', !att['1'] && att['4']?.kind === 'absent');
    await until(async () => (await seat('0-0').innerText()).includes('지각'), (v) => !v, 5000);
    check('자리의 "지각"이 사라진다', !(await seat('0-0').innerText()).includes('지각'));

    // ── 4. 오늘 조사표 ──
    const evSec = card(1).locator('[data-seat-student-section="eval"]');
    check('이 학급 조사표 둘만 (다른 학급 것 빠짐)',
      (await evSec.locator('[data-seat-eval]').count()) === 2 && !(await evSec.innerText()).includes('다른 학급'),
      String(await evSec.locator('[data-seat-eval]').count()));
    await evSec.getByLabel('점검 단원평가 개인 평가').selectOption('잘함');
    let evs = await until(serverEvals, (l) => evalOf(l, 'ev_hub_eval').records?.['1']?.indivScore === '잘함');
    check('개인 평가 → 서버 (그 학생만)', evalOf(evs, 'ev_hub_eval').records?.['1']?.indivScore === '잘함');
    check('다른 학생 값 그대로', evalOf(evs, 'ev_hub_eval').records?.['3']?.reason === '남의 값');
    await evSec.getByLabel('점검 단원평가 근거').fill('식을 세워 풂');
    await evSec.getByLabel('점검 단원평가 근거').press('Enter');
    evs = await until(serverEvals, (l) => evalOf(l, 'ev_hub_eval').records?.['1']?.reason === '식을 세워 풂');
    check('근거 → 서버 (평가 값 그대로)',
      evalOf(evs, 'ev_hub_eval').records?.['1']?.reason === '식을 세워 풂' && evalOf(evs, 'ev_hub_eval').records?.['1']?.indivScore === '잘함');
    await evSec.getByLabel('점검 준비물 체크').check();
    evs = await until(serverEvals, (l) => evalOf(l, 'ev_hub_check').records?.['1']?.checked === true);
    check('체크 → 서버', evalOf(evs, 'ev_hub_check').records?.['1']?.checked === true);
    check('두 이름(list·evalList)에 같이', JSON.stringify((await getDocFromServer(evalRef)).data().list) === JSON.stringify((await getDocFromServer(evalRef)).data().evalList));

    // ── 5. 관찰 한 줄 ──
    await card(1).getByLabel('관찰 한 줄').fill('모둠에서 친구를 도움');
    await card(1).getByLabel('관찰 한 줄').press('Enter');
    jr = await until(serverJournal, (es) => es.some((e) => e.content === `모둠에서 친구를 도움 ${TAG1}`));
    const obsEntry = jr.find((e) => e.content === `모둠에서 친구를 도움 ${TAG1}`);
    check('관찰 → 개인 오늘 기록에 태그 붙여 한 줄', !!obsEntry && String(obsEntry.id).startsWith('jr_'), obsEntry?.content);
    await card(1).locator('[data-seat-student-lines]').waitFor({ timeout: 5000 }).catch(() => {});
    check('칸 아래에 오늘 남긴 줄', (await card(1).locator('[data-seat-student-lines]').innerText().catch(() => '')).includes('모둠에서 친구를 도움'));
    check('입력 칸은 비운다', (await card(1).getByLabel('관찰 한 줄').inputValue()) === '');
    const obsToast = toast('오늘 기록에 남겼습니다');
    check('안내에 되돌리기', await obsToast.getByRole('button', { name: '되돌리기' }).isVisible());
    await obsToast.getByRole('button', { name: '되돌리기' }).click();
    jr = await until(serverJournal, (es) => !es.some((e) => e.id === obsEntry?.id));
    check('되돌리기 → 기록에서 빠진다 (출결 항목은 그대로)', !jr.some((e) => e.id === obsEntry?.id) && jr.some((e) => e.id === `attendance_${KEY}`));

    // ── 6. 바꾸기·닫기·자리 없는 학생 ──
    await seat('0-1').click();
    await card(2).waitFor({ timeout: 5000 });
    check('다른 자리를 누르면 그 학생으로', (await anyCard().count()) === 1 && (await card(2).innerText()).includes('나래2'));
    await seat('0-1').click();
    await page.waitForTimeout(200);
    check('같은 자리를 다시 누르면 닫힌다', (await anyCard().count()) === 0);
    await page.locator('[data-unseated-num="11"]').click();
    await card(11).waitFor({ timeout: 5000 }).catch(() => {});
    check('자리 없는 학생을 눌러도 열린다', (await card(11).count()) === 1);
    await card(11).getByRole('button', { name: '학생 칸 닫기' }).click();
    check('✕로 닫힌다', (await anyCard().count()) === 0);
    await seat('1-1').click(); // 8번
    await card(8).waitFor({ timeout: 5000 });
    await modal().getByRole('button', { name: '✏️ 자리 고치기', exact: true }).click();
    check('자리 고치기를 켜면 학생 칸이 닫힌다', (await anyCard().count()) === 0);
    await seat('0-0').click();
    check('자리 고치기에서는 학생 칸 대신 고르기', (await anyCard().count()) === 0 && (await page.locator('[data-seat-actions]').innerText()).includes('가람1'));
    await page.locator('[data-seat-actions]').getByRole('button', { name: '선택 풀기' }).click();
    await modal().getByRole('button', { name: '✏️ 자리 고치기', exact: true }).click();
    await page.screenshot({ path: 'tools/report/seat-student.png' });

    // ── 7. 누가기록·출석부 단추 ──
    await seat('0-0').click();
    await card(1).waitFor({ timeout: 5000 });
    await page.screenshot({ path: 'tools/report/seat-student-card.png' });
    await cbtn(1, '🧑‍🎓 누가기록').click();
    const rec = page.getByRole('dialog').filter({ hasText: '학생 기록(누가기록)' });
    await rec.getByRole('button', { name: '1 가람1', exact: true }).waitFor({ timeout: 8000 });
    check('누가기록 → 그 학생이 골라져 열린다', (await rec.getByRole('button', { name: '1 가람1', exact: true }).getAttribute('aria-pressed')) === 'true');
    await rec.getByRole('button', { name: '닫기' }).last().click();
    await page.waitForTimeout(300);
    check('누가기록을 닫아도 자리표는 남는다', (await modal().count()) === 1);
    await cbtn(1, '📋 출석부').click();
    await page.locator('[data-attendance-num="1"]').waitFor({ timeout: 8000 });
    check('출석부 → 이 학급으로 열린다', (await page.locator('[data-attendance-num="1"]').innerText()).includes('가람1'));
    check('출석부에도 4번 결석', (await page.locator('[data-attendance-num="4"] button[aria-pressed="true"]').allInnerTexts()).includes('결석'));
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/seat-student-error.png' }).catch(() => {});
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
