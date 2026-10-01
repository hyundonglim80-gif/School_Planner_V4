// tools/inspect-progress.mjs
//
// 진도 관리(docs/ROADMAP.md 5번)를 실제 크롬으로 확인한다. 단계마다 항목을 더한다.
// 점검 자료는 2027-03(seed가 채우지 않는 다음 학년도)에 심고 끝나면 지운다. MATCH=<정규식>으로 묶음을 고른다.
//
// [5-1 시간표 적용] 수업이 없는 날(lib/classDays) - 시간표 적용이 진도 세기와 같은 규칙으로 건너뛰는가.
//     월: 보통 날 → 과목 / 화: 공휴일(V3 개인 공휴일) → 비움 / 수: V3 수업X 라벨(labelIds만) → 비움 /
//     목: '휴업'이 든 일정 → 비움 / 금: 수업X 라벨인데 일정에서 끈 것(skip:false) → 과목.
//     예전에는 화·수에도 과목이 채워졌다(공휴일은 holidays/{연도}로 옮겨 간 뒤로, V3 라벨은 처음부터 안 봤다).
// [5-2 진도 관리 창] ⋮ 메뉴·시간표 설정에서 열기, 표 붙여넣기, 미리보기(공휴일 건너뜀), 저장, 밀기·되돌리기,
//     칸 고치기(화살표·Enter), 지우기 → 휴지통 복원.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-progress.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  doc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MATCH = process.env.MATCH ? new RegExp(process.env.MATCH) : null;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'progress');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const ref = (...p) => doc(db, 'users', uid, ...p);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

/** 화면은 로컬 쓰기를 먼저 보여 준다 - 서버에 닿을 때까지 기다려 읽는다 (최대 8초). [값, 걸린 ms] */
async function serverUntil(read, ok, timeout = 8000) {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await read();
  }
  return [v, Date.now() - t0];
}

const WEEK = ['2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12'];
const DAYS = [...WEEK, '2027-03-15'];
const KEY = '점검 국어';
const holRef = ref('settings', 'holidays');
const ttRef = ref('settings', 'timetable_v5');

async function cleanup() {
  for (const d of DAYS) {
    await deleteDoc(ref('schedules', d));
    await deleteDoc(ref('events', d));
  }
  await setDoc(holRef, { map: { [WEEK[1]]: deleteField() } }, { merge: true });
  for (const d of (await getDocsFromServer(collection(db, 'users', uid, 'v4_progress'))).docs) {
    if (d.data().key === KEY) await deleteDoc(d.ref);
  }
  for (const d of (await getDocsFromServer(collection(db, 'users', uid, 'trash'))).docs) {
    if (d.data().type === 'progress' && String(d.data().content || '').startsWith(KEY)) await deleteDoc(d.ref);
  }
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

async function openApp() {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
}
async function openMenu(name) {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name }).click();
}

// ── 5-1 시간표 적용 ───────────────────────────────────────────────
async function timetableApply() {
  const oldTimetable = (await getDocFromServer(ttRef)).data() || null;
  const labels = (await getDocFromServer(ref('settings', 'labels'))).data()?.eventLabels || [];
  const skipLabel = labels.find((l) => l.isSkip ?? l.skip);
  if (!skipLabel) throw new Error('수업X 라벨이 없습니다 - npm run seed');

  const day = { 1: '국어', 2: '수학' };
  await setDoc(ttRef, {
    templates: { '점검 시간표': { names: ['1교시', '2교시'], data: { mon: day, tue: day, wed: day, thu: day, fri: day } } },
    currentNames: ['1교시', '2교시'],
    // 통째로 쓴다 (merge면 원래 템플릿이 남아 그것이 골라진다). 방학 기간은 그대로
    ...(oldTimetable?.semesterConfig ? { semesterConfig: oldTimetable.semesterConfig } : {}),
    updatedAt: Date.now(),
  });
  await setDoc(holRef, { map: { [WEEK[1]]: '점검 공휴일' } }, { merge: true });
  const ev = (id, extra) => ({ eventList: [{ id, completed: false, linkedItems: [], attachments: [], ...extra }], updatedAt: Date.now() });
  await setDoc(ref('events', WEEK[2]), ev('chk_v3skip', { content: '점검 운동회', labelIds: [skipLabel.id] }));
  await setDoc(ref('events', WEEK[3]), ev('chk_rest', { content: '점검 재량휴업일' }));
  await setDoc(ref('events', WEEK[4]), ev('chk_off', { content: '점검 체험학습', label: skipLabel.name, skip: false }));

  try {
    await openApp();
    await openMenu(/시간표 적용/);
    await page.getByRole('button', { name: /템플릿 클라우드 저장/ }).waitFor({ timeout: 20000 });
    await page.waitForTimeout(1000);
    const range = page.getByText('적용 기간:').locator('..').locator('input[type="date"]');
    await range.nth(0).fill(WEEK[0]);
    await range.nth(1).fill(WEEK[4]);
    await page.getByRole('button', { name: /이 기간에 시간표 일괄 덮어쓰기/ }).click();
    const toast = page.getByText(/시간표 적용 완료/).first();
    await toast.waitFor({ timeout: 20000 });
    check('적용 안내: 수업일 2일, 제외 3일', /수업일 2일, 제외 3일/.test(await toast.innerText()), await toast.innerText());

    const subjects = [];
    for (const d of WEEK) {
      const p = (await getDocFromServer(ref('schedules', d))).data()?.periods || {};
      subjects.push(`${p[1]?.subject || ''}/${p[2]?.subject || ''}`);
    }
    const want = ['국어/수학', '/', '/', '/', '국어/수학'];
    const names = ['월 보통 날', '화 공휴일(V3 개인)', '수 V3 수업X 라벨', "목 '휴업' 일정", '금 일정에서 끈 수업X'];
    WEEK.forEach((d, i) => check(`${names[i]} → ${want[i] === '/' ? '비움' : '과목'}`, subjects[i] === want[i], `${d} ${subjects[i]}`));
    await page.screenshot({ path: 'tools/report/progress-apply.png' });

    // 시간표 설정 창에서 진도 관리 창을 연다
    await page.getByRole('button', { name: '📘 진도 관리' }).click();
    const opened = await page.getByRole('dialog').filter({ hasText: '차시 목록' }).first().waitFor({ timeout: 10000 }).then(() => true, () => false);
    check('시간표 설정 창의 📘 진도 관리로 진도 관리 창이 열린다', opened);
    await page.keyboard.press('Escape');
  } finally {
    if (oldTimetable) await setDoc(ttRef, oldTimetable);
    else await deleteDoc(ttRef);
    await cleanup();
  }
}

// ── 5-2 진도 관리 창 ──────────────────────────────────────────────
const TABLE = [
  ['단원', '차시', '학습 내용', '준비물'],
  ['1. 점검 단원', '1', '첫 차시', '공책'],
  ['', '2', '둘째 차시', ''],
  ['', '3', '셋째 차시', ''],
  ['2. 다음 단원', '4', '넷째 차시', '색종이'],
  ['', '5', '다섯째 차시', ''],
]
  .map((r) => r.join('\t'))
  .join('\r\n');

async function progressModal() {
  // 점검 국어: 3/8 1·3교시, 3/9(공휴일) 1교시, 3/10 2교시, 3/11은 수학, 3/12 4교시, 3/15 2교시
  const sched = { [DAYS[0]]: { 1: KEY, 3: ` ${KEY} ` }, [DAYS[1]]: { 1: KEY }, [DAYS[2]]: { 2: KEY }, [DAYS[3]]: { 1: '수학' }, [DAYS[4]]: { 4: KEY }, [DAYS[5]]: { 2: KEY } };
  for (const [d, ps] of Object.entries(sched)) {
    const periods = Object.fromEntries(Object.entries(ps).map(([p, subject]) => [p, { subject, memo: '', supplies: '' }]));
    await setDoc(ref('schedules', d), { periods, updatedAt: Date.now() });
  }
  await setDoc(holRef, { map: { [WEEK[1]]: '점검 공휴일' } }, { merge: true });

  try {
    await openApp();
    await openMenu(/진도 관리/);
    const dlg = page.getByRole('dialog').filter({ hasText: '차시 목록' }).first();
    await dlg.waitFor({ timeout: 10000 });
    check('⋮ 메뉴 📘 진도 관리로 창이 열린다', true);

    await dlg.getByLabel('칸 글자').fill(KEY);
    await dlg.getByLabel('시작일').fill(DAYS[0]);
    // 표 붙여넣기 (엑셀에서 복사한 것처럼 text/plain)
    await dlg.locator('[data-progress-paste]').evaluate((el, text) => {
      el.focus();
      const dt = new DataTransfer();
      dt.setData('text/plain', text);
      el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true, cancelable: true }));
    }, TABLE);
    await page.waitForTimeout(300);
    const contents = await dlg.locator('[data-progress-table] input[data-cell$="-2"]').evaluateAll((els) => els.map((e) => e.value));
    check('표를 붙이면 머리줄을 빼고 5차시', contents.join('|') === '첫 차시|둘째 차시|셋째 차시|넷째 차시|다섯째 차시', contents.join('|'));
    const units = await dlg.locator('[data-progress-table] input[data-cell$="-0"]').evaluateAll((els) => els.map((e) => e.value));
    check('합친 단원 칸은 아래 줄로 잇는다', units[2] === '1. 점검 단원' && units[4] === '2. 다음 단원', units.join('|'));

    const preview = dlg.locator('[data-progress-preview]');
    await preview.locator('li[data-slot]').first().waitFor({ timeout: 10000 });
    const slots = await preview.locator('li[data-slot]').evaluateAll((els) => els.map((e) => e.getAttribute('data-slot')));
    const wantSlots = ['2027-03-08#1', '2027-03-08#3', '2027-03-10#2', '2027-03-12#4', '2027-03-15#2'];
    check('미리보기: 날짜·교시 차례, 공휴일(3/9)과 다른 과목은 빠진다', slots.join(',') === wantSlots.join(','), slots.join(','));
    const summary = await dlg.locator('[data-progress-summary]').innerText();
    check('미리보기 요약: 마지막 5차시는 3/15(월) 2교시', /마지막 5차시: 3\/15\(월\) 2교시/.test(summary), summary);
    check('저장 전에는 밀기 단추가 없다', (await preview.getByRole('button', { name: '밀기' }).count()) === 0);

    await dlg.getByRole('button', { name: '💾 저장' }).click();
    await page.getByText(`'${KEY}' 진도를 저장했습니다`).first().waitFor({ timeout: 10000 });
    const docs = (await getDocsFromServer(collection(db, 'users', uid, 'v4_progress'))).docs.filter((d) => d.data().key === KEY);
    const saved = docs[0]?.data();
    check('v4_progress에 저장된다 (칸 글자·시작일·5차시)', docs.length === 1 && saved.startDate === DAYS[0] && saved.lessons?.length === 5, JSON.stringify(saved?.lessons?.[0]));
    const planRef = docs[0]?.ref;

    // 밀기 - 3/8 3교시
    const row = preview.locator('li[data-slot="2027-03-08#3"]');
    await row.getByRole('button', { name: '밀기' }).click();
    await row.getByText('밀림').waitFor({ timeout: 10000 });
    const [afterBump, bumpMs] = await serverUntil(
      async () => (await getDocFromServer(planRef)).data(),
      (d) => (d.bumps || []).join(',') === '2027-03-08#3'
    );
    check('밀기: 서버 bumps에 그 교시', (afterBump.bumps || []).join(',') === '2027-03-08#3', `${JSON.stringify(afterBump.bumps)} ${bumpMs}ms`);
    const sumBump = await dlg.locator('[data-progress-summary]').innerText();
    check('밀면 뒤가 밀려 이 범위에서 1차시가 남는다', /1차시가 남습니다/.test(sumBump), sumBump);
    const nextText = await preview.locator('li[data-slot="2027-03-10#2"]').innerText();
    check('3/10 2교시는 2차시가 된다', /2\/5차시/.test(nextText), nextText.replace(/\s+/g, ' '));
    await page.screenshot({ path: 'tools/report/progress-modal.png' });
    await row.getByRole('button', { name: '되돌리기' }).click();
    const [afterUndo, undoMs] = await serverUntil(
      async () => (await getDocFromServer(planRef)).data(),
      (d) => (d.bumps || []).length === 0
    );
    check('되돌리기: bumps가 빈다', (afterUndo.bumps || []).length === 0, `${undoMs}ms`);

    // 칸 고치기: 둘째 줄 내용 → 화살표 아래로 → 마지막 줄 Enter로 줄 더하기
    const cell = dlg.locator('input[data-cell="1-2"]');
    await cell.fill('둘째 차시 (고침)');
    await cell.press('ArrowDown');
    const focused = await page.evaluate(() => document.activeElement?.getAttribute('data-cell'));
    check('화살표 아래로 다음 줄 같은 칸', focused === '2-2', focused);
    await dlg.locator('input[data-cell="4-2"]').press('Enter');
    await page.waitForTimeout(200);
    const rowsNow = await dlg.locator('[data-progress-table] input[data-cell$="-2"]').count();
    check('마지막 줄에서 Enter로 줄을 더한다', rowsNow === 6, String(rowsNow));
    const active = await page.evaluate(() => document.activeElement?.getAttribute('data-cell'));
    await page.keyboard.press('Control+s');
    const [afterEdit, editMs] = await serverUntil(
      async () => (await getDocFromServer(planRef)).data(),
      (d) => d.lessons?.[1]?.content === '둘째 차시 (고침)'
    );
    check(
      'Ctrl+S로 저장 - 고친 칸이 들어가고 빈 줄은 빠진다',
      afterEdit.lessons.length === 5 && afterEdit.lessons[1].content === '둘째 차시 (고침)',
      `${afterEdit.lessons[1].content} / ${afterEdit.lessons.length}줄 / 커서 ${active} / ${editMs}ms`
    );

    // 지우기 → 휴지통 → 복원
    await dlg.getByRole('button', { name: '🗑️ 지우기' }).click();
    await page.getByText('휴지통에서 복원할 수 있습니다').first().waitFor({ timeout: 10000 });
    check('지우면 v4_progress에서 빠진다', !(await getDocFromServer(planRef)).exists());
    await page.keyboard.press('Escape');
    await page.getByTitle(/^휴지통/).first().click();
    const trashRow = page.locator('div.bg-white.border.rounded-xl').filter({ hasText: `${KEY} 진도` }).first();
    await trashRow.waitFor({ timeout: 10000 });
    check('휴지통에 진도로 보인다', /진도/.test(await trashRow.innerText()));
    await trashRow.getByRole('button', { name: '복원' }).click();
    await page.getByText('복원되었습니다').first().waitFor({ timeout: 10000 });
    const back = (await getDocsFromServer(collection(db, 'users', uid, 'v4_progress'))).docs.filter((d) => d.data().key === KEY);
    check('복원하면 v4_progress에 돌아온다', back.length === 1 && back[0].data().lessons.length === 5);
  } finally {
    await cleanup();
  }
}

const SECTIONS = [
  ['5-1 시간표 적용', timetableApply],
  ['5-2 진도 관리 창', progressModal],
];
await cleanup();
for (const [name, run] of SECTIONS) {
  if (MATCH && !MATCH.test(name)) continue;
  console.log(`\n[${name}]`);
  try {
    await run();
  } catch (e) {
    check(`${name} - 멈춤`, false, String(e?.message || e).split('\n')[0]);
    await page.screenshot({ path: `tools/report/progress-fail.png` }).catch(() => {});
  }
}
await browser.close();
if (errors.length) console.log('\n── 페이지 오류 ──\n  ' + [...new Set(errors)].join('\n  '));

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
