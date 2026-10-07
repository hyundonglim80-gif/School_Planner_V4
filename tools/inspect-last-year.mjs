// tools/inspect-last-year.mjs
//
// 작년 이맘때(docs/ROADMAP.md 7)를 실제 크롬으로 본다.
//   7-1 보기
//   - 주간 화면 '🕰️ 작년 이맘때'를 켜면 요일 카드 아래에 작년 학년도 같은 주 같은 요일의 일정·기록이 흐리게 붙는다
//   - 같은 주는 학년도 몇째 주: 2029학년도 1주(2.26 주, 개학 3.2 금) ↔ 2028학년도 1주(2.28 주, 개학 3.2 목)
//   - V3 글만 있는 날도 읽는다, 작년 칸을 눌러도 하루 화면으로 가지 않는다, 다음 주 줄에는 붙지 않는다
//   - 주를 넘기면 작년 주도 따라간다, 다시 누르면 꺼진다
//   7-2 올해로 가져오기
//   - 골라서 가져오면 올해 같은 요일 서버 문서에 복사본(새 id, 라벨째, 완료·알림·링크 빼고), 작년 것은 그대로
//   - 올해 같은 글이 있는 일정은 '올해 있음'(고를 수 없음), 안내의 되돌리기는 가져온 것만 뺀다
//   - 모두 고르기, 두 번 가져와도 두 벌이 되지 않는다
// 자료는 2028-02-28 주(작년)와 2029-02-26 주(올해)에 심고 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-last-year.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

/** 머리줄의 📅 달력 '직접 선택'으로 그 날짜로 (19번 U4에서 명령 창을 지운 뒤) */
async function pickDate(page, date) {
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await page.waitForTimeout(300);
  }
  await direct.fill(date);
  await page.mouse.move(5, 600);
  await page.waitForTimeout(800);
}


const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'last-year');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const ref = (col, date) => doc(db, 'users', user.uid, col, date);

const SEED = [
  [
    ref('events', '2028-02-28'),
    {
      eventList: [
        {
          id: 'ly_e1',
          content: '작년 입학식 준비 점검',
          label: '달력',
          labelIds: ['ev_1'],
          completed: true,
          time: '2028-02-28T09:00',
          linkedItems: [{ targetType: 'memo', targetId: 'm_x', title: '작년 메모' }],
        },
      ],
      eventText: '[v] [달력] 작년 입학식 준비 점검',
    },
  ],
  [
    ref('events', '2028-02-29'),
    { eventList: [{ id: 'ly_e2', content: '화요일 학년 협의회', completed: false }], eventText: '화요일 학년 협의회' },
  ],
  // V3 글만 있는 날 (eventList 없이 eventText만)
  [ref('events', '2028-03-02'), { eventText: '작년 V3 글만 있는 일정' }],
  [
    ref('journals', '2028-03-01'),
    { entries: [{ id: 'ly_j1', content: '작년 첫 주 학급 규칙 정함\n둘째 줄', labelIds: ['j_1'], createdAt: Date.now() }] },
  ],
  // 올해: 화요일에는 같은 글의 일정이 이미 있다
  [
    ref('events', '2029-02-27'),
    { eventList: [{ id: 'ty_e1', content: '화요일 학년 협의회', completed: false }], eventText: '화요일 학년 협의회' },
  ],
];
// 끝에 지울 올해 문서 (가져온 것이 들어가는 곳)
const CLEAN = [ref('events', '2029-02-26'), ref('journals', '2029-02-28'), ref('events', '2029-03-01')];

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
/** 화면은 로컬 쓰기를 먼저 보여 주므로 서버는 기다려 읽는다 */
const serverUntil = async (r, pred, ms = 8000) => {
  const end = Date.now() + ms;
  let data;
  while (Date.now() < end) {
    data = (await getDocFromServer(r)).data();
    if (pred(data)) return data;
    await new Promise((res) => setTimeout(res, 300));
  }
  return data;
};
const evList = (d) => d?.eventList || [];
const jrList = (d) => d?.entries || [];

const run = async () => {
  for (const r of CLEAN) await deleteDoc(r);
  for (const [r, data] of SEED) await setDoc(r, data);
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  const toggle = () => page.locator('[data-last-year-toggle]');
  const label = () => page.locator('[data-last-year-label]');
  const lastDay = (d) => page.locator(`[data-last-year="${d}"]`);
  const picks = () => page.locator('[data-last-year-picks]');
  const pickBox = (name) => page.getByRole('checkbox', { name });
  const MON = /작년 일정 고르기: 작년 입학식/;
  const WED = /작년 기록 고르기: 작년 첫 주 학급 규칙/;
  const THU = /작년 일정 고르기: 작년 V3 글만/;

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    await page.getByRole('button', { name: '주간', exact: true }).first().click();
    await toggle().waitFor({ timeout: 10000 });

    // 2029-02-28이 든 주로 (📅 달력, 주간에 남는다)
    await pickDate(page, '2029-02-28');
    await page.locator('[data-date="2029-02-26"]').first().waitFor({ timeout: 10000 });

    // ── 1. 처음에는 꺼져 있다 ──
    check('처음에는 꺼짐', (await toggle().getAttribute('aria-pressed')) === 'false');
    check('꺼져 있으면 작년 칸이 없다', (await page.locator('[data-last-year]').count()) === 0);

    // ── 2. 켜면 작년 같은 주 ──
    await toggle().click();
    check('켜짐', (await toggle().getAttribute('aria-pressed')) === 'true');
    const text = (await label().innerText()).replace(/\s+/g, ' ');
    check('작년 같은 주 = 2028학년도 1주 (개학 주끼리)', text.includes('2028학년도 1주 · 2028.2.28 (월) ~ 3.5 (일)'), text);
    await lastDay('2028-02-28').getByText('작년 입학식 준비 점검').waitFor({ timeout: 10000 }).catch(() => {});
    const mon = page.locator('[data-date="2029-02-26"]').first();
    const monLast = mon.locator('[data-last-year="2028-02-28"] [data-last-year-item="event"]');
    check(
      '월요일 카드 아래에 작년 월요일 일정 (라벨 칩째)',
      (await monLast.count()) === 1 &&
        (await monLast.locator('span span').first().innerText()) === '달력' &&
        (await monLast.innerText()).includes('작년 입학식 준비 점검')
    );
    check(
      '수요일 카드에 작년 수요일 기록 (라벨 이름째)',
      (await page.locator('[data-date="2029-02-28"]').first().locator('[data-last-year="2028-03-01"]').innerText()).includes('[학급활동]')
    );
    check('V3 글만 있는 날의 일정도 보인다', (await lastDay('2028-03-02').innerText()).includes('작년 V3 글만 있는 일정'));
    check('작년에 아무것도 없는 날은 \'없음\'', (await lastDay('2028-03-03').innerText()).includes('없음'));
    check('다음 주 줄에는 붙지 않는다', (await page.locator('section[aria-label="다음 주"] [data-last-year]').count()) === 0);
    const tue = lastDay('2028-02-29').locator('[data-last-year-item="event"]');
    check('올해 같은 글이 있는 일정은 \'올해 있음\' (고를 수 없음)', (await tue.innerText()).includes('올해 있음') && (await tue.locator('input').count()) === 0);
    await page.screenshot({ path: 'tools/report/last-year.png' });

    // ── 3. 작년 항목을 누르면 고른다 (하루 화면으로 가지 않는다) ──
    await lastDay('2028-02-28').getByText('작년 입학식 준비 점검').click();
    await page.waitForTimeout(300);
    check('작년 항목을 눌러도 주간에 남는다', (await toggle().count()) === 1);
    check('누르면 체크되고 \'1개 고름\'', (await pickBox(MON).isChecked()) && (await picks().innerText()).includes('1개 고름'));

    // ── 4. 셋 골라 올해로 가져오기 ──
    await pickBox(WED).check();
    await pickBox(THU).check();
    check('셋 고름', (await picks().innerText()).includes('3개 고름'));
    await page.screenshot({ path: 'tools/report/last-year-picked.png' });
    await page.locator('[data-last-year-import]').click();
    const monDoc = await serverUntil(ref('events', '2029-02-26'), (d) => evList(d).length === 1);
    const copy = evList(monDoc)[0] || {};
    check('올해 월요일에 복사본 (새 id·라벨째)', copy.content === '작년 입학식 준비 점검' && copy.id !== 'ly_e1' && copy.label === '달력' && copy.labelIds?.[0] === 'ev_1', JSON.stringify(copy).slice(0, 160));
    check('완료는 풀고 알림·링크는 가져오지 않는다', copy.completed === false && !copy.time && (copy.linkedItems || []).length === 0);
    check('V3가 읽는 글(eventText)도 함께', monDoc?.eventText === '[달력] 작년 입학식 준비 점검', monDoc?.eventText);
    const wedDoc = await serverUntil(ref('journals', '2029-02-28'), (d) => jrList(d).length === 1);
    check('올해 수요일에 기록 복사본 (라벨째)', jrList(wedDoc)[0]?.content === '작년 첫 주 학급 규칙 정함\n둘째 줄' && jrList(wedDoc)[0]?.labelIds?.[0] === 'j_1');
    const thuDoc = await serverUntil(ref('events', '2029-03-01'), (d) => evList(d).length === 1);
    check('V3 글만 있던 작년 일정도 올해 목요일로', evList(thuDoc)[0]?.content === '작년 V3 글만 있는 일정');
    const lastMon = (await getDocFromServer(ref('events', '2028-02-28'))).data();
    check('작년 것은 그대로', evList(lastMon).length === 1 && evList(lastMon)[0].id === 'ly_e1' && evList(lastMon)[0].completed === true);
    const toast = page.getByRole('status').filter({ hasText: '올해로 가져왔습니다' });
    await toast.first().waitFor({ timeout: 5000 }).catch(() => {});
    check('안내: 일정 2개·기록 1개', (await toast.first().innerText().catch(() => '')).includes('일정 2개·기록 1개'));
    await mon.getByText('작년 입학식 준비 점검').first().waitFor({ timeout: 5000 }).catch(() => {});
    check('올해 월요일 칸에 보이고 작년 칸은 \'올해 있음\'', (await monLast.innerText()).includes('올해 있음'));
    check('가져오면 고른 것이 풀린다', (await picks().count()) === 0);

    // ── 5. 되돌리기는 가져온 것만 뺀다 ──
    await toast.first().getByRole('button', { name: '되돌리기' }).click();
    const undone = await serverUntil(ref('events', '2029-02-26'), (d) => evList(d).length === 0);
    const undoneWed = await serverUntil(ref('journals', '2029-02-28'), (d) => jrList(d).length === 0);
    const tueDoc = (await getDocFromServer(ref('events', '2029-02-27'))).data();
    check('되돌리기 → 가져온 일정·기록이 빠진다', evList(undone).length === 0 && jrList(undoneWed).length === 0);
    check('올해 원래 있던 일정은 그대로', evList(tueDoc).length === 1 && evList(tueDoc)[0].id === 'ty_e1');

    // ── 6. 모두 고르기 → 다시 가져오기 → 또 가져와도 두 벌이 되지 않는다 ──
    await monLast.locator('input').waitFor({ timeout: 5000 }).catch(() => {});
    await page.locator('[data-last-year-pick-all]').click();
    check('모두 고르기 = 3개 (올해 있는 화요일 일정은 빼고)', (await picks().innerText()).includes('3개 고름'), await picks().innerText());
    await page.locator('[data-last-year-import]').click();
    await serverUntil(ref('events', '2029-03-01'), (d) => evList(d).length === 1);
    await mon.getByText('작년 입학식 준비 점검').first().waitFor({ timeout: 5000 }).catch(() => {});
    await page.waitForTimeout(500);
    await page.locator('[data-last-year-pick-all]').click();
    check('다시 모두 고르기 = 기록 1개만 (일정은 올해 있음)', (await picks().innerText()).includes('1개 고름'), await picks().innerText());
    await page.locator('[data-last-year-import]').click();
    const skipToast = page.getByRole('status').filter({ hasText: '건너뛰었습니다' });
    await skipToast.first().waitFor({ timeout: 5000 }).catch(() => {});
    check('같은 기록은 건너뛰었다고 알린다', (await skipToast.count()) > 0);
    const wedAgain = (await getDocFromServer(ref('journals', '2029-02-28'))).data();
    check('기록이 두 벌이 되지 않는다', jrList(wedAgain).length === 1, String(jrList(wedAgain).length));

    // ── 7. 주를 넘기면 작년 주도 따라간다 ──
    await page.getByTitle(/^이전 날짜/).click();
    await page.waitForFunction(() => document.querySelector('[data-last-year-label]')?.textContent?.includes('52주'), null, { timeout: 8000 }).catch(() => {});
    const prev = (await label().innerText()).replace(/\s+/g, ' ');
    check('이전 주 → 2027학년도 52주 (2028.2.21 주)', prev.includes('2027학년도 52주 · 2028.2.21 (월) ~ 2.27 (일)'), prev);

    // ── 8. 끄기 (명령 창 '작년'은 19번 U4에서 명령 창과 함께 없어졌다 - 단축키 '작년 이맘때'로는 그대로) ──
    await toggle().click();
    check('다시 누르면 꺼지고 작년 칸이 사라진다', (await page.locator('[data-last-year]').count()) === 0);
  } finally {
    for (const [r] of SEED) await deleteDoc(r);
    for (const r of CLEAN) await deleteDoc(r);
  }

  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await browser.close();
  const fail = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - fail}/${results.length} 통과`);
  process.exit(fail ? 1 : 0);
};

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
