// tools/inspect-refine-u6.mjs
//
// 19번 U6 '한 카드·한 쓰는 칸' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U6, PC 1400px, teacher).
//   - 메모 카드·기록 카드가 같은 EntryCard: 라벨 칩이 머리줄에, 카드 아래 '#라벨' 없음
//   - 기록 카드 ☐ 완료 → 서버 그 항목만 completed, 같은 날 기록 수 그대로, 새로고침 뒤에도 완료
//   - 기록 ★ → 그날 기록의 맨 위
//   - 쓰는 칸 머리줄 ★: 쓰던 글은 칸에 남고(저장 안 됨) 즐겨찾기만 곧바로 저장
//   - 새 메모에서 머리줄 ☐ 완료를 켜고 저장 → 서버 completed
// 점검이 바꾼 기록 문서·만든 메모는 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u6.mjs
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
const MARK = '점검U6';
const DAY = '2026-10-16';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-u6');
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

const dayRef = uref('journals', DAY);
const dayBefore = await read(dayRef);
const memoRef = uref('tasks', 'memo_inspect_u6');
const entry = (id, content, labelIds, extra = {}) => ({ id, content, createdAt: Date.now(), label: '', labelIds, linkedItems: [], imageUrl: '', attachments: [], ...extra });

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
const jCard = (text) => page.locator('[data-entry-card="journal"]', { hasText: text }).first();
const entriesOf = async () => (await read(dayRef))?.entries || [];

try {
  const others = (dayBefore?.entries || []).length;
  await setDoc(dayRef, {
    ...(dayBefore || {}),
    entries: [...(dayBefore?.entries || []), entry('jr_u6_a', `${MARK} 첫째`, ['j_1']), entry('jr_u6_b', `${MARK} 둘째`, ['j_2'])],
    updatedAt: Date.now(),
  });
  await setDoc(memoRef, { content: `${MARK} 메모`, text: `${MARK} 메모`, labels: ['긴급'], createdAt: Date.now(), completed: false, order: -Date.now() });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);
  await pickDate(DAY);

  // ── 기록 카드 모양 ──
  const a = jCard(`${MARK} 첫째`);
  await a.waitFor({ timeout: 10000 });
  check('기록 카드가 EntryCard, 라벨 칩(학급활동)이 머리줄에', (await a.locator('[data-entry-card-label="학급활동"]').count()) === 1);
  check("카드에 '#라벨' 없음", !(await a.innerText()).includes('#'));

  // ── 기록 완료 ──
  await a.locator('[data-entry-card-complete]').click();
  const afterDone = await serverUntil(entriesOf, (es) => es.some((e) => e.id === 'jr_u6_a' && e.completed));
  check(
    '☐ 완료 → 서버 그 항목만 completed, 같은 날 기록 수 그대로',
    afterDone.find((e) => e.id === 'jr_u6_a')?.completed === true && !afterDone.find((e) => e.id === 'jr_u6_b')?.completed && afterDone.length === others + 2,
    `${afterDone.length}건`
  );
  // ── 기록 ★ → 맨 위 ──
  await jCard(`${MARK} 둘째`).locator('[data-entry-card-favorite]').click();
  await serverUntil(entriesOf, (es) => es.some((e) => e.id === 'jr_u6_b' && e.favorite));
  await page.waitForTimeout(800);
  const firstCard = await page.locator('[data-entry-card="journal"]').first().innerText();
  check('★ 즐겨찾기한 기록이 그날 기록의 맨 위', firstCard.includes(`${MARK} 둘째`), firstCard.replace(/\s+/g, ' ').slice(0, 60));

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  await pickDate(DAY);
  await jCard(`${MARK} 첫째`).waitFor({ timeout: 10000 });
  check('새로고침 뒤에도 완료·즐겨찾기', (await jCard(`${MARK} 첫째`).getAttribute('data-completed')) === 'true' && (await jCard(`${MARK} 둘째`).getAttribute('data-favorite')) === 'true');

  // ── 쓰는 칸 머리줄 ★ (쓰던 글은 칸에 남는다) ──
  await jCard(`${MARK} 첫째`).click();
  const panel = page.locator('aside[aria-label="기록 쓰기"]');
  await panel.waitFor({ timeout: 10000 });
  const box = panel.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
  await box.fill(`${MARK} 첫째 (쓰는 중)`);
  await panel.locator('[data-entry-flag="favorite"]').click();
  const afterFav = await serverUntil(entriesOf, (es) => es.some((e) => e.id === 'jr_u6_a' && e.favorite));
  const aNow = afterFav.find((e) => e.id === 'jr_u6_a');
  check(
    '쓰는 칸 머리줄 ★ → 즐겨찾기만 곧바로 저장, 쓰던 글은 칸에 그대로(서버 글은 그대로)',
    aNow?.favorite === true && aNow?.content === `${MARK} 첫째` && (await box.inputValue()) === `${MARK} 첫째 (쓰는 중)`,
    `${aNow?.content} / ${await box.inputValue()}`
  );
  check('쓰는 칸 머리줄 ☐ 완료는 켜져 보인다 (카드에서 켠 것)', (await panel.locator('[data-entry-flag="completed"]').getAttribute('aria-pressed')) === 'true');
  await panel.getByTitle('닫기').first().click();
  await page.waitForTimeout(600);

  // ── 메모 카드·새 메모에서 완료 ──
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.waitForTimeout(1500);
  const allBtn = page.getByRole('button', { name: /전체 메모/ }).first();
  if (await allBtn.count()) await allBtn.click();
  await page.waitForTimeout(800);
  const m = page.locator('[data-entry-card="memo"]', { hasText: `${MARK} 메모` }).first();
  await m.waitFor({ timeout: 10000 });
  check('메모 카드도 같은 EntryCard, 칩(긴급)이 머리줄, #라벨 없음', (await m.locator('[data-entry-card-label="긴급"]').count()) === 1 && !(await m.innerText()).includes('#긴급'));

  await page.getByRole('button', { name: /새 메모/ }).first().click();
  const mPanel = page.locator('aside[aria-label="메모 쓰기"]');
  await mPanel.waitFor({ timeout: 10000 });
  await mPanel.locator('[data-entry-flag="completed"]').click();
  await mPanel.locator('textarea').first().fill(`${MARK} 새 메모 완료`);
  await mPanel.locator('textarea').first().press('Control+s');
  const created = await serverUntil(
    async () => (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs.map((d) => d.data()).find((d) => d.content === `${MARK} 새 메모 완료`),
    (d) => !!d
  );
  check('새 메모에서 머리줄 ☐ 완료를 켜고 저장 → 서버 completed', created?.completed === true, JSON.stringify({ completed: created?.completed }));
  await page.waitForTimeout(800);
  check('저장 뒤에도 머리줄 완료가 켜져 있다', (await mPanel.locator('[data-entry-flag="completed"]').getAttribute('aria-pressed')) === 'true');
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();
  if (dayBefore) await setDoc(dayRef, dayBefore);
  else await deleteDoc(dayRef);
  await deleteDoc(memoRef);
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs) {
    if (String(d.data().content || '').startsWith(MARK)) await deleteDoc(d.ref);
  }
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
