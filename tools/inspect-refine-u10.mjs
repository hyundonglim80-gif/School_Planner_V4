// tools/inspect-refine-u10.mjs
//
// 19번 U10 "'#라벨' 마지막 줄 + 빈 라벨 정리" - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U10, PC 1400px, teacher).
//   - 새 메모 마지막 줄 '#새라벨 #업무' → 미리보기 칩 둘(새로 만듦 표시), 저장하면 라벨 둘·줄 사라짐, 라벨 문서 두 배열에 '새라벨'
//   - 새 기록 마지막 줄 '#기록라벨 #26040305' → 라벨(기록 id jm_…)·학생 태그 줄은 남는다
//   - 라벨 관리: 항목 수 세기 → 빈 라벨 정리 → 서버 두 배열에서 빠지고 쓰는 라벨은 남는다
// 점검이 바꾼 라벨 문서·트리·기록·메모·휴지통은 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u10.mjs
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
const MARK = '점검U10';
const DAY = '2026-10-26';
const NEW1 = '새라벨U10';
const NEW2 = '기록라벨U10';
const EMPTY = '빈라벨U10';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-u10');
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
async function serverUntil(fn, ok, timeout = 10000) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 300));
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
const before = { labels: await read(labelsRef), tree: await read(treeRef), day: await read(dayRef) };
const trashBefore = new Set((await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs.map((d) => d.id));
const memosMine = async () =>
  (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs.filter((d) => String(d.data().content || '').startsWith(MARK));
const nameOf = (l) => (typeof l === 'string' ? l : l?.name);

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
async function openLabels() {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /라벨 관리/ }).click();
  const dlg = page.locator('[role=dialog]', { hasText: '라벨 관리' }).last();
  await dlg.waitFor({ timeout: 10000 });
  await dlg.locator('[data-label-tab="entry"]').click();
  await dlg.locator('[data-label-row]').first().waitFor({ timeout: 10000 });
  return dlg;
}

try {
  // 빈 라벨 하나를 심는다 (정리 대상)
  const L = before.labels || {};
  await setDoc(labelsRef, { journalLabels: [...(L.journalLabels || []), { id: 'j_u10_empty', name: EMPTY, color: 'gray' }] }, { merge: true });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);

  // ── 새 메모: 마지막 줄 #라벨 ──
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /새 메모/ }).first().click();
  const mPanel = page.locator('aside[aria-label="메모 쓰기"]');
  await mPanel.waitFor({ timeout: 10000 });
  const mBox = mPanel.locator('textarea').first();
  await mBox.fill(`${MARK} 메모\n#${NEW1} #업무`);
  const preview = mPanel.locator('[data-hash-preview]');
  await preview.waitFor({ timeout: 5000 });
  check(
    "미리보기 칩 둘, 새 라벨에만 '(새로 만듦)'",
    (await preview.locator('[data-hash-label]').count()) === 2 &&
      (await preview.locator(`[data-hash-label="${NEW1}"]`).getAttribute('data-new')) === 'true' &&
      (await preview.locator('[data-hash-label="업무"]').getAttribute('data-new')) === null,
    await preview.innerText()
  );
  await mBox.press('Control+s');
  const memo = (await serverUntil(memosMine, (ds) => ds.length === 1))[0]?.data();
  // 새 항목은 맨 위(기본) 라벨이 미리 골라져 있다 - 그 뒤에 붙는다
  check('저장 → 메모에 라벨 둘이 더해지고, 글에서 마지막 줄이 사라진다', memo?.content === `${MARK} 메모` && JSON.stringify((memo?.labels || []).slice(-2)) === JSON.stringify([NEW1, '업무']), JSON.stringify({ c: memo?.content, l: memo?.labels }));
  const lbl1 = await serverUntil(() => read(labelsRef), (d) => (d?.memoLabels || []).some((l) => nameOf(l) === NEW1) && (d?.journalLabels || []).some((l) => l.name === NEW1));
  check("라벨 문서 두 배열에 '새라벨' (기록 id jm_…)", (lbl1?.journalLabels || []).some((l) => l.id === `jm_${NEW1}`));
  await page.waitForTimeout(1000);
  check(
    '칸에 뗀 글과 고른 칩이 보인다',
    (await mBox.inputValue()) === `${MARK} 메모` && (await mPanel.locator(`[data-entry-label-chip="${NEW1}"]`).getAttribute('aria-pressed')) === 'true'
  );
  await mPanel.getByTitle('닫기').first().click().catch(() => {});
  await page.waitForTimeout(500);

  // ── 새 기록: 학생 태그는 남는다 ──
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.waitForTimeout(800);
  await pickDate(DAY);
  await page.getByRole('button', { name: '기록 추가' }).first().click();
  const jPanel = page.locator('aside[aria-label="기록 쓰기"]').first();
  await jPanel.waitFor({ timeout: 10000 });
  await jPanel.locator('textarea').first().fill(`${MARK} 기록\n#${NEW2} #26040305`);
  await jPanel.locator('textarea').first().press('Control+s');
  const es = await serverUntil(async () => (await read(dayRef))?.entries || [], (l) => l.some((e) => String(e.content).startsWith(MARK)));
  const j = es.find((e) => String(e.content).startsWith(MARK));
  check('기록: 라벨 id jm_기록라벨, 학생 태그 줄은 남는다', j?.content === `${MARK} 기록\n#26040305` && (j?.labelIds || []).includes(`jm_${NEW2}`), JSON.stringify({ c: j?.content, ids: j?.labelIds }));
  await page.waitForTimeout(1200);
  const card = page.locator('[data-entry-card="journal"]', { hasText: `${MARK} 기록` }).first();
  check('기록 카드에 새 라벨 칩', (await card.locator(`[data-entry-card-label="${NEW2}"]`).count()) === 1);
  await jPanel.getByTitle('닫기').first().click().catch(() => {});
  await page.waitForTimeout(500);

  // ── 빈 라벨 정리 ──
  const dlg = await openLabels();
  await dlg.locator('[data-label-count]').click();
  await dlg.locator(`[data-label-usage="${NEW1}"]`).waitFor({ timeout: 20000 });
  check('항목 수: 새라벨 메모 1, 빈라벨 0', /메모 1 · 기록 0/.test(await dlg.locator(`[data-label-usage="${NEW1}"]`).innerText()) && /메모 0 · 기록 0 · 휴지통 0/.test(await dlg.locator(`[data-label-usage="${EMPTY}"]`).innerText()));
  await dlg.locator('[data-label-prune]').click();
  const list = dlg.locator('[data-label-prune-list]');
  await list.waitFor({ timeout: 5000 });
  check('정리 목록에 빈라벨(체크됨), 쓰는 라벨은 없다', (await list.locator(`[data-label-prune-item="${EMPTY}"]`).isChecked()) && (await list.locator(`[data-label-prune-item="${NEW1}"]`).count()) === 0);
  // 빈라벨만 남기고 나머지 체크를 뺀다 (seed 라벨은 지우지 않게)
  for (const box of await list.locator('[data-label-prune-item]').all()) {
    if ((await box.getAttribute('data-label-prune-item')) !== EMPTY && (await box.isChecked())) await box.uncheck();
  }
  await list.locator('[data-label-prune-confirm]').click();
  const lbl2 = await serverUntil(() => read(labelsRef), (d) => !(d?.journalLabels || []).some((l) => l.name === EMPTY));
  check(
    '정리 → 서버 두 배열에서 빠지고 쓰는 라벨은 남는다',
    !(lbl2?.journalLabels || []).some((l) => l.name === EMPTY) && !(lbl2?.memoLabels || []).some((l) => nameOf(l) === EMPTY) && (lbl2?.journalLabels || []).some((l) => l.name === NEW1),
  );
  const trash = (await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs.map((d) => d.data());
  check('지운 라벨은 휴지통에', trash.some((t) => t.type === 'label' && String(t.content).includes(EMPTY)));
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 2000));
  await browser.close();
  if (before.labels) await setDoc(labelsRef, before.labels);
  else await deleteDoc(labelsRef);
  if (before.tree) await setDoc(treeRef, before.tree);
  else await deleteDoc(treeRef);
  if (before.day) await setDoc(dayRef, before.day);
  else await deleteDoc(dayRef);
  for (const d of await memosMine()) await deleteDoc(d.ref);
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs) if (!trashBefore.has(d.id)) await deleteDoc(d.ref);
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
