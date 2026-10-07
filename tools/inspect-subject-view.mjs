// tools/inspect-subject-view.mjs
//
// 18번 교과 전담 S3 '반 중심 수업 칸 + 담임 도구 숨기기' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3(교과 전담) 하루 2026-11-02(월): 1교시 큰 글자 '5-1'·작은 '과학', 1·3교시 막대 색이 다르다,
//     알림장·출석부 단추 없음, ⋮에 출석부·알림장 모아 보기·주간학습안내 없음, 학급 탭에 출석부·알림장·오늘 출결 없음,
//     주간에 '5-2' 칩, 환경설정에서 5-1 색을 고르면 하루 카드 막대가 그 색
//   - 교과 + 담임(담임반 5-3)으로 바꾸면 단추·메뉴가 돌아오고 출석부가 5-3으로 열린다
//   - 점검이 바꾼 교사 유형 문서는 끝에 되돌린다
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-subject-view.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;
const DAY = '2026-11-02'; // 월요일 - seed: 1교시 '5-1 과학', 3교시 '5-2 과학'

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-subject-view');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const modeRef = doc(db, 'users', user.uid, 'settings', 'v4_teaching');
const readMode = async () => {
  const s = await getDocFromServer(modeRef);
  return s.exists() ? s.data() : null;
};
const modeBefore = await readMode();

async function serverUntil(read, ok, timeout = 8000) {
  const t0 = Date.now();
  let v = await read();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 250));
    v = await read();
  }
  return [v, Date.now() - t0];
}

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const logs = [];
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));

const card = (p) => page.locator(`[data-focus-key="period:${DAY}:${p}"]`).first();
async function goDay() {
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await page.waitForTimeout(300);
  }
  await direct.fill(DAY);
  await page.mouse.move(5, 600);
  await card(1).waitFor({ timeout: 15000 });
}
async function menuLabels() {
  await page.getByTitle('더보기 메뉴').click();
  await page.locator('[data-menu-section]').first().waitFor({ timeout: 5000 });
  const labels = await page.locator('[data-menu-section] button').allInnerTexts();
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  return labels.join('|');
}
const has = (labels, name) => labels.split('|').some((l) => l.includes(name));

try {
  await page.goto(`${V4}?as=3`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().waitFor({ timeout: 40000 });
  await goDay();
  // 명렬표가 와서 반 차례 색이 잡히기를 기다린다
  await page.locator('[data-slot-class]').first().waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);

  // ── 교과 전담: 하루 수업 칸 ──────────────────────────────────
  const big = await card(1).locator('[data-slot-class]').innerText();
  const small = await card(1).locator('[data-slot-subject]').innerText();
  check("하루 1교시: 큰 글자 '5-1', 작은 글자 '과학'", big === '5-1' && small === '과학', `${big} / ${small}`);
  const c1 = await card(1).getAttribute('data-slot-color');
  const c3 = await card(3).getAttribute('data-slot-color');
  check('1교시(5-1)와 3교시(5-2) 막대 색이 다르다', !!c1 && !!c3 && c1 !== c3, `${c1} / ${c3}`);
  const bar = await card(1).evaluate((el) => getComputedStyle(el).borderLeftColor);
  check('막대가 실제로 칠해진다 (Tailwind 클래스가 만들어졌다)', bar && bar !== 'rgba(0, 0, 0, 0)' && !/226, 232, 240/.test(bar), bar);
  check('수업 머리줄에 알림장·출석부 단추가 없다',
    (await page.getByRole('button', { name: '📢 알림장' }).count()) === 0 && (await page.getByRole('button', { name: '📋 출석부' }).count()) === 0);

  // ── ⋮ 메뉴 ──────────────────────────────────────────────────
  const m1 = await menuLabels();
  check('⋮에 출석부·알림장 모아 보기·주간학습안내가 없다', !has(m1, '출석부') && !has(m1, '알림장 모아 보기') && !has(m1, '주간학습안내'));
  // 명렬표는 2026-10-07 학급 화면 안으로 옮겼다
  check('⋮의 다른 학급 도구는 그대로 (자리표), 명렬표는 ⋮에 없다', has(m1, '자리표') && !has(m1, '명렬표'));

  // ── 학급 탭 ─────────────────────────────────────────────────
  await page.getByRole('button', { name: '학급', exact: true }).first().click();
  await page.locator('[data-class-screen]').waitFor({ timeout: 10000 });
  await page.locator('[data-class-tool="seating"]').waitFor({ timeout: 10000 });
  check('학급 탭에 출석부·알림장·오늘 출결이 없다',
    (await page.locator('[data-class-tool="attendance"], [data-class-tool="notices"], [data-class-today]').count()) === 0);

  // ── 주간 ────────────────────────────────────────────────────
  await page.getByRole('button', { name: '주간', exact: true }).first().click();
  const chip = page.locator(`[data-date="${DAY}"] [data-slot-class]`, { hasText: '5-2' }).first();
  await chip.waitFor({ timeout: 10000 }).catch(() => {});
  const chipClass = (await chip.count()) ? await chip.getAttribute('class') : '';
  check("주간 11-02에 '5-2' 반 색 칩", /bg-\w+-100/.test(chipClass || ''), chipClass || '없음');

  // ── 환경설정 반 색 ──────────────────────────────────────────
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  const row = page.locator('[data-class-color-row="5-1"]');
  await row.waitFor({ timeout: 10000 });
  const pick = c1 === 'rose' ? 'violet' : 'rose';
  await row.locator(`[data-class-color="${pick}"]`).click();
  const [m, ms] = await serverUntil(readMode, (v) => v?.classColors?.['5-1'] === pick);
  check(`환경설정 5-1 색 '${pick}' → 서버 classColors`, m?.classColors?.['5-1'] === pick, `${ms}ms`);
  check('다른 설정 칸은 그대로 (unit·과목)', m?.unit === 'class' && m?.hasHomeroom === false && (m?.subjects || []).includes('과학'));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);
  await goDay();
  await page.waitForFunction(([d, p]) => document.querySelector(`[data-focus-key="period:${d}:1"]`)?.getAttribute('data-slot-color') === p, [DAY, pick], { timeout: 8000 }).catch(() => {});
  check(`하루 1교시 막대가 고른 색 '${pick}'`, (await card(1).getAttribute('data-slot-color')) === pick);

  // ── 교과 + 담임 (담임반 5-3) ────────────────────────────────
  await setDoc(modeRef, { hasHomeroom: true, homeroomClass: '5-3', updatedAt: Date.now() }, { merge: true });
  await page.getByRole('button', { name: '📋 출석부' }).waitFor({ timeout: 10000 }).catch(() => {});
  check('교과 + 담임: 알림장·출석부 단추가 돌아온다',
    (await page.getByRole('button', { name: '📢 알림장' }).count()) === 1 && (await page.getByRole('button', { name: '📋 출석부' }).count()) === 1);
  const m2 = await menuLabels();
  check('교과 + 담임: ⋮에 출석부·알림장 모아 보기·주간학습안내', has(m2, '출석부') && has(m2, '알림장 모아 보기') && has(m2, '주간학습안내'));
  await page.getByRole('button', { name: '📋 출석부' }).click();
  const sel = page.getByRole('combobox', { name: '학급' }).last();
  await sel.waitFor({ timeout: 10000 });
  await page.waitForTimeout(500);
  const key = await sel.inputValue();
  check('교과 + 담임: 출석부가 담임반 5-3으로 열린다', key === '2026_5_3', key);
  await page.keyboard.press('Escape');
} catch (e) {
  check('점검 도중 오류', false, String(e?.message || e).slice(0, 300));
} finally {
  if (modeBefore) await setDoc(modeRef, modeBefore);
  else await deleteDoc(modeRef);
  await browser.close();
}

if (logs.length) console.log(logs.join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
