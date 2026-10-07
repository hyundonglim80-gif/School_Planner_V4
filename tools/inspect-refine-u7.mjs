// tools/inspect-refine-u7.mjs
//
// 19번 U7 '날짜 칸 = 자리' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U7, PC 1400px, teacher).
//   - 메모 쓰는 칸 '📅 날짜'에 날짜 → 저장: 그날 기록 칸에 같은 글·라벨·첨부·표, 메모는 사라지고 휴지통에 '(날짜를 바꿈)',
//     링크된 일정의 링크가 새 기록을 가리킨다, 칸은 '기록 수정'으로 따라간다
//   - 되돌리기 → 메모가 돌아오고 그날 기록에서 빠진다
//   - 기록 날짜 바꾸기(다른 날) → 그날로, 기록 날짜 빼기 → 메모(fromDate, 카드에 '📅 m/d에서')
//   - 옛 '↔ 기록으로/메모로' 단추가 없다
// 점검이 만든 메모·기록·일정·휴지통은 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u7.mjs
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
const MARK = '점검U7';
const DAY0 = '2026-10-19'; // 링크된 일정이 있는 날
const DAY = '2026-10-20';
const DAY2 = '2026-10-22';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-u7');
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

const refs = { ev: uref('events', DAY0), d1: uref('journals', DAY), d2: uref('journals', DAY2) };
const before = { ev: await read(refs.ev), d1: await read(refs.d1), d2: await read(refs.d2) };
const memoRef = uref('tasks', 'memo_inspect_u7');
const EV_ID = 'ev_inspect_u7';
const entriesOf = async (r) => (await read(r))?.entries || [];
const mine = (es) => es.filter((e) => String(e.content || '').startsWith(MARK));
const memosMine = async () =>
  (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs.filter((d) => String(d.data().content || '').startsWith(MARK));

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
const panel = () => page.locator('aside[aria-label$="쓰기"]').first();

try {
  // 링크된 일정 + 메모 (라벨·첨부·표)
  const evList = [...(before.ev?.eventList || [])];
  evList.push({
    id: EV_ID,
    content: `${MARK} 일정`,
    completed: false,
    label: '달력',
    labelIds: ['ev_1'],
    attachments: [],
    linkedItems: [{ targetType: 'memo', targetId: 'memo_inspect_u7', targetDate: '', title: `[메모] ${MARK} 메모`, targetFId: 'personal' }],
  });
  await setDoc(refs.ev, { ...(before.ev || {}), eventList: evList, updatedAt: Date.now() });
  await setDoc(memoRef, {
    content: `${MARK} 메모`,
    text: `${MARK} 메모`,
    labels: ['학급활동'],
    attachments: [{ name: 'u7.txt', url: 'https://example.com/u7.txt', type: 'file' }],
    tables: [{ id: 'tb_u7', createdAt: 1, rows: [{ cells: [{ v: '가' }, { v: '나' }] }] }],
    linkedItems: [{ targetType: 'event', targetId: EV_ID, targetDate: DAY0, title: `[${DAY0}] ${MARK} 일정`, targetFId: 'personal' }],
    createdAt: 1700000000000,
    completed: false,
    order: -Date.now(),
  });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1000);

  // ── 메모 → 날짜 넣기 ──
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.waitForTimeout(1200);
  const allBtn = page.getByRole('button', { name: /전체 메모/ }).first();
  if (await allBtn.count()) await allBtn.click();
  await page.locator('[data-entry-card="memo"]', { hasText: `${MARK} 메모` }).first().getByText(`${MARK} 메모`).first().click();
  await panel().waitFor({ timeout: 10000 });
  check("메모 쓰는 칸에 '📅 날짜' 칸(비어 있음 = 메모), 옛 '↔ 기록으로' 단추 없음",
    (await panel().locator('[data-entry-date]').inputValue()) === '' && (await panel().getByRole('button', { name: /기록으로/ }).count()) === 0);
  await panel().locator('[data-entry-date]').fill(DAY);
  check('날짜를 넣으면 "저장하면 … 기록으로 옮깁니다"', /기록으로 옮깁니다/.test(await panel().locator('[data-entry-place-hint]').innerText()));
  await panel().locator('textarea').first().press('Control+s');
  const moved = await serverUntil(() => entriesOf(refs.d1), (es) => mine(es).length === 1);
  const j = mine(moved)[0];
  check(
    '그날 기록에 같은 글·라벨(id)·첨부·표·처음 쓴 때',
    j?.content === `${MARK} 메모` && (j?.labelIds || []).join() === 'j_1' && j?.attachments?.[0]?.name === 'u7.txt' && j?.tables?.[0]?.id === 'tb_u7' && j?.createdAt === 1700000000000,
    JSON.stringify({ labelIds: j?.labelIds, att: j?.attachments?.length, tables: j?.tables?.length })
  );
  check('메모는 사라진다', !(await read(memoRef)));
  const trash = (await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs.map((d) => d.data());
  check("휴지통에 '(날짜를 바꿈)' 사본", trash.some((t) => String(t.content).startsWith('(날짜를 바꿈)') && String(t.content).includes(MARK)));
  const ev = (await read(refs.ev)).eventList.find((e) => e.id === EV_ID);
  check('링크된 일정의 링크가 새 기록을 가리킨다', ev?.linkedItems?.some((l) => l.targetType === 'journal' && l.targetId === j?.id && l.targetDate === DAY), JSON.stringify(ev?.linkedItems));
  await page.waitForTimeout(800);
  check("칸이 '기록 수정'으로 따라가고 날짜 칸이 그 날짜", (await panel().getAttribute('aria-label')) === '기록 쓰기' && (await panel().locator('[data-entry-date]').inputValue()) === DAY);

  // ── 되돌리기 ──
  await page.getByRole('button', { name: '되돌리기' }).first().click();
  const back = await serverUntil(() => read(memoRef), (d) => !!d);
  const d1After = await serverUntil(() => entriesOf(refs.d1), (es) => mine(es).length === 0);
  check('되돌리기 → 메모가 돌아오고 그날 기록에서 빠진다', !!back && mine(d1After).length === 0);
  await page.waitForTimeout(800);
  await page.getByTitle('닫기').first().click().catch(() => {});
  await page.waitForTimeout(500);

  // ── 다시 옮겨서 기록 날짜 바꾸기 → 날짜 빼기 ──
  await page.locator('[data-entry-card="memo"]', { hasText: `${MARK} 메모` }).first().getByText(`${MARK} 메모`).first().click();
  await panel().waitFor({ timeout: 10000 });
  await panel().locator('[data-entry-date]').fill(DAY);
  await panel().locator('textarea').first().press('Control+s');
  await serverUntil(() => entriesOf(refs.d1), (es) => mine(es).length === 1);
  await page.waitForTimeout(1200);
  await panel().locator('[data-entry-date]').fill(DAY2);
  await panel().locator('textarea').first().fill(`${MARK} 메모 (고침)`);
  await panel().locator('textarea').first().press('Control+s');
  const d2 = await serverUntil(() => entriesOf(refs.d2), (es) => mine(es).length === 1);
  const d1 = await entriesOf(refs.d1);
  check('기록 날짜 바꾸기 → 고친 글째 다른 날로, 원래 날에서 빠진다', mine(d2)[0]?.content === `${MARK} 메모 (고침)` && mine(d1).length === 0, `${mine(d2).length}/${mine(d1).length}`);
  await page.waitForTimeout(1200);
  await panel().locator('[data-entry-date-clear]').click();
  await panel().locator('textarea').first().press('Control+s');
  const memos = await serverUntil(memosMine, (ds) => ds.length === 1);
  const m = memos[0]?.data();
  check('기록 날짜 빼기 → 메모(fromDate, 글에 날짜 줄 없음), 그날 기록에서 빠진다',
    m?.fromDate === DAY2 && m?.content === `${MARK} 메모 (고침)` && mine(await entriesOf(refs.d2)).length === 0, JSON.stringify({ fromDate: m?.fromDate }));
  await page.waitForTimeout(800);
  await page.getByTitle('닫기').first().click().catch(() => {});
  await page.waitForTimeout(800);
  const note = await page.locator('[data-entry-card="memo"]', { hasText: `${MARK} 메모 (고침)` }).first().locator('[data-entry-card-note]').innerText().catch(() => '');
  check("메모 카드에 '📅 10/22에서'", note.includes('10/22에서'), note);
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();
  for (const [k, r] of Object.entries(refs)) {
    if (before[k]) await setDoc(r, before[k]);
    else await deleteDoc(r);
  }
  await deleteDoc(memoRef);
  for (const d of await memosMine()) await deleteDoc(d.ref);
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs) {
    if (String(d.data().content || '').includes(MARK)) await deleteDoc(d.ref);
  }
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
