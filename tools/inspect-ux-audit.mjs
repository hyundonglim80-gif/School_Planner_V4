// tools/inspect-ux-audit.mjs
//
// docs/UX-AUDIT.md 제안을 적용한 것 (2026-10-07) - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px, teacher).
//   - 머리줄 '?' = 설명서, ⋮ 메뉴 구역 차례(라벨 관리가 맨 위), 앱 설치·밝기는 환경설정에
//   - 하루 화면: 기록 '+ 메모'(날짜 없는 메모 칸), 수업 '📘 진도', 일정 카드 ☐ → 완료(서버), 교시 카드 ✏️
//   - 쓰는 칸 '+ 새 라벨' → 이름 Enter → 칩이 골라지고 저장하면 라벨 목록에 생긴다
//   - 라벨로 보기 '?' 안내, 구글 캘린더로 보내기 창 위 '저절로' 안내
// 점검이 바꾼 일정·기록·메모·라벨은 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-ux-audit.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검UX';
const DAY = '2026-10-29';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-ux');
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
async function until(fn, ok, timeout = 10000) {
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
const evRef = uref('events', DAY);
const jRef = uref('journals', DAY);
const labelsRef = uref('settings', 'labels');
const before = { ev: await read(evRef), j: await read(jRef), labels: await read(labelsRef) };
const memosMine = async () => (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs.filter((d) => String(d.data().content || '').includes(MARK));

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.setDefaultTimeout(15000);
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
  await setDoc(evRef, { ...(before.ev || {}), eventList: [...(before.ev?.eventList || []), { id: 'ev_ux_1', content: `${MARK} 일정`, completed: false, label: '달력', labelIds: ['ev_1'], attachments: [], linkedItems: [] }], updatedAt: Date.now() });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1000);

  // 머리줄 ? → 설명서
  await page.locator('[data-header-help]').click();
  await page.locator('[data-help-category]').first().waitFor({ timeout: 10000 }).catch(() => {});
  check("머리줄 '?' → 사용 설명서", (await page.locator('[data-help-category]').count()) >= 10);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // ⋮ 메뉴 차례
  await page.getByTitle('더보기 메뉴').click();
  const firstItem = (await page.locator('[data-menu-section]').first().getByRole('button').first().innerText()).replace(/\s+/g, ' ');
  const menuText = await page.locator('[data-menu-section]').allInnerTexts();
  check("⋮ 첫 구역 맨 위가 '라벨 관리', 앱 설치·어둡게 보기는 메뉴에 없다", /라벨 관리/.test(firstItem) && !/앱으로 설치|어둡게 보기/.test(menuText.join(' ')), firstItem);
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  await page.locator('[data-install-pwa]').waitFor({ timeout: 10000 }).catch(() => {});
  check("환경설정에 '📱 앱으로 설치'와 화면 밝기", (await page.locator('[data-install-pwa]').count()) === 1 && (await page.locator('[data-theme-options]').count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  await pickDate(DAY);
  // 일정 카드 ☐
  const box = page.locator('[data-event-complete]').first();
  await page.getByText(`${MARK} 일정`).first().waitFor();
  const card = page.locator('div', { hasText: `${MARK} 일정` }).filter({ has: page.locator('[data-event-complete]') }).last();
  await card.locator('[data-event-complete]').click();
  const done = await until(async () => (await read(evRef))?.eventList?.find((e) => e.id === 'ev_ux_1'), (e) => e?.completed === true);
  check('일정 카드 ☐ → 서버 완료', done?.completed === true && (await box.count()) > 0);
  // 수업 📘 진도
  await page.locator('[data-day-progress]').click();
  check("수업 칸 '📘 진도' → 진도 관리 창", await page.locator('[role=dialog]', { hasText: '진도' }).first().waitFor({ timeout: 8000 }).then(() => true, () => false));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('교시 카드에 ✏️ (마우스를 올리면)', (await page.locator('[data-period-edit-hint]').count()) > 0);
  // 기록 + 메모
  await page.locator('[data-day-add-memo]').click();
  const memoPanel = page.locator('aside[aria-label="메모 쓰기"]').first();
  check("기록 칸 '+ 메모' → 날짜 없는 메모 칸", await memoPanel.waitFor({ timeout: 8000 }).then(() => true, () => false));
  // + 새 라벨
  await memoPanel.locator('textarea').first().fill(`${MARK} 새 라벨 메모`);
  await memoPanel.locator('[data-entry-new-label]').click();
  await memoPanel.locator('[data-entry-new-label-input]').fill('새라벨UX');
  await memoPanel.locator('[data-entry-new-label-input]').press('Enter');
  check("'+ 새 라벨' → 이름 Enter → 칩이 골라진다", (await memoPanel.locator('[data-entry-label-chip="새라벨UX"]').getAttribute('aria-pressed')) === 'true');
  await memoPanel.locator('textarea').first().press('Control+s');
  const m = (await until(memosMine, (ds) => ds.length === 1))[0]?.data();
  const lb = await until(() => read(labelsRef), (d) => (d?.journalLabels || []).some((l) => l.name === '새라벨UX'));
  check('저장 → 메모에 라벨, 라벨 목록(두 배열)에 생긴다', (m?.labels || []).includes('새라벨UX') && (lb?.memoLabels || []).some((l) => (typeof l === 'string' ? l : l.name) === '새라벨UX'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  // 라벨로 보기 ? 안내 (메모 화면 - 기록 칸은 기록이 있는 날에만 줄이 보인다)
  await page.getByRole('button', { name: '메모', exact: true }).first().click();
  await page.locator('[data-filter-help]').first().waitFor({ timeout: 8000 }).catch(() => {});
  check("라벨로 보기에 '?' 안내", (await page.locator('[data-filter-help]').count()) >= 1 && /Ctrl/.test((await page.locator('[data-filter-help]').first().getAttribute('title')) || ''));
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  // 구글 캘린더 창 안내
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /구글 캘린더로 보내기/ }).first().click();
  check("구글 캘린더로 보내기 창 위에 '저절로' 안내", await page.locator('[data-gcal-auto-hint]').waitFor({ timeout: 8000 }).then(() => true, () => false));
  await page.keyboard.press('Escape');
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();
  if (before.ev) await setDoc(evRef, before.ev);
  else await deleteDoc(evRef);
  if (before.j) await setDoc(jRef, before.j);
  else await deleteDoc(jRef);
  if (before.labels) await setDoc(labelsRef, before.labels);
  for (const d of await memosMine()) await deleteDoc(d.ref);
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
