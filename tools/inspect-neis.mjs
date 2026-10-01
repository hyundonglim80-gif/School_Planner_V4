// tools/inspect-neis.mjs
//
// 나이스 급식 (docs/ROADMAP.md 4-2·4-3)을 실제 크롬으로 본다. 나이스 응답은 page.route로 흉내 낸다
// (실제 서버를 두드리지 않는다). 키 없이 부르면 5건만 주는 것까지 흉내 내서 나눠 받기도 함께 본다.
// - 학교를 고르기 전에는 급식이 없다
// - 환경설정 '우리 학교'에서 이름으로 찾아 고르면 계정에 저장되고, 하루 화면 수업 칸 아래에 그날 급식(알레르기 번호)
// - 한 달 급식을 키 없이 빠짐없이 받는다 (여러 번 나눠 부른다)
// - 알림장 '🍚 급식'이 다음 수업일 급식 한 줄을 더한다
// - '지우기'를 누르면 급식이 사라진다
// 끝나면 우리 학교를 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-neis.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'neis');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const ref = doc(db, 'users', user.uid, 'settings', 'v4_school');
const saved = async () => (await getDocFromServer(ref)).data() || {};

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const p2 = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}${p2(d.getMonth() + 1)}${p2(d.getDate())}`;
const fromYmd = (s) => new Date(Number(s.slice(0, 4)), Number(s.slice(4, 6)) - 1, Number(s.slice(6, 8)));

// ── 가짜 나이스 ─────────────────────────────────────────────────────
const neisCalls = [];
const DISHES = '현미밥 <br/>꽃게된장국 (5.6.8)<br/>삼겹살편육 (5.6.10)<br/>급식우유 (2)';
function mealRows(from, to) {
  const rows = [];
  for (let d = fromYmd(from); ymd(d) <= to; d.setDate(d.getDate() + 1)) {
    if (d.getDay() === 0 || d.getDay() === 6) continue;
    rows.push({ MLSV_YMD: ymd(d), MMEAL_SC_NM: '중식', MMEAL_SC_CODE: '2', DDISH_NM: DISHES, CAL_INFO: '758.6 Kcal' });
  }
  return rows;
}
const SCHOOL = {
  ATPT_OFCDC_SC_CODE: 'B10',
  ATPT_OFCDC_SC_NM: '서울특별시교육청',
  SD_SCHUL_CODE: '7091375',
  SCHUL_NM: '서울대도초등학교',
  SCHUL_KND_SC_NM: '초등학교',
  ORG_RDNMA: '서울특별시 강남구 선릉로 209',
};
async function fakeNeis(route) {
  const url = new URL(route.request().url());
  neisCalls.push(url);
  const service = url.pathname.split('/').pop();
  const p = url.searchParams;
  let rows = [];
  if (service === 'schoolInfo') rows = SCHOOL.SCHUL_NM.includes(p.get('SCHUL_NM') || '') ? [SCHOOL] : [];
  if (service === 'mealServiceDietInfo') rows = mealRows(p.get('MLSV_FROM_YMD'), p.get('MLSV_TO_YMD'));
  const total = rows.length;
  const body = total
    ? { [service]: [{ head: [{ list_total_count: total }, { RESULT: { CODE: 'INFO-000' } }] }, { row: p.get('KEY') ? rows : rows.slice(0, 5) }] }
    : { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } };
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
}

await setDoc(ref, { updatedAt: Date.now() }); // 학교를 고르지 않은 상태로
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.route('https://open.neis.go.kr/**', fakeNeis);
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const meals = page.locator('[data-day-meals]');

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '수업' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1500);
  check('학교를 고르기 전에는 급식이 없고 나이스를 부르지 않는다', (await meals.count()) === 0 && neisCalls.length === 0);

  // ── 환경설정 '우리 학교' ─────────────────────────────────────
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  const box = page.locator('[data-school-setting]');
  await box.waitFor({ timeout: 10000 });
  await box.scrollIntoViewIfNeeded();
  await box.getByLabel('학교 이름').fill('대도초');
  await box.getByLabel('학교 이름').press('Enter');
  const result = box.locator('[data-school-results] button', { hasText: '서울대도초등학교' });
  await result.waitFor({ timeout: 10000 });
  check('이름으로 찾으면 학교가 나온다 (Enter)', (await result.count()) === 1, (await result.innerText()).replace(/\s+/g, ' '));
  await result.click();
  await page.waitForTimeout(1200);
  const s = await saved();
  check('고르면 계정에 저장된다 (교육청·학교 코드)', s.officeCode === 'B10' && s.schoolCode === '7091375' && s.name === '서울대도초등학교', JSON.stringify({ o: s.officeCode, c: s.schoolCode }));
  check('고른 학교 이름이 보이고 찾기 칸은 닫힌다', (await box.locator('[data-school-name]').innerText()).includes('서울대도초등학교') && (await box.getByLabel('학교 이름').count()) === 0);
  await page.screenshot({ path: 'tools/report/neis-settings.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // ── 하루 화면 급식 ─────────────────────────────────────────
  const today = new Date();
  const weekday = today.getDay() !== 0 && today.getDay() !== 6;
  if (weekday) {
    await meals.waitFor({ timeout: 10000 });
    const text = await meals.innerText();
    check('수업 칸 아래에 그날 급식', /중식/.test(text) && /현미밥/.test(text) && /꽃게된장국/.test(text), text.replace(/\s+/g, ' ').slice(0, 60));
    check('알레르기 번호는 작게 (sup)', (await meals.locator('sup', { hasText: '5.6.8' }).count()) === 1);
  } else {
    check('주말이면 급식 칸이 없다', (await meals.count()) === 0);
  }
  const mealCalls = neisCalls.filter((u) => u.pathname.endsWith('mealServiceDietInfo'));
  check('키 없이 한 달을 나눠 받는다', mealCalls.length > 1 && mealCalls.every((u) => !u.searchParams.has('KEY')), `${mealCalls.length}번`);
  await page.screenshot({ path: 'tools/report/neis-day.png' });

  // ── 알림장 '🍚 급식' ────────────────────────────────────────
  await page.getByRole('button', { name: '📢 알림장' }).first().click();
  const mealBtn = page.getByRole('button', { name: '🍚 급식' });
  await mealBtn.waitFor({ timeout: 10000 });
  const area = page.getByLabel('알림장 내용');
  await area.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  const before = await area.inputValue();
  await mealBtn.click();
  await page.waitForTimeout(1500);
  const after = await area.inputValue();
  const added = after.slice(before.length).trim();
  check("알림장 '🍚 급식'이 다음 수업일 급식 한 줄을 더한다", /^\d+\/\d+\(.\) 급식: 현미밥, 꽃게된장국, 삼겹살편육, 급식우유$/.test(added), added);
  await mealBtn.click();
  await page.waitForTimeout(1000);
  check('두 번 눌러도 같은 줄은 더하지 않는다', (await area.inputValue()) === after);
  await page.screenshot({ path: 'tools/report/neis-notice.png' });
  await area.fill(before); // 적던 것을 되돌린다 (저장하지 않는다)
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);

  // ── 지우기 ─────────────────────────────────────────────────
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  await box.waitFor({ timeout: 10000 });
  await box.getByRole('button', { name: '지우기' }).click();
  await page.waitForTimeout(1200);
  check("'지우기'로 학교를 지우면 계정에서도 빠진다", !(await saved()).schoolCode);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  check('지우면 급식이 사라진다', (await meals.count()) === 0);
} finally {
  await browser.close();
  await setDoc(ref, { updatedAt: Date.now() });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
