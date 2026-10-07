// tools/inspect-gcal-login.mjs
//
// '구글 캘린더' 일정을 저장할 때 구글 로그인이 없으면 로그인을 묻는다 (2026-10-07 사용자 요청) - 실제 크롬 (PC 1400px, teacher).
//   - 토큰 없이 '달력'(구글 캘린더를 켠 라벨) 일정을 저장 → 구글 로그인 창(팝업)이 열린다 → 닫으면 '아직 보내지 않았습니다' 안내
//   - 브라우저가 팝업을 막으면 → '구글 로그인이 필요합니다' 창에 구글 캘린더 까닭 글, 취소하면 안내
//   - 구글 캘린더를 켜지 않은 일정은 묻지 않는다
// 구글 API는 흉내 낸다(토큰 검사는 늘 실패). 설정·그날 일정·큐는 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-gcal-login.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const DAY = '2026-10-27';
const MARK = '점검로그인';
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-gcal-login');
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
const gcalRef = uref('settings', 'v4_gcal');
const dayRef = uref('events', DAY);
const queueCol = collection(db, 'users', user.uid, 'v4_gcalQueue');
const before = { gcal: await read(gcalRef), day: await read(dayRef) };
const queueBefore = new Set((await getDocsFromServer(queueCol)).docs.map((d) => d.id));

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.route('https://oauth2.googleapis.com/tokeninfo**', (r) => r.fulfill({ status: 400, json: {} }));
await ctx.route('https://www.googleapis.com/calendar/v3/**', (r) => r.fulfill({ status: 401, json: {} }));
const page = await ctx.newPage();
// 앱 탭 뒤에 열리는 창만 센다 (구글 로그인 팝업)
const popups = [];
ctx.on('page', (p) => popups.push(p));
page.setDefaultTimeout(15000);
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

async function pickDate(date) {
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) await page.getByTitle(/달력에서 날짜 선택/).first().click();
  await direct.fill(date);
  await page.mouse.move(5, 600);
  await page.waitForTimeout(1200);
}
async function addEvent(text, gcalOn) {
  await page.getByRole('button', { name: '일정 추가' }).click();
  await page.getByPlaceholder('새로운 일정을 입력하세요...').fill(text);
  const drawer = page.locator('aside', { has: page.getByPlaceholder('새로운 일정을 입력하세요...') }).first();
  const box = drawer.locator('[data-event-attr="gcal"]');
  await box.waitFor();
  if ((await box.isChecked()) !== gcalOn) await box.click();
  await drawer.getByRole('button', { name: '저장', exact: true }).click();
  return drawer;
}
const toast = (re) => page.getByText(re).first().waitFor({ timeout: 12000 }).then(() => true, () => false);

try {
  await setDoc(gcalRef, { labels: { ev_1: true }, updatedAt: Date.now() });
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);
  await pickDate(DAY);

  // 1) 켜지 않은 일정 - 묻지 않는다
  await addEvent(`${MARK} 안 보냄`, false);
  await page.waitForTimeout(2500);
  check('구글 캘린더를 끈 일정은 로그인을 묻지 않는다', popups.length === 0 && (await page.locator('[data-google-login-prompt]').count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 2) 켠 일정 - 저장 직후 로그인 창(팝업)이 바로 뜨거나(브라우저가 허락할 때), '구글 로그인이 필요합니다' 창의 단추로 뜬다
  await addEvent(`${MARK} 보냄`, true);
  const prompt0 = page.locator('[data-google-login-prompt]');
  let via = '';
  for (let i = 0; i < 60 && !via; i++) {
    if (popups.length > 0) via = '바로';
    else if (await prompt0.count()) via = '묻는 창';
    else await page.waitForTimeout(200);
  }
  if (via === '묻는 창') {
    await page.locator('[data-google-login]').click();
    for (let i = 0; i < 40 && popups.length === 0; i++) await page.waitForTimeout(200);
  }
  const promptErr = (await prompt0.locator('[role=alert]').innerText().catch(() => '')) || '';
  // 컨테이너의 인증 에뮬레이터는 구글 로그인 창을 열지 못한다(signInWithPopup 실패) - 그때는 단추가 로그인을 시도했는지(오류 글)까지 본다.
  // 실제 구글 창은 사용자 PC에서 확인한다(첨부의 같은 창은 10-02 PC에서 확인).
  check("토큰 없이 '구글 캘린더' 일정 저장 → 로그인을 묻고 구글 로그인 창(팝업)을 연다", popups.length > 0 || (via === '묻는 창' && !!promptErr), `${via} · ${popups[0]?.url().slice(0, 60) || '없음'} ${promptErr}`);
  if (popups.length) await popups[0].close();
  await page.waitForTimeout(1500);
  if (await prompt0.count()) await page.getByRole('button', { name: '취소', exact: true }).click();
  check('  로그인하지 않고 닫으면 아직 보내지 않았다고 알린다', await toast(/구글 로그인을 하지 않아 구글 캘린더에 아직 보내지 않았습니다/));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 3) 팝업이 막힐 때 - 묻는 창
  await page.evaluate(() => {
    window.open = () => null;
  });
  const n = popups.length;
  await addEvent(`${MARK} 막힘`, true);
  const prompt = page.locator('[data-google-login-prompt]');
  await prompt.waitFor({ timeout: 12000 }).catch(() => {});
  const reason = (await prompt.locator('[data-google-login-reason]').innerText().catch(() => '')) || '';
  check("팝업이 막히면 '구글 로그인이 필요합니다' 창 - 구글 캘린더 까닭 글", popups.length === n && /구글 캘린더/.test(reason), reason);
  await page.getByRole('button', { name: '취소', exact: true }).click();
  check('  취소하면 아직 보내지 않았다고 알린다', await toast(/구글 로그인을 하지 않아 구글 캘린더에 아직 보내지 않았습니다/));
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 2500));
  await browser.close();
  if (before.gcal) await setDoc(gcalRef, before.gcal);
  else await deleteDoc(gcalRef);
  if (before.day) await setDoc(dayRef, before.day);
  else await deleteDoc(dayRef);
  for (const d of (await getDocsFromServer(queueCol)).docs) if (!queueBefore.has(d.id)) await deleteDoc(d.ref);
}
const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
