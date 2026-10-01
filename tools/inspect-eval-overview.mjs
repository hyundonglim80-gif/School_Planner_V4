// tools/inspect-eval-overview.mjs
//
// 평가 모아 보기(docs/ROADMAP.md 9-2)를 실제 크롬으로 확인한다.
//   - ⋮ 메뉴로 열기, 학급의 학년도 조사표만(다른 학급 빠짐), 날짜·교시 차례 머리, 단계별 사람 수
//   - 칸 값(평가 ✎·체크·메모·명단에 없음·빈 칸), 교과·교과 없음·학기·유형 거르기
//   - CSV 내려받기(파일 이름·머리·값·사유), 표 복사(탭)
//   - 머리를 누르면 그 조사표 → 값을 고쳐 저장하고 닫으면 표가 다시 읽는다
// 점검용 학급(2030학년도 9학년 9반)·2030년 날짜의 조사표를 심고 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-eval-overview.mjs
import { readFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-eval-overview');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const CLASS = { year: 2030, grade: '9', classNum: '9' };
const KEY = '2030_9_9';
const NAMES = ['가람', '나래', '다온', '라온'];
const STUDENTS = NAMES.map((name, i) => ({ num: i + 1, name: `${name}${i + 1}`, gender: i % 2 ? 'F' : 'M', isActive: i !== 3 }));
const meta = { year: 2030, grade: '9', classNum: '9' };
const snap = STUDENTS.map((s) => ({ num: s.num, name: s.name, gender: s.gender }));
const D1 = '2030-04-10';
const D2 = '2030-09-03';
const D3 = '2031-02-10';
const evBase = { methodObj: { indiv: true, group: false }, steps: ['잘함', '보통', '노력'], groups: [], rosterMeta: meta, studentsSnapshot: snap, context: { source: 'schedule', period: 1 }, periodStr: 1 };
const EVALS = {
  [D1]: [
    { ...evBase, id: 'ev_ov_a', dateStr: D1, title: '점검 단원평가', subject: '수학', type: 'eval', records: { 1: { indivScore: '잘함', reason: '식을 세워 풂' }, 2: { indivScore: '보통' } } },
    { ...evBase, id: 'ev_ov_other', dateStr: D1, title: '다른 학급 평가', subject: '수학', type: 'eval', rosterMeta: { ...meta, classNum: '8' }, records: {} },
  ],
  [D2]: [
    { ...evBase, id: 'ev_ov_b', dateStr: D2, title: '점검 준비물', subject: '', type: 'check', records: { 1: { checked: true }, 2: { checked: false } } },
    { ...evBase, id: 'ev_ov_c', dateStr: D2, title: '점검 소감', subject: '국어', type: 'memo', periodStr: 2, context: { source: 'schedule', period: 2 }, records: { 1: { memo: '발표를 즐김' } } },
    { ...evBase, id: 'ev_ov_n', dateStr: D2, title: '명단 일부', subject: '과학', type: 'eval', studentsSnapshot: snap.slice(1), periodStr: 3, context: { source: 'schedule', period: 3 }, records: {} },
  ],
  [D3]: [{ ...evBase, id: 'ev_ov_d', dateStr: D3, title: '점검 사회', subject: '사회', type: 'eval', records: {} }],
};

const rosterRef = doc(db, 'users', uid, 'settings', 'rosters');
const evalRef = (date) => doc(db, 'users', uid, 'evaluations', date);

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

async function cleanup() {
  for (const date of Object.keys(EVALS)) await deleteDoc(evalRef(date)).catch(() => {});
  const now = (await getDocFromServer(rosterRef)).data();
  const list = (now?.classList || []).filter((c) => !(String(c.year) === '2030' && c.grade === '9' && c.classNum === '9'));
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
}

const run = async () => {
  await cleanup();
  const now = (await getDocFromServer(rosterRef)).data();
  const list = [...(now?.classList || []), { ...CLASS, students: STUDENTS }];
  await setDoc(rosterRef, { classList: list, rosters: list, updatedAt: Date.now() }, { merge: true });
  for (const [date, evs] of Object.entries(EVALS)) await setDoc(evalRef(date), { list: evs, evalList: evs, updatedAt: Date.now() });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

  const ov = () => page.getByRole('dialog').filter({ hasText: '📊 평가 모아 보기' });
  const cols = () => page.locator('[data-eval-col]').evaluateAll((els) => els.map((e) => e.getAttribute('data-eval-col')));
  const cell = (id, n) => page.locator(`[data-eval-cell="${id}:${n}"]`).innerText();
  const pick = async (label, value) => {
    await ov().getByRole('combobox', { name: label }).selectOption(value);
    await page.waitForTimeout(150);
  };

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 1. 열기 ──
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: /평가 모아 보기/ }).click();
    await ov().locator(`option[value="${KEY}"]`).waitFor({ state: 'attached', timeout: 10000 });
    await pick('학급', KEY);
    await page.locator('[data-eval-overview]').waitFor({ timeout: 10000 });
    const count = await ov().locator('[data-eval-overview-count]').innerText();
    check('조사표 5개 · 학생 4명 (다른 학급 빠짐)', count.includes('조사표 5개') && count.includes('학생 4명'), count);
    check('머리는 날짜·교시 차례', JSON.stringify(await cols()) === JSON.stringify(['ev_ov_a', 'ev_ov_b', 'ev_ov_c', 'ev_ov_n', 'ev_ov_d']), JSON.stringify(await cols()));
    check('머리에 날짜·교과·제목', (await page.locator('[data-eval-col="ev_ov_a"]').innerText()).includes('4/10 수학 점검 단원평가'));
    check('머리에 단계별 사람 수', (await page.locator('[data-eval-col="ev_ov_a"] [data-eval-steps]').innerText()) === '잘함 1 · 보통 1');

    // ── 2. 칸 ──
    check('평가 값 + 사유 표시 ✎', (await cell('ev_ov_a', 1)).includes('잘함') && (await cell('ev_ov_a', 1)).includes('✎'));
    check('사유는 칸 제목에', (await page.locator('[data-eval-cell="ev_ov_a:1"]').getAttribute('title')) === '잘함 - 식을 세워 풂');
    check('체크 O / X', (await cell('ev_ov_b', 1)) === 'O' && (await cell('ev_ov_b', 2)) === 'X');
    check('메모 글', (await cell('ev_ov_c', 1)) === '발표를 즐김');
    check('명단에 없는 학생은 ·', (await cell('ev_ov_n', 1)) === '·');
    check('안 적은 칸은 비어 있다', (await cell('ev_ov_d', 1)) === '');
    check('전출 학생 표시', (await page.locator('[data-eval-row="4"]').innerText()).includes('(전출)'));

    // ── 3. 거르기 ──
    await pick('교과', '수학');
    check('교과 수학 → 하나', JSON.stringify(await cols()) === JSON.stringify(['ev_ov_a']));
    check('개수에 전체도', (await ov().locator('[data-eval-overview-count]').innerText()).includes('조사표 1개 (전체 5)'));
    await pick('교과', '(없음)');
    check('교과 없음 → 준비물', JSON.stringify(await cols()) === JSON.stringify(['ev_ov_b']));
    await pick('교과', '');
    await pick('학기', '2');
    check('2학기 (9월·이듬해 2월)', JSON.stringify(await cols()) === JSON.stringify(['ev_ov_b', 'ev_ov_c', 'ev_ov_n', 'ev_ov_d']), JSON.stringify(await cols()));
    await pick('유형', 'memo');
    check('2학기 + 메모 → 소감', JSON.stringify(await cols()) === JSON.stringify(['ev_ov_c']));
    await pick('학기', '');
    await pick('유형', '');

    // ── 4. CSV · 표 복사 ──
    const [download] = await Promise.all([page.waitForEvent('download', { timeout: 8000 }), ov().getByRole('button', { name: '📥 CSV' }).click()]);
    const csv = (await readFile(await download.path(), 'utf8')).replace(/^﻿/, '');
    const csvLines = csv.split(/\r?\n/);
    check('CSV 파일 이름', download.suggestedFilename() === '평가모아보기_2030학년도_9-9.csv', download.suggestedFilename());
    check('CSV 머리 두 줄(날짜·교과·유형 / 제목·사유)', csvLines[0].startsWith('번호,이름,2030-04-10 수학 평가,') && csvLines[1].includes('점검 단원평가,사유'), csvLines.slice(0, 2).join(' | '));
    check('CSV 학생 줄에 값과 사유', csvLines[2].startsWith('1,가람1,잘함,식을 세워 풂,O,,발표를 즐김'), csvLines[2]);
    await ov().getByRole('button', { name: '📋 표 복사' }).click();
    await page.waitForTimeout(300);
    const tsv = await page.evaluate(() => navigator.clipboard.readText());
    check('표 복사는 탭으로', tsv.split(/\r?\n/)[2]?.split('\t').slice(0, 4).join('|') === '1|가람1|잘함|식을 세워 풂', tsv.split(/\r?\n/)[2]);
    await page.screenshot({ path: 'tools/report/eval-overview.png' });

    // ── 5. 머리 → 조사표, 고쳐 닫으면 다시 읽기 ──
    await page.locator('[data-eval-col="ev_ov_a"]').click();
    const evDialog = page.getByRole('dialog').filter({ hasText: '전체 일괄 적용' }).last();
    await evDialog.waitFor({ timeout: 8000 });
    check('머리를 누르면 그 조사표 (같은 교시의 다른 학급 것이 아니라)', (await evDialog.innerText()).includes('점검 단원평가'));
    const row = evDialog.locator('tr', { has: page.locator('td', { hasText: /^가람1$/ }) });
    await row.locator('select').first().selectOption('노력');
    await evDialog.getByRole('button', { name: /^저장/ }).click();
    await page.waitForTimeout(800);
    await evDialog.getByRole('button', { name: '닫기', exact: true }).click();
    await page.waitForFunction(() => /노력/.test(document.querySelector('[data-eval-cell="ev_ov_a:1"]')?.textContent || ''), null, { timeout: 8000 }).catch(() => {});
    check('조사표를 닫으면 다시 읽어 고친 값이 보인다', (await cell('ev_ov_a', 1)).includes('노력'), await cell('ev_ov_a', 1));
    check('모아 보기 창은 그대로', (await ov().count()) === 1);
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/eval-overview-error.png' }).catch(() => {});
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
