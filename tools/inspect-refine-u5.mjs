// tools/inspect-refine-u5.mjs
//
// 19번 U5 '메모·기록 라벨 한 목록' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U5, PC 1400px, teacher).
//   - 라벨 관리: 탭이 '일정 라벨'·'메모·기록 라벨' 둘, 한 목록에 기록 라벨(학급활동)·메모 라벨(긴급)이 함께
//   - 새 라벨 → 서버 memoLabels(seed는 문자열 모양 그대로)와 journalLabels에 같은 이름, 있던 기록 id 그대로, 일정 라벨은 V3 이름도
//   - 기록 쓰는 칸·메모 쓰는 칸에 같은 칩
//   - 메모에만 있던 라벨(긴급)을 기록에 붙여 저장 → journalLabels에 'jm_긴급'이 채워지고 기록 labelIds도 그 id
//   - 이름 바꾸기 → 그 라벨이 붙은 메모의 라벨도 새 이름
// 점검이 바꾼 라벨 문서·트리·만든 메모·기록·휴지통은 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u5.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
} from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검U5';
const DAY = '2026-10-15';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-u5');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uref = (...p) => doc(db, 'users', user.uid, ...p);
const read = async (r) => {
  const s = await getDocFromServer(r);
  return s.exists() ? s.data() : null;
};
async function serverUntil(fn, ok, timeout = 8000) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await fn();
  }
  return v;
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const labelsRef = uref('settings', 'labels');
const treeRef = uref('settings', 'v4_labelTree');
const dayRef = uref('journals', DAY);
const memoRef = uref('tasks', 'memo_inspect_u5');
const labelsBefore = await read(labelsRef);
const treeBefore = await read(treeRef);
const dayBefore = await read(dayRef);

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

async function pickDate(date) {
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await page.waitForTimeout(300);
  }
  await direct.fill(date);
  await page.mouse.move(5, 600);
  await page.waitForTimeout(1000);
}
async function openLabels() {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /라벨 관리/ }).click();
  const dlg = page.locator('[role=dialog]', { hasText: '라벨 관리' }).last();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator('[data-label-tab="entry"]').click();
  await dlg.locator('[data-label-row]').first().waitFor({ timeout: 10000 });
  return dlg;
}
const chips = (panel) => panel.locator('[data-entry-label-chip]').evaluateAll((els) => els.map((e) => e.getAttribute('data-entry-label-chip')));

try {
  // 이름 바꾸기 확인용 메모 (라벨은 다음 단계에서 더할 'U5라벨')
  await setDoc(memoRef, { content: `${MARK} 메모`, labels: ['U5라벨'], createdAt: Date.now(), completed: false });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);

  // ── 라벨 관리: 탭 둘, 한 목록 ──
  let dlg = await openLabels();
  const tabs = await dlg.getByRole('button').evaluateAll((els) => els.map((e) => e.textContent || '').filter((t) => /라벨 \(\d+\)/.test(t)));
  check("탭이 '일정 라벨'·'메모·기록 라벨' 둘", tabs.length === 2 && tabs.some((t) => t.includes('메모·기록 라벨')), tabs.join(' | '));
  const rows = await dlg.locator('[data-label-row]').evaluateAll((els) => els.map((e) => e.getAttribute('data-label-row')));
  check('한 목록에 기록 라벨(학급활동)·메모 라벨(긴급)', rows.includes('학급활동') && rows.includes('긴급') && rows.indexOf('학급활동') < rows.indexOf('긴급'), rows.join(','));

  await dlg.getByLabel('새 메모·기록 라벨 이름').fill('U5라벨');
  await dlg.getByRole('button', { name: '추가', exact: true }).last().click();
  const after = await serverUntil(() => read(labelsRef), (d) => (d?.journalLabels || []).some((l) => l.name === 'U5라벨'));
  check(
    "새 라벨 → memoLabels(문자열 모양)·journalLabels에 'U5라벨'",
    after.memoLabels.includes('U5라벨') && after.memoLabels.every((m) => typeof m === 'string') && after.journalLabels.some((l) => l.name === 'U5라벨'),
    JSON.stringify(after.memoLabels)
  );
  check(
    '있던 기록 라벨 id 그대로(j_1~j_4), 메모에만 있던 라벨도 기록 쪽에(jm_긴급)',
    ['j_1', 'j_2', 'j_3', 'j_4'].every((id) => after.journalLabels.some((l) => l.id === id)) && after.journalLabels.some((l) => l.id === 'jm_긴급'),
    after.journalLabels.map((l) => l.id).join(',')
  );
  check('일정 라벨은 V3 이름도 함께 (isForward·showInCalendar)', after.eventLabels.every((l) => typeof l.isForward === 'boolean' && typeof l.showInCalendar === 'boolean'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── 기록 쓰는 칸·메모 쓰는 칸의 칩 ──
  await pickDate(DAY);
  await page.getByRole('button', { name: '기록 추가' }).click();
  const jPanel = page.locator('aside[aria-label="기록 쓰기"]');
  await jPanel.waitFor({ timeout: 10000 });
  const jChips = await chips(jPanel);
  check('기록 쓰는 칸 칩에 메모 라벨(긴급)·새 라벨(U5라벨)도', jChips.includes('긴급') && jChips.includes('U5라벨') && jChips.includes('학급활동'), jChips.join(','));

  // 메모에만 있던 '긴급'은 이제 두 배열에 다 있다 - 이번엔 V3가 메모에만 더한 라벨을 흉내 낸다
  const cur = await read(labelsRef);
  await setDoc(labelsRef, { memoLabels: [...cur.memoLabels, 'V3메모만'] }, { merge: true });
  await page.waitForTimeout(1500);
  for (const name of await chips(jPanel)) {
    if ((await jPanel.locator(`[data-entry-label-chip="${name}"]`).getAttribute('aria-pressed')) === 'true') {
      await jPanel.locator(`[data-entry-label-chip="${name}"]`).click();
    }
  }
  await jPanel.locator('[data-entry-label-chip="V3메모만"]').click();
  await jPanel.getByPlaceholder(/오늘 있었던 일을 기록해보세요/).fill(`${MARK} 기록`);
  await jPanel.getByPlaceholder(/오늘 있었던 일을 기록해보세요/).press('Control+s');
  const saved = await serverUntil(() => read(labelsRef), (d) => (d?.journalLabels || []).some((l) => l.name === 'V3메모만'));
  const jl = saved.journalLabels.find((l) => l.name === 'V3메모만');
  const day = await serverUntil(() => read(dayRef), (d) => (d?.entries || []).some((e) => String(e.content).startsWith(MARK)));
  const entry = (day?.entries || []).find((e) => String(e.content).startsWith(MARK));
  check(
    "메모에만 있던 라벨을 기록에 붙여 저장 → journalLabels에 'jm_V3메모만', 기록 labelIds도 그 id",
    jl?.id === 'jm_V3메모만' && (entry?.labelIds || []).join(',') === 'jm_V3메모만',
    `${jl?.id} / ${JSON.stringify(entry?.labelIds)}`
  );
  await page.getByTitle('닫기').first().click();
  await page.waitForTimeout(600);

  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.getByRole('button', { name: /새 메모/ }).first().click();
  const mPanel = page.locator('aside[aria-label="메모 쓰기"]');
  await mPanel.waitFor({ timeout: 10000 });
  const mChips = await chips(mPanel);
  check(
    '메모 쓰는 칸 칩도 같은 목록 (기록 칸과 같은 차례, 기록 라벨 학급활동 포함)',
    JSON.stringify(mChips) === JSON.stringify([...jChips, 'V3메모만']) && mChips.includes('학급활동'),
    mChips.join(',')
  );
  await page.getByTitle('닫기').first().click();
  await page.waitForTimeout(500);

  // ── 이름 바꾸기 ──
  dlg = await openLabels();
  const box = dlg.locator('[data-label-row="U5라벨"] input[type=text]');
  await box.fill('U5바꿈');
  await dlg.getByRole('button', { name: /^💾\s*저장$/ }).click();
  const memo = await serverUntil(() => read(memoRef), (d) => (d?.labels || []).includes('U5바꿈'), 10000);
  const lab = await read(labelsRef);
  check(
    '이름 바꾸기 → 두 배열과 그 라벨이 붙은 메모가 새 이름',
    (memo?.labels || []).includes('U5바꿈') && lab.memoLabels.includes('U5바꿈') && lab.journalLabels.some((l) => l.name === 'U5바꿈'),
    JSON.stringify(memo?.labels)
  );
  const tree = await read(treeRef);
  check('트리는 entry 하나를 memo·journal에도 같게', !tree || (tree.entry && JSON.stringify(tree.entry) === JSON.stringify(tree.memo)));
  await page.keyboard.press('Escape');
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 2500));
  await browser.close();
  if (labelsBefore) await setDoc(labelsRef, labelsBefore);
  if (treeBefore) await setDoc(treeRef, treeBefore);
  else await deleteDoc(treeRef);
  if (dayBefore) await setDoc(dayRef, dayBefore);
  else await deleteDoc(dayRef);
  await deleteDoc(memoRef);
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs) {
    if (String(d.data().content || '').startsWith(MARK)) await deleteDoc(d.ref);
  }
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs) {
    const c = String(d.data().content || '');
    if (c.includes(MARK) || c.includes('U5라벨') || c.includes('U5바꿈')) await deleteDoc(d.ref);
  }
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
