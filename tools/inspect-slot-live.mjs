// tools/inspect-slot-live.mjs
//
// 2026-10-04 신고 두 가지를 실제 크롬으로 본다 (teacher3 교과 전담, PC 1400px).
//   1. 과목을 고치면 화면뿐 아니라 오른쪽 배너도 따라 바뀐다
//      - 주간 화면 교시 → 'N교시 수정' 배너에 '403과학' 저장 → 배너 칸도 '4-3 과학'(저장된 모양), 주간 칸도
//      - 배너를 연 채 다른 곳(다른 기기)에서 과목을 고치면 배너가 따라간다(고치는 중이 아니면)
//      - 하루 화면 '🙋 출결' 배너를 연 채 그 교시 과목을 고치면 배너 머리줄의 과목도 바뀐다
//   2. 학년반 숫자 '403'도 반으로 읽는다 → 서버에 '4-3 과학'
// 수업 문서(2026-11-02)는 끝에 처음대로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-slot-live.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, setDoc, updateDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const DAY = '2026-11-02'; // 월요일 - seed: 1교시 '5-1 과학', 3교시 '5-2 과학'
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-slot-live');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher3@example.com', 'test1234');
const schedRef = doc(db, 'users', user.uid, 'schedules', DAY);
const original = (await getDocFromServer(schedRef)).data();
if (!original) {
  console.error(`${DAY} 수업 문서가 없다 - npm run seed 먼저`);
  process.exit(1);
}
const subjectOf = async (p) => {
  const v = (await getDocFromServer(schedRef)).data()?.periods?.[String(p)];
  return typeof v === 'string' ? v : v?.subject || '';
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

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

const banner = () => page.getByRole('dialog').filter({ hasText: '1교시 수정' }).first();
const bannerSubject = () => banner().locator('input').first();

try {
  await page.goto(`${V4}?as=3`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.waitForTimeout(800);
  // 그 주의 주간 화면 (명령 창으로 날짜 → 주간)
  await page.keyboard.press('Control+k');
  await page.getByRole('combobox', { name: '명령 창' }).fill(DAY);
  await page.keyboard.press('Enter');
  await page.waitForTimeout(800);
  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(2500);

  // ── 1. 주간 교시 → N교시 수정 배너, '403과학' 저장 ──
  await page.locator(`[title^="1교시 "]`).first().click();
  await banner().waitFor({ timeout: 10000 });
  const before = await bannerSubject().inputValue();
  check('[배너] 주간 교시를 누르면 1교시 수정 배너', /과학/.test(before), before);
  await bannerSubject().fill('403과학');
  await banner().getByRole('button', { name: '저장 완료' }).click();
  const saved = await serverUntil(() => subjectOf(1), (v) => v === '4-3 과학');
  check('[403] 학년반 숫자 403을 반으로 읽어 서버에 4-3 과학', saved === '4-3 과학', saved);
  await page.waitForTimeout(800);
  check('[배너] 저장하면 배너 칸도 저장된 모양 4-3 과학 (예전엔 적은 글자 그대로)', (await bannerSubject().inputValue()) === '4-3 과학', await bannerSubject().inputValue());
  check('[화면] 주간 칸도 4-3', (await page.locator('[title^="1교시 4-3"]').count()) > 0);

  // 배너를 연 채 다른 곳에서 과목을 고친다 → 배너가 따라간다
  await updateDoc(schedRef, { 'periods.1.subject': '5-1 실험' });
  await page.waitForTimeout(1500);
  check('[배너] 연 채로 다른 곳에서 고친 과목을 따라간다', (await bannerSubject().inputValue()) === '5-1 실험', await bannerSubject().inputValue());
  // 고치는 중이면 덮지 않는다
  await bannerSubject().fill('5-1 고치는 중');
  await updateDoc(schedRef, { 'periods.1.subject': '5-1 다른 곳' });
  await page.waitForTimeout(1500);
  check('[배너] 고치는 중(저장 전)에는 적던 것을 덮지 않는다', (await bannerSubject().inputValue()) === '5-1 고치는 중', await bannerSubject().inputValue());
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── 하루 화면 🙋 출결 배너의 과목 ──
  await setDoc(schedRef, original);
  await page.keyboard.press('Shift+Digit1');
  await page.locator(`[data-focus-key="period:${DAY}:1"]`).first().waitFor({ timeout: 15000 });
  await page.locator(`[data-focus-key="period:${DAY}:1"] [data-subject-attendance]`).click();
  const title = page.locator('[data-subject-attendance-title]').first();
  await title.waitFor({ timeout: 10000 });
  const t1 = await title.innerText();
  await updateDoc(schedRef, { 'periods.1.subject': '5-1 실험' });
  await page.waitForTimeout(1500);
  const t2 = await title.innerText();
  check('[출결 배너] 연 채로 과목을 고치면 머리줄 과목도 바뀐다', /과학/.test(t1) && /실험/.test(t2), `${t1} → ${t2}`);
  await page.keyboard.press('Escape');
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await setDoc(schedRef, original);
}

check('점검 동안 페이지 오류가 없다', errors.length === 0, errors.slice(0, 3).join(' | '));
await browser.close();
const fails = results.filter((r) => !r).length;
console.log(`\n결과: ${results.length - fails}/${results.length} 통과`);
process.exit(fails ? 1 : 0);
