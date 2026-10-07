// tools/inspect-refine-u9.mjs
//
// 19번 U9 '체크리스트' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U9, PC 1400px, teacher).
//   - 새 메모 쓰는 칸: 세 줄을 고르고 '☑ 체크리스트' → 줄마다 '☐ ', 다시 누르면 뗀다
//   - 체크 줄 끝에서 Enter → 다음 줄도 '☐ ', 빈 '☐ '에서 Enter → 목록 끝
//   - 저장한 메모 카드에 '☑ 0/3', 카드의 줄을 누르면 서버 글이 '☑'로
//   - 그날 기록 카드의 체크 줄을 누르면 그 기록 글만 바뀌고 다른 기록은 그대로
// 점검이 만든 메모·바꾼 기록 문서는 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u9.mjs
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
const MARK = '점검U9';
const DAY = '2026-10-23';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-u9');
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

const dayRef = uref('journals', DAY);
const dayBefore = await read(dayRef);
const memosMine = async () =>
  (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs.filter((d) => String(d.data().content || '').startsWith(MARK));
const entry = (id, content) => ({ id, content, createdAt: Date.now(), label: '', labelIds: [], linkedItems: [], imageUrl: '', attachments: [] });

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

try {
  await setDoc(dayRef, {
    ...(dayBefore || {}),
    entries: [...(dayBefore?.entries || []), entry('jr_u9_a', `${MARK} 준비물\n☐ 가위\n☐ 풀`), entry('jr_u9_b', `${MARK} 다른 기록\n☐ 그대로`)],
    updatedAt: Date.now(),
  });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);

  // ── 새 메모 쓰는 칸에서 체크리스트 ──
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.waitForTimeout(1200);
  await page.getByRole('button', { name: /새 메모/ }).first().click();
  const panel = page.locator('aside[aria-label="메모 쓰기"]');
  await panel.waitFor({ timeout: 10000 });
  const box = panel.locator('textarea').first();
  await box.fill(`${MARK} 장보기\n우유\n빵`);
  // 둘째 줄부터 끝까지 고른다
  await box.evaluate((el) => {
    el.focus();
    el.setSelectionRange(el.value.indexOf('\n') + 1, el.value.length);
  });
  const toggle = panel.locator('[data-checklist-toggle]');
  check("'☑ 체크리스트' 단추가 있고 title에 단축키", (await toggle.count()) === 1 && /\(.+\)/.test((await toggle.getAttribute('title')) || ''), await toggle.getAttribute('title'));
  await toggle.click();
  check('고른 두 줄 앞에 ☐', (await box.inputValue()) === `${MARK} 장보기\n☐ 우유\n☐ 빵`, JSON.stringify(await box.inputValue()));
  await toggle.click();
  check('다시 누르면 뗀다', (await box.inputValue()) === `${MARK} 장보기\n우유\n빵`, JSON.stringify(await box.inputValue()));
  await toggle.click();
  // 끝에서 Enter → 다음 줄도 ☐
  await box.evaluate((el) => {
    el.focus();
    el.setSelectionRange(el.value.length, el.value.length);
  });
  await page.keyboard.press('Enter');
  await page.keyboard.type('달걀');
  check('체크 줄 끝에서 Enter → 다음 줄도 ☐', (await box.inputValue()) === `${MARK} 장보기\n☐ 우유\n☐ 빵\n☐ 달걀`, JSON.stringify(await box.inputValue()));
  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  await page.keyboard.type('끝');
  check("빈 '☐ '에서 Enter → 목록이 끝난다", (await box.inputValue()) === `${MARK} 장보기\n☐ 우유\n☐ 빵\n☐ 달걀\n끝`, JSON.stringify(await box.inputValue()));
  // 단축키로 커서 줄에 붙이기
  const hint = /\((.+)\)/.exec((await toggle.getAttribute('title')) || '')?.[1] || '';
  const combo = hint.replace(/\s/g, '').replace('Ctrl', 'Control');
  await page.keyboard.press(combo);
  check(`단축키(${hint}) → 커서 줄에 ☐`, (await box.inputValue()).endsWith('\n☐ 끝'), JSON.stringify(await box.inputValue()));
  await page.keyboard.press(combo);
  await box.press('Control+s');
  const saved = await serverUntil(memosMine, (ds) => ds.length === 1);
  check('저장 → 서버 글에 ☐ 줄 셋', saved[0]?.data().content === `${MARK} 장보기\n☐ 우유\n☐ 빵\n☐ 달걀\n끝`, JSON.stringify(saved[0]?.data().content));
  await page.waitForTimeout(800);
  await panel.getByTitle('닫기').first().click().catch(() => {});
  await page.waitForTimeout(600);

  const allBtn = page.getByRole('button', { name: /전체 메모/ }).first();
  if (await allBtn.count()) await allBtn.click();
  const card = page.locator('[data-entry-card="memo"]', { hasText: `${MARK} 장보기` }).first();
  await card.waitFor({ timeout: 10000 });
  check("메모 카드에 '☑ 0/3'", (await card.locator('[data-entry-card-checks]').innerText()).includes('0/3'));
  await card.locator('[data-check-line="2"]').click();
  const after = await serverUntil(memosMine, (ds) => String(ds[0]?.data().content).includes('☑ 빵'));
  check('카드의 줄을 누르면 서버 글이 ☑ 빵, 카드 1/3', String(after[0]?.data().content).includes('☑ 빵') && (await card.locator('[data-entry-card-checks]').innerText()).includes('1/3'));

  // ── 기록 카드 ──
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.waitForTimeout(800);
  await pickDate(DAY);
  const jCard = page.locator('[data-entry-card="journal"]', { hasText: `${MARK} 준비물` }).first();
  await jCard.waitFor({ timeout: 10000 });
  check("기록 카드에 '☑ 0/2'", (await jCard.locator('[data-entry-card-checks]').innerText()).includes('0/2'));
  await jCard.locator('[data-check-line="1"]').click();
  const es = await serverUntil(async () => (await read(dayRef))?.entries || [], (l) => l.some((e) => e.id === 'jr_u9_a' && e.content.includes('☑ 가위')));
  const a = es.find((e) => e.id === 'jr_u9_a');
  const b = es.find((e) => e.id === 'jr_u9_b');
  check(
    '기록 줄을 누르면 그 기록만 ☑ 가위, 다른 기록·기록 수 그대로',
    a?.content === `${MARK} 준비물\n☑ 가위\n☐ 풀` && b?.content === `${MARK} 다른 기록\n☐ 그대로` && es.length === (dayBefore?.entries || []).length + 2,
    JSON.stringify(a?.content)
  );
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);
  await pickDate(DAY);
  await jCard.waitFor({ timeout: 10000 });
  check('새로고침 뒤에도 1/2', (await jCard.locator('[data-entry-card-checks]').innerText()).includes('1/2'));
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();
  if (dayBefore) await setDoc(dayRef, dayBefore);
  else await deleteDoc(dayRef);
  for (const d of await memosMine()) await deleteDoc(d.ref);
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
