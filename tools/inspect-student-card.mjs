// tools/inspect-student-card.mjs
//
// 학생 기록(누가기록)의 학생 카드(docs/ROADMAP.md 9-1)를 실제 크롬으로 확인한다.
//   - 카드: 특이사항·성별·기록 수·평가 수
//   - 📊 평가: 그 학년도 이 학급 조사표 중 이 학생이 든 것(다른 학급·명단에 없는 것 빠짐), 날짜 차례, 값(평가·체크·메모·안 적음)
//   - 평가를 누르면 그 조사표가 열린다, 📋 전체 복사에 적은 평가가 날짜 차례로 섞인다
// 점검용 학급(2030학년도 9학년 9반)·2030년 날짜의 조사표·기록을 심고 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-student-card.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-student-card');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const CLASS = { year: 2030, grade: '9', classNum: '9' };
const KEY = '2030_9_9';
const TAG1 = '#30090901';
const NAMES = ['가람', '나래', '다온', '라온'];
const STUDENTS = NAMES.map((name, i) => ({
  num: i + 1,
  name: `${name}${i + 1}`,
  gender: i % 2 ? 'F' : 'M',
  isActive: true,
  note: i === 0 ? '앞자리 필요' : '',
}));
const meta = { year: 2030, grade: '9', classNum: '9' };
const snap = STUDENTS.map((s) => ({ num: s.num, name: s.name, gender: s.gender }));
const D1 = '2030-04-10';
const D2 = '2030-09-03';
const D3 = '2031-02-10';
const evBase = { methodObj: { indiv: true, group: false }, steps: ['잘함', '보통', '노력'], groups: [], rosterMeta: meta, studentsSnapshot: snap, context: { source: 'schedule', period: 1 }, periodStr: 1 };
const EVALS = {
  [D1]: [
    { ...evBase, id: 'ev_card_a', dateStr: D1, title: '점검 단원평가', subject: '수학', type: 'eval', records: { 1: { indivScore: '잘함', reason: '식을 세워 풂' }, 2: { indivScore: '보통' } } },
    { ...evBase, id: 'ev_card_other', dateStr: D1, title: '다른 학급 평가', subject: '수학', type: 'eval', rosterMeta: { ...meta, classNum: '8' }, records: { 1: { indivScore: '잘함' } } },
  ],
  [D2]: [
    { ...evBase, id: 'ev_card_b', dateStr: D2, title: '점검 준비물', subject: '', type: 'check', records: { 1: { checked: true } } },
    { ...evBase, id: 'ev_card_c', dateStr: D2, title: '점검 소감', subject: '국어', type: 'memo', periodStr: 2, context: { source: 'schedule', period: 2 }, records: { 1: { memo: '발표를 즐김' } } },
    { ...evBase, id: 'ev_card_nostudent', dateStr: D2, title: '명단에 없음', subject: '과학', type: 'eval', studentsSnapshot: snap.slice(1), periodStr: 3, context: { source: 'schedule', period: 3 }, records: {} },
  ],
  [D3]: [{ ...evBase, id: 'ev_card_d', dateStr: D3, title: '점검 안 적음', subject: '사회', type: 'eval', records: {} }],
};
const JOURNAL_DATE = '2030-05-02';

const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const evalRef = (date) => doc(db, 'users', uid, 'evaluations', date);
const journalRef = doc(db, 'users', uid, 'journals', JOURNAL_DATE);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

async function cleanup() {
  for (const date of Object.keys(EVALS)) await deleteDoc(evalRef(date)).catch(() => {});
  await deleteDoc(journalRef).catch(() => {});
  const now = (await getDocFromServer(rosterRef)).data();
  const list = (now?.classList || []).filter((c) => !(String(c.year) === '2030' && c.grade === '9' && c.classNum === '9'));
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
}

const run = async () => {
  // 2030년 날짜 문서는 점검만 쓴다 - 있으면 지우고 심는다
  await cleanup();
  const now = (await getDocFromServer(rosterRef)).data();
  const list = [...(now?.classList || []), { ...CLASS, students: STUDENTS }];
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
  for (const [date, evs] of Object.entries(EVALS)) await setDoc(evalRef(date), { list: evs, evalList: evs, updatedAt: Date.now() });
  await setDoc(journalRef, { entries: [{ id: 'jr_card_1', content: `모둠 활동에서 친구를 도움 ${TAG1}`, createdAt: Date.now() }], updatedAt: Date.now() });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

  const rec = () => page.getByRole('dialog').filter({ hasText: '학생 기록(누가기록)' });
  const card = () => page.locator('[data-student-card="1"]');

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /학생 기록\(누가기록\)/ }).click();
    // 심은 학급이 명렬표 구독으로 들어온 뒤에 고른다 (먼저 고르면 학생 단추가 안 뜬다)
    await rec().locator(`option[value="${KEY}"]`).waitFor({ state: 'attached', timeout: 10000 });
    await rec().getByRole('combobox', { name: '학급' }).selectOption(KEY);
    await rec().getByRole('button', { name: '1 가람1', exact: true }).click();
    await card().waitFor({ timeout: 8000 });

    // ── 카드 ──
    check('카드에 특이사항', (await card().locator('[data-student-note]').innerText()).includes('앞자리 필요'));
    check('카드에 태그·성별', (await card().innerText()).includes(TAG1) && (await card().innerText()).includes('남'));
    const counts = card().locator('[data-student-counts]');
    await page.waitForFunction(() => /평가 3건/.test(document.querySelector('[data-student-counts]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    check('기록 1건 · 평가 3건 (안 적은 것은 세지 않음)', /기록 1건 · 평가 3건/.test(await counts.innerText()), await counts.innerText());

    // ── 기록·출결 (그대로) ──
    check('처음은 기록·출결 갈래', (await rec().getByRole('tab', { name: /기록·출결/ }).getAttribute('aria-selected')) === 'true');
    check('태그 붙은 기록이 보인다', (await rec().innerText()).includes('모둠 활동에서 친구를 도움'));

    // ── 평가 ──
    await rec().getByRole('tab', { name: /평가/ }).click();
    await page.locator('[data-student-evals]').waitFor({ timeout: 6000 });
    const ids = await page.locator('[data-student-eval]').evaluateAll((els) => els.map((e) => e.getAttribute('data-student-eval')));
    check('이 학급·이 학생 조사표 4개, 날짜 차례 (다른 학급·명단에 없는 것 빠짐)',
      JSON.stringify(ids) === JSON.stringify(['ev_card_a', 'ev_card_b', 'ev_card_c', 'ev_card_d']), JSON.stringify(ids));
    check('갈래 이름에 수 (평가 4)', (await rec().getByRole('tab', { name: /평가/ }).innerText()).includes('4'));
    const value = (id) => page.locator(`[data-student-eval="${id}"] [data-student-eval-value]`).innerText();
    check('평가: 단계 - 근거', (await value('ev_card_a')) === '잘함 - 식을 세워 풂', await value('ev_card_a'));
    check('체크: O', (await value('ev_card_b')) === 'O');
    check('메모: 글', (await value('ev_card_c')) === '발표를 즐김');
    check('적지 않은 것: 안 적음', (await value('ev_card_d')) === '안 적음');
    check('교과·유형이 보인다', (await page.locator('[data-student-eval="ev_card_a"]').innerText()).includes('수학') &&
      (await page.locator('[data-student-eval="ev_card_a"]').innerText()).includes('평가'));
    await page.screenshot({ path: 'tools/report/student-card.png' });

    // ── 전체 복사 ──
    await rec().getByRole('button', { name: '📋 전체 복사' }).click();
    await page.waitForTimeout(300);
    const copied = await page.evaluate(() => navigator.clipboard.readText());
    // 윈도우 클립보드는 줄바꿈을 \r\n으로 돌려준다
    const lines = copied.split(/\r?\n/);
    check('전체 복사에 적은 평가가 날짜 차례로 섞인다',
      lines.includes(`${D1} [평가] 수학 점검 단원평가: 잘함 - 식을 세워 풂`) &&
        lines.indexOf(`${D1} [평가] 수학 점검 단원평가: 잘함 - 식을 세워 풂`) < lines.findIndex((l) => l.startsWith(`${JOURNAL_DATE} [기록]`)) &&
        lines.includes(`${D2} [체크] 점검 준비물: O`) &&
        !copied.includes('점검 안 적음'),
      copied.replace(/\r?\n/g, ' / '));

    // ── 누르면 그 조사표 ──
    await page.locator('[data-student-eval="ev_card_a"]').click();
    const evDialog = page.getByRole('dialog').filter({ hasText: '점검 단원평가' }).last();
    await evDialog.getByText('전체 일괄 적용').waitFor({ timeout: 8000 }).catch(() => {});
    check('평가를 누르면 그 조사표가 열린다', (await evDialog.getByText('전체 일괄 적용').count()) > 0);
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/student-card-error.png' }).catch(() => {});
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
