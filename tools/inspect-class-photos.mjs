// tools/inspect-class-photos.mjs
//
// 학급 탭의 학생 명단 '이름 / 사진' 보기를 실제 크롬으로 본다 (2026-10-02 사용자 요청 - 명렬표 관리의 사진 보기와 같게).
//   - 처음엔 이름 보기, '📷 사진'을 누르면 학생마다 사진 카드 + '사진 n/n명'
//   - 사진을 누르면 크게(이름·'📷 사진 바꾸기'), ESC로 닫힘
//   - 카드의 이름을 누르면 그 학생의 누가기록
//   - 다시 열어도 사진 보기가 남는다(이 기기), 구글 연결이 없으면 '구글 연결하고 사진 불러오기' 띠
//   - '이름'으로 돌아가면 예전 명단
// 에뮬레이터에는 드라이브가 없어 googleapis를 흉내 낸다(폴더 찾기 → 'fold-<이름>', 학급 폴더 → 학생마다 사진, alt=media → PNG).
// 올해 학급이 없으면 점검용 9-1을 심었다가 끝에 뺀다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-class-photos.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';

const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-class-photos');
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const rosterRef = doc(db, 'users', user.uid, 'settings', 'rosters');

const t0 = new Date();
const AY = t0.getMonth() >= 2 ? t0.getFullYear() : t0.getFullYear() - 1;
const rosterData = (await getDocFromServer(rosterRef)).data() || {};
const original = rosterData.classList || rosterData.rosters || [];
let classes = original;
const hasClass = classes.some((c) => Number(c.year) === AY && (c.students || []).length > 1);
if (!hasClass) {
  classes = [...classes, {
    year: AY, grade: '9', classNum: '1',
    students: [1, 2, 3].map((num) => ({ num, name: `사진${num}`, gender: '', isActive: true, note: '' })),
  }];
  await setDoc(rosterRef, { classList: classes, rosters: classes, updatedAt: Date.now() }, { merge: true });
}
const CLS = classes.find((c) => Number(c.year) === AY && (c.students || []).length > 1);
const KEY = `${CLS.year}_${CLS.grade}_${CLS.classNum}`;
const FOLDER = `${CLS.year}-${CLS.grade}-${CLS.classNum}`;
const active = CLS.students.filter((s) => s.isActive !== false).sort((a, b) => a.num - b.num);
const S1 = active[0];
const S2 = active[1];

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? '✅' : '❌'} ${name}${detail ? `  (${detail})` : ''}`);
};

// 2x2 빨간 PNG
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAEklEQVR42mP8z8DAwMDAxAAGAA0RAQOwXc+sAAAAAElFTkSuQmCC', 'base64');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
// 구글 토큰이 있는 것처럼 (탭마다 sessionStorage) - 끝 항목에서는 빼고 연다
let withToken = true;
await ctx.addInitScript((on) => {
  if (on) sessionStorage.setItem('google_api_token', 'fake-token');
  else sessionStorage.removeItem('google_api_token');
}, true);
await ctx.route('https://oauth2.googleapis.com/tokeninfo**', (r) => r.fulfill(withToken ? { status: 200, json: { ok: 1 } } : { status: 400, json: {} }));
await ctx.route('https://www.googleapis.com/drive/v3/files**', (r) => {
  const url = new URL(r.request().url());
  if (url.searchParams.get('alt') === 'media' || url.pathname.match(/files\/[^/]+$/)) {
    return r.fulfill({ status: 200, contentType: 'image/png', body: PNG });
  }
  const q = url.searchParams.get('q') || '';
  const named = q.match(/name='([^']+)'/);
  if (q.includes('application/vnd.google-apps.folder') && named) {
    return r.fulfill({ status: 200, json: { files: [{ id: `fold-${named[1]}`, name: named[1] }] } });
  }
  if (q.includes(`'fold-${FOLDER}' in parents`)) {
    return r.fulfill({
      status: 200,
      json: {
        files: active.map((s) => ({
          id: `ph-${s.num}`, name: `${FOLDER}-${String(s.num).padStart(2, '0')}-${s.name}.png`,
          mimeType: 'image/png', modifiedTime: '2026-01-01T00:00:00Z',
        })),
      },
    });
  }
  return r.fulfill({ status: 200, json: { files: [] } });
});

const page = await ctx.newPage();
const errors = [];
page.on('pageerror', (e) => errors.push(e.message));
const screen = page.locator('[data-class-screen]');
const section = screen.locator('[data-class-students]');

try {
  await page.goto(V4);
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.getByRole('button', { name: '학급', exact: true }).first().click();
  await screen.waitFor({ timeout: 10000 });
  await screen.getByRole('combobox', { name: '학급 고르기' }).selectOption(KEY);
  await page.waitForTimeout(500);

  // 처음은 이름 보기 (드라이브를 부르지 않는다)
  if ((await section.locator('[data-class-view="photo"]').getAttribute('aria-pressed')) === 'true') {
    await section.locator('[data-class-view="name"]').click();
  }
  check('처음은 이름 보기 - 사진 칸이 없다', (await section.locator('[data-class-photo-grid]').count()) === 0
    && (await section.locator('[data-class-student]').count()) === active.length);

  // 사진 보기
  await section.locator('[data-class-view="photo"]').click();
  await section.locator('[data-class-photo-grid]').waitFor({ timeout: 10000 });
  const imgs = section.locator('[data-class-photo-grid] img');
  const allShown = await page.waitForFunction((n) => document.querySelectorAll('[data-class-photo-grid] img').length >= n, active.length, { timeout: 15000 }).then(() => true, () => false);
  check('📷 사진 → 학생마다 사진 카드', allShown && (await section.locator('[data-class-photo-card]').count()) === active.length, `${await imgs.count()}/${active.length}`);
  const count = await section.locator('[data-class-photo-count]').innerText().catch(() => '');
  check('  사진 n/n명', count.includes(`${active.length}/${active.length}`), count);

  // 사진을 누르면 크게
  await section.locator(`[data-class-photo-card="${S1.num}"] img`).click();
  const viewer = page.getByText(`${S1.num}번 ${S1.name}`);
  const opened = await viewer.first().waitFor({ timeout: 5000 }).then(() => true, () => false);
  check('사진을 누르면 크게 (이름)', opened);
  check('  아래 📷 사진 바꾸기', (await page.getByRole('button', { name: '📷 사진 바꾸기' }).count()) === 1);
  check('  누가기록은 열리지 않는다', (await page.getByRole('dialog').filter({ hasText: '누가기록' }).count()) === 0);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);
  check('  ESC로 닫힌다', (await page.getByRole('button', { name: '📷 사진 바꾸기' }).count()) === 0);

  // 카드의 이름 → 누가기록
  await section.locator(`[data-class-student="${S2.num}"]`).click();
  const rec = page.getByRole('dialog').filter({ hasText: '누가기록' }).last();
  await rec.waitFor({ timeout: 10000 }).catch(() => {});
  check('카드의 이름 → 그 학생의 누가기록', (await rec.count()) > 0 && (await rec.innerText()).includes(S2.name), S2.name);
  await page.keyboard.press('Escape');
  await page.waitForTimeout(400);

  // 다시 열어도 사진 보기 (이 기기)
  await page.reload();
  await page.getByRole('button', { name: '학급', exact: true }).first().click().catch(() => {});
  await section.locator('[data-class-photo-grid]').waitFor({ timeout: 15000 }).catch(() => {});
  check('다시 열어도 사진 보기가 남는다', (await section.locator('[data-class-view="photo"]').getAttribute('aria-pressed')) === 'true'
    && (await section.locator('[data-class-photo-grid]').count()) === 1);

  // 구글 연결이 없으면 띠 (명단은 그대로)
  withToken = false;
  await ctx.addInitScript(() => sessionStorage.removeItem('google_api_token'));
  await page.reload();
  await page.getByRole('button', { name: '학급', exact: true }).first().click().catch(() => {});
  const band = section.locator('[data-class-photo-auth]');
  const bandShown = await band.waitFor({ timeout: 15000 }).then(() => true, () => false);
  check('구글 연결이 없으면 \'구글 연결하고 사진 불러오기\' (로그인 창은 저절로 뜨지 않는다)', bandShown
    && (await page.locator('[data-google-login-prompt]').count()) === 0);
  check('  명단(빈 사진 칸·이름)은 그대로', (await section.locator('[data-class-photo-card]').count()) === active.length);

  // 이름 보기로 되돌림
  await section.locator('[data-class-view="name"]').click();
  await page.waitForTimeout(300);
  check('\'이름\' → 예전 명단', (await section.locator('[data-class-photo-grid]').count()) === 0
    && (await section.locator('[data-class-student]').count()) === active.length);

  check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
} finally {
  if (!hasClass) await setDoc(rosterRef, { classList: original, rosters: original, updatedAt: Date.now() }, { merge: true });
  await browser.close();
}
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
