// tools/inspect-observe.mjs
//
// 관찰 빨리 적기(docs/ROADMAP.md 10)를 실제 크롬으로 확인한다.
//   - 10-1 기록 쓰는 칸: '@가람' → 학생 목록 → Enter로 커서 자리에 태그, 초성(@ㄴㄹ)·누르기, 번호(@3)·Esc는 목록만,
//     메일 주소·메모 칸에서는 안 뜬다, 저장하면 그 글 그대로
//   - 10-2 관찰 문구 단추: 자리표 학생 칸에서 누르면 오늘 기록에 '문구 #태그', ✏️ 문구로 더하기·빼기(계정에 저장),
//     학생 누가기록 카드에도 같은 문구, 누르면 목록에 바로
// 점검용 학급(올해 학년도 9학년 9반 - 누가기록이 오늘 기록을 모으게)·자리표를 심고 끝에 지운다. 오늘 기록은 점검 학급 태그가 든 줄만 뺀다, 문구 문서는 처음 모습으로.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-observe.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-observe');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const d = new Date();
const TODAY = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
/** 올해 학년도 (3월부터) */
const AY = d.getMonth() >= 2 ? d.getFullYear() : d.getFullYear() - 1;
const CLASS = { year: AY, grade: '9', classNum: '9' };
const KEY = `${AY}_9_9`;
/** 태그 앞자리 (#YY0909) */
const T = `#${String(AY % 100).padStart(2, '0')}0909`;
const NAMES = ['가람', '나래', '다온', '라온'];
const STUDENTS = NAMES.map((name, i) => ({ num: i + 1, name: `${name}${i + 1}`, gender: i % 2 ? 'F' : 'M', isActive: true }));
const CHART_ID = 'st_inspect_observe';

const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const chartRef = doc(db, 'users', uid, 'v4_seating', CHART_ID);
const journalRef = doc(db, 'users', uid, 'journals', TODAY);
const phrasesRef = doc(db, 'users', uid, 'settings', 'v4_observationPhrases');

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
const serverJournal = async () => (await getDocFromServer(journalRef)).data()?.entries || [];
const serverPhrases = async () => (await getDocFromServer(phrasesRef)).data()?.phrases || null;

let origPhrases = null;
let hadJournal = false;
async function cleanup() {
  await deleteDoc(chartRef).catch(() => {});
  const jr = (await getDocFromServer(journalRef)).data();
  if (jr) {
    const entries = (jr.entries || []).filter((e) => !String(e?.content || '').includes(T) && !String(e?.content || '').includes('점검 관찰'));
    if (entries.length === 0 && !hadJournal) await deleteDoc(journalRef);
    else await setDoc(journalRef, { ...jr, entries });
  }
  if (origPhrases) await setDoc(phrasesRef, origPhrases);
  else await deleteDoc(phrasesRef).catch(() => {});
  const now = (await getDocFromServer(rosterRef)).data();
  const list = (now?.classList || []).filter((c) => !(String(c.year) === String(AY) && c.grade === '9' && c.classNum === '9'));
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
}

const run = async () => {
  origPhrases = (await getDocFromServer(phrasesRef)).data() || null;
  hadJournal = !!(await getDocFromServer(journalRef)).data();
  await cleanup();
  await deleteDoc(phrasesRef).catch(() => {});
  const now = (await getDocFromServer(rosterRef)).data();
  const classes = [...(now?.classList || []), { ...CLASS, students: STUDENTS }];
  await setDoc(rosterRef, { classList: classes, rosters: classes, updatedAt: Date.now() }, { merge: true });
  await setDoc(chartRef, {
    classKey: KEY, name: '점검 자리표', rows: 1, cols: 4, groupCols: 2, front: 'top',
    seats: { '0-0': 1, '0-1': 2, '0-2': 3, '0-3': 4 }, off: [], locked: [], history: [], createdAt: Date.now(), updatedAt: Date.now(),
  });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  // 점검 학급을 '@' 목록 맨 앞에 (학생 누가기록에서 마지막에 본 학급)
  await ctx.addInitScript((key) => {
    try {
      localStorage.setItem('sp4-student-record', key);
    } catch {
      /* 무시 */
    }
  }, KEY);
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

  const list = () => page.locator('[data-student-mention]');
  const toast = (text) => page.locator('#sp4-toast-container [role=status]', { hasText: text }).last();

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 10-1 기록 칸의 @이름 ──
    await page.getByRole('button', { name: '기록 추가' }).click();
    const ta = page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await ta.waitFor({ timeout: 6000 });
    await ta.click();
    await page.keyboard.type('점검 관찰 발표 @가람');
    await list().waitFor({ timeout: 6000 });
    check('@가람 → 학생 목록', (await list().locator(`[data-mention-tag="${T}01"]`).count()) === 1);
    check('첫 줄이 골라져 있다', (await list().locator('[role=option]').first().getAttribute('aria-selected')) === 'true');
    await page.keyboard.press('Enter');
    await page.waitForTimeout(150);
    check('Enter → 커서 자리에 태그와 빈칸', (await ta.inputValue()) === `점검 관찰 발표 ${T}01 `, JSON.stringify(await ta.inputValue()));
    check('목록이 닫힌다', (await list().count()) === 0);
    await page.keyboard.type('참여 @ㄴㄹ');
    await list().locator(`[data-mention-tag="${T}02"]`).waitFor({ timeout: 4000 }).catch(() => {});
    check('초성 @ㄴㄹ → 나래2', (await list().locator(`[data-mention-tag="${T}02"]`).count()) === 1);
    await list().locator(`[data-mention-tag="${T}02"]`).click();
    await page.waitForTimeout(150);
    check('누르면 넣는다 (커서는 칸에)', (await ta.inputValue()).endsWith(`참여 ${T}02 `) && (await page.evaluate(() => document.activeElement?.tagName)) === 'TEXTAREA', JSON.stringify(await ta.inputValue()));
    await page.keyboard.type('@3');
    await list().locator(`[data-mention-tag="${T}03"]`).waitFor({ timeout: 4000 }).catch(() => {});
    check('번호 @3 → 다온3', (await list().locator(`[data-mention-tag="${T}03"]`).count()) === 1);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(250);
    check('Esc는 목록만 닫는다 (쓰던 칸·글 그대로)', (await list().count()) === 0 && (await ta.count()) === 1 && (await ta.inputValue()).endsWith('@3'));
    await page.keyboard.press('Backspace');
    await page.keyboard.press('Backspace');
    await page.keyboard.type('메일 teacher@sch');
    await page.waitForTimeout(250);
    check('메일 주소에서는 안 뜬다', (await list().count()) === 0);
    await page.keyboard.press('Control+a');
    await page.keyboard.type('점검 관찰 @가람');
    await list().waitFor({ timeout: 4000 });
    await page.keyboard.press('ArrowDown');
    const sel = await list().locator('[role=option][aria-selected=true]').getAttribute('data-mention-tag').catch(() => '');
    await page.keyboard.press('Tab');
    await page.waitForTimeout(150);
    check('↓ 다음 줄 · Tab으로 넣기', (await ta.inputValue()) === `점검 관찰 ${sel} ` || ((await list().locator('[role=option]').count()) === 0 && (await ta.inputValue()).startsWith(`점검 관찰 ${T}`)), JSON.stringify(await ta.inputValue()));
    await page.keyboard.press('Control+a');
    await page.keyboard.type('점검 관찰 발표함 @가람');
    await list().waitFor({ timeout: 4000 });
    await page.keyboard.press('Enter');
    await page.keyboard.press('Control+s');
    const jr = await until(serverJournal, (es) => es.some((e) => String(e.content).trim() === `점검 관찰 발표함 ${T}01`));
    check('저장하면 그 글 그대로 (태그 붙은 채, 끝 빈칸은 저장이 다듬는다)', jr.some((e) => String(e.content).trim() === `점검 관찰 발표함 ${T}01`));
    await page.getByTitle('닫기').first().click();
    await page.waitForTimeout(400);

    // 메모 칸에서는 안 뜬다
    await page.getByRole('button', { name: '메모', exact: true }).first().click();
    await page.getByRole('button', { name: /새 메모|메모 추가/ }).first().click();
    const memoTa = page.locator('aside[aria-label="메모 쓰기"] textarea').first();
    await memoTa.waitFor({ timeout: 6000 });
    await memoTa.click();
    await page.keyboard.type('@가람');
    await page.waitForTimeout(300);
    check('메모 칸에서는 @ 목록이 없다', (await list().count()) === 0);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Backspace');
    await page.getByTitle('닫기').first().click();
    await page.waitForTimeout(400);
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 10-2 관찰 문구 단추 ──
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /자리표/ }).click();
    const classSelect = page.getByRole('dialog').getByRole('combobox', { name: '학급' }).first();
    await classSelect.waitFor({ timeout: 10000 });
    await classSelect.selectOption(KEY);
    await page.locator('[data-seat="0-0"]').click();
    const card = page.locator('[data-seat-student="1"]');
    await card.waitFor({ timeout: 6000 });
    const phrases = card.locator('[data-observation-phrases]');
    check('학생 칸에 기본 관찰 문구', (await phrases.locator('[data-observation-phrase="친구를 도움"]').count()) === 1);
    await phrases.locator('[data-observation-phrase="친구를 도움"]').click();
    let es = await until(serverJournal, (l) => l.some((e) => e.content === `친구를 도움 ${T}01`));
    check('문구를 누르면 오늘 기록에 "문구 #태그"', es.some((e) => e.content === `친구를 도움 ${T}01`));
    check('안내에 되돌리기', await toast('친구를 도움').getByRole('button', { name: '되돌리기' }).isVisible().catch(() => false));
    await phrases.getByRole('button', { name: '✏️ 문구' }).click();
    await phrases.getByLabel('새 관찰 문구').fill('실험을 주도함');
    await phrases.getByLabel('새 관찰 문구').press('Enter');
    let ph = await until(serverPhrases, (p) => (p || []).includes('실험을 주도함'));
    check('✏️ 문구 → 더하기가 계정에 저장 (기본 문구 + 새 문구)', (ph || []).includes('실험을 주도함') && (ph || []).includes('발표를 잘함'), JSON.stringify(ph));
    await phrases.getByRole('button', { name: "'질문을 많이 함' 빼기" }).click();
    ph = await until(serverPhrases, (p) => !(p || []).includes('질문을 많이 함'));
    check('✕ → 빼기', !(ph || []).includes('질문을 많이 함'));
    await phrases.getByRole('button', { name: '✓ 다 고침' }).click();

    // 학생 누가기록 카드에도 같은 문구
    await card.getByRole('button', { name: '🧑‍🎓 누가기록', exact: true }).click();
    const observe = page.locator('[data-student-observe]');
    await observe.waitFor({ timeout: 8000 });
    await observe.locator('[data-observation-phrase="실험을 주도함"]').waitFor({ timeout: 5000 }).catch(() => {});
    check('누가기록 카드에도 같은 문구 (더한 것 있음, 뺀 것 없음)',
      (await observe.locator('[data-observation-phrase="실험을 주도함"]').count()) === 1 &&
        (await observe.locator('[data-observation-phrase="질문을 많이 함"]').count()) === 0);
    await observe.locator('[data-observation-phrase="실험을 주도함"]').click();
    es = await until(serverJournal, (l) => l.some((e) => e.content === `실험을 주도함 ${T}01`));
    check('누가기록에서 문구 → 오늘 기록에', es.some((e) => e.content === `실험을 주도함 ${T}01`));
    const rec = page.getByRole('dialog').filter({ hasText: '학생 누가기록' });
    await rec.getByText('실험을 주도함').first().waitFor({ timeout: 6000 }).catch(() => {});
    check('목록에 바로 보인다', (await rec.getByText(`실험을 주도함 ${T}01`).count()) >= 1 || (await rec.locator('li', { hasText: '실험을 주도함' }).count()) >= 1);
    await observe.getByLabel('관찰 한 줄').fill('점검 관찰 글로 적음');
    await observe.getByLabel('관찰 한 줄').press('Enter');
    es = await until(serverJournal, (l) => l.some((e) => e.content === `점검 관찰 글로 적음 ${T}01`));
    check('관찰 한 줄 Enter → 오늘 기록, 칸은 비운다', es.some((e) => e.content === `점검 관찰 글로 적음 ${T}01`) && (await observe.getByLabel('관찰 한 줄').inputValue()) === '');
    await page.screenshot({ path: 'tools/report/observe-record.png' });
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/observe-error.png' }).catch(() => {});
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
