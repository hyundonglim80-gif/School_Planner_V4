// tools/inspect-refine-u8.mjs
//
// 19번 U8 '거르개' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U8, PC 1400px, teacher).
//   라벨 학교 › A학교·B학교 를 심고, 메모 '학교만'·'A학교'·'B학교'와 그날 기록 셋.
//   - 메모 화면: 열면 하위가 접혀 있다, 학교 → 셋 모두, ▸ 펴고 '기타' → 학교만, 새로고침 뒤 다시 접힘
//   - 기록 거르개: 학교 → 셋, 기타 → 학교만
// 점검이 바꾼 라벨 문서·트리·메모·기록은 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u8.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검U8';
const DAY = '2026-10-21';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-u8');
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
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const labelsRef = uref('settings', 'labels');
const treeRef = uref('settings', 'v4_labelTree');
const dayRef = uref('journals', DAY);
const before = { labels: await read(labelsRef), tree: await read(treeRef), day: await read(dayRef) };
const memoIds = ['u8_school', 'u8_a', 'u8_b'];

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
  await page.waitForTimeout(1200);
}
const memoTexts = async () =>
  (await page.locator('[data-entry-card="memo"]').allInnerTexts()).map((t) => t.match(new RegExp(`${MARK} \\S+`))?.[0]).filter(Boolean).sort();
const journalTexts = async () =>
  (await page.locator('[data-entry-card="journal"]').allInnerTexts()).map((t) => t.match(new RegExp(`${MARK} \\S+`))?.[0]).filter(Boolean).sort();
async function openMemoScreen() {
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.locator('nav[aria-label="메모 라벨 거르개"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(1200);
}
const nav = () => page.locator('nav[aria-label="메모 라벨 거르개"]');
const memoChip = (name) => nav().getByRole('button', { name: new RegExp(`^(✓\\s*)?${name}\\s*\\d*$`) });

try {
  const L = before.labels || {};
  await setDoc(
    labelsRef,
    {
      memoLabels: [...(L.memoLabels || []), '학교', 'A학교', 'B학교'],
      journalLabels: [...(L.journalLabels || []), { id: 'j_u8_s', name: '학교', color: 'blue' }, { id: 'j_u8_a', name: 'A학교', color: 'green' }, { id: 'j_u8_b', name: 'B학교', color: 'yellow' }],
    },
    { merge: true }
  );
  await setDoc(treeRef, { entry: { A학교: '학교', B학교: '학교' }, memo: { A학교: '학교', B학교: '학교' }, journal: { A학교: '학교', B학교: '학교' } });
  const lbl = { u8_school: ['학교'], u8_a: ['학교', 'A학교'], u8_b: ['B학교'] };
  const txt = { u8_school: '학교만', u8_a: 'A학교', u8_b: 'B학교' };
  for (const id of memoIds) {
    await setDoc(uref('tasks', id), { content: `${MARK} ${txt[id]}`, text: `${MARK} ${txt[id]}`, labels: lbl[id], createdAt: Date.now(), completed: false, order: -Date.now() });
  }
  const ids = { u8_school: ['j_u8_s'], u8_a: ['j_u8_s', 'j_u8_a'], u8_b: ['j_u8_b'] };
  await setDoc(dayRef, {
    ...(before.day || {}),
    entries: [
      ...(before.day?.entries || []),
      ...memoIds.map((id) => ({ id: `jr_${id}`, content: `${MARK} ${txt[id]}`, createdAt: Date.now(), label: '', labelIds: ids[id], linkedItems: [], imageUrl: '', attachments: [] })),
    ],
    updatedAt: Date.now(),
  });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);

  // ── 메모 거르개 ──
  await openMemoScreen();
  await memoChip('학교').waitFor({ timeout: 10000 });
  check('메모 화면을 열면 하위(A학교)가 접혀 있다', (await memoChip('A학교').count()) === 0 && (await nav().getByRole('button', { name: '학교 하위 라벨 펼치기' }).count()) === 1);
  await memoChip('학교').click();
  await page.waitForTimeout(600);
  check('학교 → 학교만·A학교·B학교 메모 모두', JSON.stringify(await memoTexts()) === JSON.stringify([`${MARK} A학교`, `${MARK} B학교`, `${MARK} 학교만`]), (await memoTexts()).join(','));
  await nav().getByRole('button', { name: '학교 하위 라벨 펼치기' }).click();
  const other = nav().locator('[data-filter-other="학교"]');
  check("펼치면 하위와 '기타'(점선) 칩", (await memoChip('A학교').count()) === 1 && (await other.count()) === 1 && /border-dashed|bg-slate-100/.test((await other.getAttribute('class')) || ''));
  await other.click();
  await page.waitForTimeout(600);
  check("'기타' → 하위 없이 학교만 붙은 메모", JSON.stringify(await memoTexts()) === JSON.stringify([`${MARK} 학교만`]), (await memoTexts()).join(','));
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 }).catch(() => {});
  await openMemoScreen();
  check('새로고침 뒤 다시 접혀 있다 (고른 기타는 보인다)', (await memoChip('A학교').count()) === 0 && (await nav().locator('[data-filter-other="학교"]').getAttribute('aria-pressed')) === 'true');
  await nav().getByRole('button', { name: /전체 메모/ }).click();

  // ── 기록 거르개 ──
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.waitForTimeout(800);
  await pickDate(DAY);
  await page.locator('[data-entry-card="journal"]').first().waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: '학교', exact: true }).click();
  await page.waitForTimeout(500);
  check('기록 거르개: 학교 → 셋 모두', JSON.stringify(await journalTexts()) === JSON.stringify([`${MARK} A학교`, `${MARK} B학교`, `${MARK} 학교만`]), (await journalTexts()).join(','));
  await page.getByRole('button', { name: '학교 하위 라벨 펼치기' }).click();
  await page.locator('[data-filter-other="학교"]').click();
  await page.waitForTimeout(500);
  check("기록 거르개: '기타' → 학교만", JSON.stringify(await journalTexts()) === JSON.stringify([`${MARK} 학교만`]), (await journalTexts()).join(','));
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 1200));
  await browser.close();
  if (before.labels) await setDoc(labelsRef, before.labels);
  if (before.tree) await setDoc(treeRef, before.tree);
  else await deleteDoc(treeRef);
  if (before.day) await setDoc(dayRef, before.day);
  else await deleteDoc(dayRef);
  for (const id of memoIds) await deleteDoc(uref('tasks', id));
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
