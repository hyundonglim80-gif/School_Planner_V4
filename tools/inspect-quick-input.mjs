// tools/inspect-quick-input.mjs
//
// 새 일정 빠른 입력(docs/ROADMAP.md 11-1)을 실제 크롬으로 확인한다.
//   - '다음 주 화 … 15:00 #라벨' → 칩 셋(날짜·알림·라벨) → 모두 넣기 → 날짜 칸·알림·라벨·글 → 저장하면 서버에 그대로
//   - 칩 하나만(내일), 날짜가 아닌 것((1/3)·1시간)에는 칩 없음, '매주 화' → 반복 일정 등록 창이 그 요일로
//   - 고치는 칸에는 칩이 없다
// 점검으로 만든 일정('점검빠른'으로 시작)은 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-quick-input.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-quick-input');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const today = new Date();
today.setHours(0, 0, 0, 0);
const plus = (n) => {
  const d = new Date(today);
  d.setDate(d.getDate() + n);
  return d;
};
// 다음 주 화요일 (월요일 시작 주)
const monday = plus(-((today.getDay() + 6) % 7));
const NEXT_TUE = new Date(monday);
NEXT_TUE.setDate(monday.getDate() + 8);
const NEXT_TUE_STR = ymd(NEXT_TUE);
const TOMORROW = ymd(plus(1));
const DAYS = '일월화수목금토';
const short = (d) => `${d.getMonth() + 1}/${d.getDate()}(${DAYS[d.getDay()]})`;

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (read, pred, ms = 8000) => {
  const end = Date.now() + ms;
  let v;
  while (Date.now() < end) {
    v = await read();
    if (pred(v)) return v;
    await sleep(300);
  }
  return v;
};
const eventsRef = (date) => doc(db, 'users', uid, 'events', date);
const serverEvents = async (date) => (await getDocFromServer(eventsRef(date))).data()?.eventList || [];

async function cleanup() {
  for (const date of [NEXT_TUE_STR, TOMORROW, ymd(today)]) {
    const snap = await getDocFromServer(eventsRef(date));
    if (!snap.exists()) continue;
    const all = snap.data().eventList || [];
    const list = all.filter((e) => !String(e.content || '').startsWith('점검빠른'));
    if (list.length !== all.length) {
      await setDoc(eventsRef(date), { eventList: list, eventText: list.map((e) => e.content).join('\n'), updatedAt: Date.now() }, { merge: true });
    }
  }
}

const run = async () => {
  await cleanup();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  const panel = page.getByRole('complementary', { name: '일정 쓰기' });
  const box = () => panel.getByPlaceholder('새로운 일정을 입력하세요...');
  const chip = (key) => panel.locator(`[data-quick-chip="${key}"]`);
  const openNew = async () => {
    await page.getByRole('button', { name: '일정 추가' }).first().click();
    await box().waitFor({ timeout: 10000 });
  };
  const closePanel = async () => {
    await panel.getByRole('button', { name: '닫기', exact: true }).click();
    await page.waitForTimeout(300);
  };

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 1. 날짜 + 시각 + 라벨 → 모두 넣기 → 저장 ──
    await openNew();
    // 미리 골라지지 않은 라벨 하나 (라벨 단추는 aria-pressed)
    const labelBtns = panel.locator('button[aria-pressed]');
    const names = await labelBtns.evaluateAll((els) =>
      els
        .filter((e) => e.getAttribute('aria-pressed') === 'false' && !/\s/.test(e.textContent.trim()))
        .map((e) => e.textContent.trim())
        // 수업을 비우는 라벨(수업X·공휴일·휴업)은 그날 수업 칸을 건드릴 수 있어 쓰지 않는다
        .filter((n) => !/수업X|공휴일|휴업/.test(n))
    );
    const LABEL = names[0];
    check('점검에 쓸 라벨이 있다', !!LABEL, String(LABEL));
    await box().fill(`다음 주 화 점검빠른 협의회 15:00 #${LABEL}`);
    await panel.locator('[data-quick-chips]').waitFor({ timeout: 4000 });
    check('📅 날짜 칩 (다음 주 화요일)', (await chip('date').innerText()).includes(short(NEXT_TUE)), await chip('date').innerText());
    check('⏰ 시각 칩', (await chip('time').innerText()).includes('15:00 알림'));
    check('🏷️ 라벨 칩', (await chip(`label:${LABEL}`).count()) === 1);
    await page.screenshot({ path: 'tools/report/quick-input.png' });
    check('칩을 누르기 전에는 글·날짜 그대로', (await box().inputValue()).startsWith('다음 주 화') && (await panel.getByLabel('일정 날짜').inputValue()) === ymd(today));
    await chip('all').click();
    await page.waitForTimeout(300);
    check('모두 넣기 → 날짜·라벨 말은 빠지고 시각은 남는다', (await box().inputValue()) === '점검빠른 협의회 15:00', JSON.stringify(await box().inputValue()));
    check('날짜 칸이 다음 주 화요일', (await panel.getByLabel('일정 날짜').inputValue()) === NEXT_TUE_STR);
    check('알림 단추에 그날 15:00', (await panel.getByRole('button', { name: /⏰/ }).first().innerText()).includes(`${pad(NEXT_TUE.getMonth() + 1)}/${pad(NEXT_TUE.getDate())} 15:00`));
    check('라벨이 골라졌다', (await panel.getByRole('button', { name: LABEL, exact: true }).getAttribute('aria-pressed')) === 'true');
    check('넣은 뒤에는 칩이 사라진다', (await panel.locator('[data-quick-chips]').count()) === 0);
    await box().press('Control+s');
    const saved = await until(() => serverEvents(NEXT_TUE_STR), (l) => l.some((e) => e.content === '점검빠른 협의회 15:00'));
    const ev = saved.find((e) => e.content === '점검빠른 협의회 15:00');
    check('저장 → 다음 주 화요일 문서에 그 글 그대로', !!ev, JSON.stringify(ev || {}).slice(0, 160));
    check('알림 시각·라벨도 저장', ev?.time === `${NEXT_TUE_STR}T15:00` && String(ev?.label || '').split(',').includes(LABEL), `${ev?.time} ${ev?.label}`);
    // 저장하면 고치는 칸 - 칩이 없다
    await box().fill('점검빠른 협의회 15:00 내일');
    await page.waitForTimeout(250);
    check('고치는 칸에는 빠른 입력 칩이 없다', (await panel.locator('[data-quick-chips]').count()) === 0);
    await box().fill('점검빠른 협의회 15:00');
    await closePanel();

    // ── 2. 칩 하나만 ──
    await openNew();
    await box().fill('내일 점검빠른 단일');
    await chip('date').waitFor({ timeout: 4000 });
    await chip('date').click();
    await page.waitForTimeout(250);
    check('날짜 칩만 → 내일로, 그 말만 빠진다', (await panel.getByLabel('일정 날짜').inputValue()) === TOMORROW && (await box().inputValue()) === '점검빠른 단일');
    await closePanel();

    // ── 3. 날짜가 아닌 것 ──
    await openNew();
    await box().fill('점검빠른 기말고사 (1/3) 1시간 3교시');
    await page.waitForTimeout(250);
    check('(1/3)·1시간·3교시에는 칩이 없다 (안내만)', (await panel.locator('[data-quick-chips]').count()) === 0 && (await panel.getByText('칩으로 넣을 수 있습니다').count()) === 1);

    // ── 4. 매주 화 → 반복 일정 등록 창 ──
    await box().fill('매주 화 점검빠른 반복');
    await chip('recur').waitFor({ timeout: 4000 });
    check('🔁 반복 칩', (await chip('recur').innerText()).includes('매주 화 반복 등록'));
    await chip('recur').click();
    const recur = page.getByRole('dialog').filter({ hasText: '반복 일정' }).last();
    await recur.waitFor({ timeout: 6000 });
    const contentVal = await recur.locator('input[type="text"], textarea').first().inputValue();
    check('반복 창에 글(반복 말은 뺀)', contentVal === '점검빠른 반복', JSON.stringify(contentVal));
    const tue = recur.getByRole('button', { name: '화', exact: true });
    check('화요일이 골라져 있다', ((await tue.getAttribute('class')) || '').includes('bg-primary'));
    await recur.getByRole('button', { name: '닫기' }).last().click();
    await page.waitForTimeout(300);
    check('반복 창을 닫으면 새 일정 칸은 그대로', (await box().inputValue()) === '매주 화 점검빠른 반복');
    await box().fill('');
    await closePanel();
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/quick-input-error.png' }).catch(() => {});
  } finally {
    check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
    await browser.close();
    await cleanup();
  }
};

await run();
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
