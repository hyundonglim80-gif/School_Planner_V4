// tools/inspect-neis.mjs
//
// 나이스 급식·학사일정 (docs/ROADMAP.md 4-2~4-5)을 실제 크롬으로 본다. 나이스 응답은 page.route로 흉내 낸다
// (실제 서버를 두드리지 않는다). 키 없이 부르면 5건만 주는 것까지 흉내 내서 나눠 받기도 함께 본다.
// - 학교를 고르기 전에는 급식이 없다
// - 환경설정 '우리 학교'에서 이름으로 찾아 고르면 계정에 저장되고, 하루 화면 수업 칸 아래에 그날 급식(알레르기 번호)
// - 한 달 급식을 키 없이 빠짐없이 받는다 (여러 번 나눠 부른다)
// - 알림장 '🍚 급식'이 다음 수업일 급식 한 줄을 더한다
// - 학사일정이 하루(수업 칸 아래)·주간·월간·년간 날짜 옆에 보이고, 공휴일·토요휴업일은 빠진다
// - 학사일정 학년을 고르면 다른 학년 행사가 빠진다
// - 학사일정 이름을 누르면 창이 열리고(하루 화면으로 넘어가지 않는다) 'D-Day로'는 곧바로 D-Day 목록에,
//   '일정으로 담기'는 이름을 적어 둔 새 일정 칸을 연다 (저장하지 않으면 일정이 생기지 않는다) - 4-5
// - 시간표 설정 '학사일정으로 채우기'가 방학식 다음 날 ~ 개학식 전날로 방학 칸을 채운다 (저장은 따로) - 4-5
// - '지우기'를 누르면 급식·학사일정이 사라진다
// 끝나면 우리 학교를 지우고 D-Day 목록을 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-neis.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, setDoc, updateDoc } from 'firebase/firestore';
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
const prefRef = doc(db, 'users', user.uid, 'settings', 'preferences');
const prefs = async () => (await getDocFromServer(prefRef)).data() || {};
const ttRef = doc(db, 'users', user.uid, 'settings', 'timetable_v5');
const semesterSaved = async () => JSON.stringify((await getDocFromServer(ttRef)).data()?.semesterConfig || null);
/** 계정 저장이 서버에 닿을 때까지 몇 초 기다린다 (에뮬레이터가 바쁘면 1초를 넘긴다) */
async function savedWhen(ok, ms = 6000) {
  const end = Date.now() + ms;
  let d = await saved();
  while (!ok(d) && Date.now() < end) {
    await new Promise((r) => setTimeout(r, 300));
    d = await saved();
  }
  return d;
}

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
// 학사일정: 오늘 '2학기 중간고사'(전 학년), 내일 '6학년 현장체험'(6학년만), 모레 공휴일, 다음 토요일 토요휴업일
const addDays = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const TODAY = new Date();
const ALL = { ONE_GRADE_EVENT_YN: 'Y', TW_GRADE_EVENT_YN: 'Y', THREE_GRADE_EVENT_YN: 'Y', FR_GRADE_EVENT_YN: 'Y', FIV_GRADE_EVENT_YN: 'Y', SIX_GRADE_EVENT_YN: 'Y' };
const ONLY6 = { ...ALL, ONE_GRADE_EVENT_YN: 'N', TW_GRADE_EVENT_YN: 'N', THREE_GRADE_EVENT_YN: 'N', FR_GRADE_EVENT_YN: 'N', FIV_GRADE_EVENT_YN: 'N' };
const SAT = addDays(TODAY, (6 - TODAY.getDay() + 7) % 7 || 7);
// 방학 (4-5): 올해 학년도(3월~이듬해 2월) 여름방학식 7/24·개학식 8/17, 겨울방학식 12/31·개학식 이듬해 2/3
const SY = TODAY.getMonth() + 1 >= 3 ? TODAY.getFullYear() : TODAY.getFullYear() - 1;
const SCHEDULE = [
  { AA_YMD: `${SY}0724`, EVENT_NM: '여름방학식', EVENT_CNTNT: '', SBTR_DD_SC_NM: '해당없음', ...ALL },
  { AA_YMD: `${SY}0727`, EVENT_NM: '여름방학', EVENT_CNTNT: '', SBTR_DD_SC_NM: '휴업일', ...ALL },
  { AA_YMD: `${SY}0817`, EVENT_NM: '2학기 개학식', EVENT_CNTNT: '', SBTR_DD_SC_NM: '해당없음', ...ALL },
  { AA_YMD: `${SY}1231`, EVENT_NM: '겨울방학식', EVENT_CNTNT: '', SBTR_DD_SC_NM: '해당없음', ...ALL },
  { AA_YMD: `${SY + 1}0203`, EVENT_NM: '개학식', EVENT_CNTNT: '', SBTR_DD_SC_NM: '해당없음', ...ALL },
  { AA_YMD: ymd(TODAY), EVENT_NM: '2학기 중간고사', EVENT_CNTNT: '1~3교시', SBTR_DD_SC_NM: '해당없음', ...ALL },
  { AA_YMD: ymd(addDays(TODAY, 1)), EVENT_NM: '6학년 현장체험', EVENT_CNTNT: '', SBTR_DD_SC_NM: '해당없음', ...ONLY6 },
  { AA_YMD: ymd(addDays(TODAY, 2)), EVENT_NM: '점검공휴일', EVENT_CNTNT: '', SBTR_DD_SC_NM: '공휴일', ...ALL },
  { AA_YMD: ymd(SAT), EVENT_NM: '토요휴업일', EVENT_CNTNT: '', SBTR_DD_SC_NM: '휴업일', ...ALL },
];
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
  if (service === 'SchoolSchedule') rows = SCHEDULE.filter((r) => r.AA_YMD >= p.get('AA_FROM_YMD') && r.AA_YMD <= p.get('AA_TO_YMD'));
  const total = rows.length;
  const body = total
    ? { [service]: [{ head: [{ list_total_count: total }, { RESULT: { CODE: 'INFO-000' } }] }, { row: p.get('KEY') ? rows : rows.slice(0, 5) }] }
    : { RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } };
  await route.fulfill({ status: 200, contentType: 'application/json', headers: { 'Access-Control-Allow-Origin': '*' }, body: JSON.stringify(body) });
}

await setDoc(ref, { updatedAt: Date.now() }); // 학교를 고르지 않은 상태로
const prefsBefore = await prefs(); // 'D-Day로'가 더한 것을 끝나고 되돌린다
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
  const s = await savedWhen((d) => !!d.schoolCode);
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

  // ── 학사일정 ───────────────────────────────────────────────
  const dayEvents = page.locator('[data-day-school-events]');
  await dayEvents.waitFor({ timeout: 10000 }).catch(() => {});
  check('하루 화면 수업 칸 아래 📚 학사 줄', (await dayEvents.count()) === 1 && /2학기 중간고사/.test(await dayEvents.innerText()));
  check('마우스를 올리면 내용까지', /1~3교시/.test((await dayEvents.locator('button').getAttribute('title')) || ''));
  const named = (text) => page.locator('[data-school-event]', { hasText: text });
  await page.keyboard.press('Shift+Digit2');
  await page.waitForTimeout(2500);
  check('주간: 날짜 옆에 학사일정 (전 학년 · 6학년)', (await named('2학기 중간고사').count()) >= 1 && (await named('6학년 현장체험').count()) >= 1);
  // 학사일정 줄이 있어도 요일끼리 수업 줄이 나란해야 한다 (inspect-manual의 같은 점검)
  const tops = await page.evaluate(() =>
    [...document.querySelectorAll('div')].filter((c) => c.className.includes('min-h-[250px]')).map((c) => {
      const h = [...c.querySelectorAll('div')].find((d) => d.className.includes('font-extrabold') && d.textContent.trim().startsWith('수업'));
      return h ? Math.round(h.getBoundingClientRect().top - c.getBoundingClientRect().top) : -1;
    })
  );
  check('주간: 학사일정이 있는 날도 수업 줄이 다른 요일과 나란하다', tops.length > 0 && new Set(tops).size === 1, tops.join(','));
  check('공휴일·토요휴업일은 학사일정으로 나오지 않는다', (await named('점검공휴일').count()) === 0 && (await named('토요휴업일').count()) === 0);
  await page.screenshot({ path: 'tools/report/neis-week.png' });

  // 학년 고르기 - 5학년이면 6학년 행사는 빠진다
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  await box.waitFor({ timeout: 10000 });
  await box.getByRole('button', { name: '5학년' }).click();
  await page.waitForTimeout(1200);
  const g = (await savedWhen((d) => d.grade === 5)).grade;
  check('학사일정 학년이 계정에 저장된다', g === 5, JSON.stringify(g));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(1500);
  check('5학년을 고르면 6학년 행사는 빠지고 전 학년 행사는 남는다', (await named('6학년 현장체험').count()) === 0 && (await named('2학기 중간고사').count()) >= 1);

  await page.keyboard.press('Shift+Digit3');
  await page.waitForTimeout(2500);
  check('월간: 날짜 칸에 학사일정', (await named('2학기 중간고사').count()) >= 1);
  await page.screenshot({ path: 'tools/report/neis-month.png' });

  // ── 4-5 학사일정 창: D-Day로 · 일정으로 담기 ─────────────────
  const todayStr = `${TODAY.getFullYear()}-${p2(TODAY.getMonth() + 1)}-${p2(TODAY.getDate())}`;
  const peek = page.locator('[data-school-event-modal]');
  await named('2학기 중간고사').first().click();
  await peek.waitFor({ timeout: 10000 }).catch(() => {});
  check('월간: 학사일정 이름을 누르면 학사일정 창 (내용까지)', (await peek.count()) === 1 && /2학기 중간고사/.test(await peek.innerText()) && /1~3교시/.test(await peek.innerText()));
  check('누른 날로 하루 화면으로 넘어가지 않는다', (await page.locator('[data-day-school-events]').count()) === 0 && (await named('2학기 중간고사').count()) >= 1);
  await page.screenshot({ path: 'tools/report/neis-peek.png' });
  const ddayBtn = peek.locator('[data-school-event-dday]').first();
  check("'D-Day로' 단추에 오늘 기준 D-Day", /D-Day로 \(D-Day\)/.test(await ddayBtn.innerText()), await ddayBtn.innerText());
  await ddayBtn.click();
  const end = Date.now() + 6000;
  let list = [];
  while (Date.now() < end) {
    list = (await prefs()).dDayList || [];
    if (list.some((d) => d.title === '2학기 중간고사' && d.date === todayStr)) break;
    await new Promise((r) => setTimeout(r, 300));
  }
  check("'D-Day로'는 곧바로 D-Day 목록(계정)에 더한다", list.some((d) => d.title === '2학기 중간고사' && d.date === todayStr), `${list.length}개`);
  await page.waitForTimeout(800);
  check("이미 있으면 'D-Day에 있음'으로 막힌다 (두 번 더하지 않는다)", /D-Day에 있음/.test(await ddayBtn.innerText()) && (await ddayBtn.isDisabled()));
  await peek.locator('[data-school-event-to-event]').first().click();
  const evPanel = page.getByRole('complementary', { name: '일정 쓰기' });
  await evPanel.waitFor({ timeout: 10000 }).catch(() => {});
  const evBox = evPanel.getByPlaceholder('새로운 일정을 입력하세요...');
  check("'일정으로 담기'는 이름을 적어 둔 새 일정 칸을 그날로 연다 (창은 닫힌다)",
    (await evPanel.count()) === 1 && (await evBox.inputValue()) === '2학기 중간고사' && (await evPanel.getByLabel('일정 날짜').inputValue()) === todayStr && (await peek.count()) === 0);
  await page.screenshot({ path: 'tools/report/neis-to-event.png' });
  await page.keyboard.press('Escape'); // 저장하지 않고 닫는다
  await page.waitForTimeout(800);
  const evDoc = (await getDocFromServer(doc(db, 'users', user.uid, 'events', todayStr))).data() || {};
  check('저장하지 않으면 일정이 생기지 않는다', !(evDoc.eventList || []).some((e) => e.content === '2학기 중간고사') && (await evPanel.count()) === 0);
  await page.keyboard.press('Shift+Digit4');
  await page.waitForTimeout(3000);
  check('년간: 날짜 옆에 학사일정', (await named('2학기 중간고사').count()) >= 1);
  const schedCalls = neisCalls.filter((u) => u.pathname.endsWith('SchoolSchedule'));
  check('학사일정도 키 없이', schedCalls.length > 0 && schedCalls.every((u) => !u.searchParams.has('KEY')), `${schedCalls.length}번`);
  await page.keyboard.press('Shift+Digit1');
  await page.waitForTimeout(1500);

  // ── 4-5 하루 화면 📚 학사 줄도 누르면 창 ─────────────────────
  await page.locator('[data-day-school-events] button').click();
  await peek.waitFor({ timeout: 10000 }).catch(() => {});
  check('하루 화면 📚 학사 줄을 눌러도 학사일정 창', (await peek.count()) === 1);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(600);

  // ── 4-5 방학 기간을 학사일정으로 채우기 ──────────────────────
  const semBefore = await semesterSaved();
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /시간표 적용/ }).click();
  await page.getByRole('button', { name: /템플릿 클라우드 저장|불러오는 중/ }).waitFor({ timeout: 20000 });
  await page.waitForTimeout(1500);
  const fill = page.locator('[data-fill-vacations]');
  await fill.scrollIntoViewIfNeeded();
  await fill.click();
  const note = page.locator('[data-vacation-note]');
  await note.waitFor({ timeout: 20000 }).catch(() => {});
  const noteText = (await note.count()) ? await note.innerText() : '';
  check("'학사일정으로 채우기': 방학식 다음 날 ~ 개학식 전날", /여름 7\/25~8\/16 · 겨울 1\/1~2\/2/.test(noteText), noteText);
  const dates = await page.locator('input[type=date]').evaluateAll((els) => els.map((e) => e.value));
  check('방학 칸 네 개가 채워진다', [`${SY}-07-25`, `${SY}-08-16`, `${SY + 1}-01-01`, `${SY + 1}-02-02`].every((d) => dates.includes(d)), dates.slice(0, 4).join(','));
  await page.screenshot({ path: 'tools/report/neis-vacation.png' });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  check("채우기만으로는 저장되지 않는다 ('방학 기간 저장'을 따로)", (await semesterSaved()) === semBefore);

  // ── 지우기 ─────────────────────────────────────────────────
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  await box.waitFor({ timeout: 10000 });
  await box.getByRole('button', { name: '지우기' }).click();
  await page.waitForTimeout(1200);
  check("'지우기'로 학교를 지우면 계정에서도 빠진다", !(await savedWhen((d) => !d.schoolCode)).schoolCode);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(800);
  check('지우면 급식·학사일정이 사라진다', (await meals.count()) === 0 && (await page.locator('[data-day-school-events]').count()) === 0);
} finally {
  await browser.close();
  await setDoc(ref, { updatedAt: Date.now() });
  await updateDoc(prefRef, { dDayList: prefsBefore.dDayList || [], selectedDDayId: prefsBefore.selectedDDayId ?? null }).catch(() => {});
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
