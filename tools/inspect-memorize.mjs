// tools/inspect-memorize.mjs
//
// 명렬표 암기 (2026-10-07 사용자 요청) - 실제 크롬으로 본다 (PC 1400px, teacher).
//   - 문제와 정답의 사진이 같은 자리·같은 크기 (가로로 긴 사진·세로로 긴 사진도), 정답 칸에는 이름만
//   - 출제 수 2 → 두 장 뒤 '회차를 마쳤습니다' / 0 = 계속 → 학생 수보다 많이 넘겨도 끝나지 않고 바퀴가 는다
//   - 함께 외울 학급: 9-2를 더하면 두 학급 학생이 섞여 나온다
//   - 자동 넘김 1초: 1초 뒤 이름, 다시 1초 뒤 다음 문제
// 에뮬레이터에는 드라이브가 없어 googleapis를 흉내 낸다(inspect-class-photos와 같은 방식).
// 점검용 학급 9-1·9-2(올해)를 심었다가 끝에 명렬표·암기 성적을 처음대로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-memorize.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';
const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-memorize');
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const rosterRef = doc(db, 'users', user.uid, 'settings', 'rosters');
const quizRef = doc(db, 'users', user.uid, 'settings', 'photoQuiz');

const t0 = new Date();
const AY = t0.getMonth() >= 2 ? t0.getFullYear() : t0.getFullYear() - 1;
const rosterSnap = await getDocFromServer(rosterRef);
const rosterBefore = rosterSnap.exists() ? rosterSnap.data() : null;
const quizSnap = await getDocFromServer(quizRef);
const quizBefore = quizSnap.exists() ? quizSnap.data() : null;
const original = (rosterBefore && (rosterBefore.classList || rosterBefore.rosters)) || [];
const mk = (classNum, pre) => ({
  year: AY, grade: '9', classNum,
  students: [1, 2, 3].map((num) => ({ num, name: `${pre}${num}학생`, gender: '', isActive: true, note: '' })),
});
const C1 = mk('1', '가');
const C2 = mk('2', '나');
const classes = [...original.filter((c) => !(Number(c.year) === AY && String(c.grade) === '9')), C1, C2];
await setDoc(rosterRef, { classList: classes, rosters: classes, updatedAt: Date.now() }, { merge: true });
const byFolder = { [`${AY}-9-1`]: C1, [`${AY}-9-2`]: C2 };

let pass = 0;
let fail = 0;
const check = (name, ok, detail = '') => {
  if (ok) pass += 1;
  else fail += 1;
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? `  (${detail})` : ''}`);
};

// 가로로 긴 사진(60x15)과 세로로 긴 사진(15x60) - 사진 모양이 달라도 틀이 같은지 본다
const WIDE = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAADwAAAAPCAIAAAA3cDsmAAAALElEQVR4nGM4ISc35BDDgLtg1NGDGI06etTRo44eBGjU0aOOHnX0IEBD0tEAhEmSPrg10a8AAAAASUVORK5CYII=', 'base64');
const TALL = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAA8AAAA8CAIAAAA2WnceAAAAJ0lEQVR4nGOQkztBPGIYVT2qelT1qOpR1aOqR1WPqh5VPap6UKgGADQCkj6lwMsoAAAAAElFTkSuQmCC', 'base64');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 950 } });
await ctx.addInitScript(() => sessionStorage.setItem('google_api_token', 'fake-token'));
await ctx.route('https://oauth2.googleapis.com/tokeninfo**', (r) => r.fulfill({ status: 200, json: { ok: 1 } }));
await ctx.route('https://www.googleapis.com/drive/v3/files**', (r) => {
  const url = new URL(r.request().url());
  const idm = url.pathname.match(/files\/([^/]+)$/);
  if (url.searchParams.get('alt') === 'media' || idm) {
    const odd = Number((idm?.[1] || '').split('-').pop()) % 2 === 1;
    return r.fulfill({ status: 200, contentType: 'image/png', body: odd ? WIDE : TALL });
  }
  const q = url.searchParams.get('q') || '';
  const named = q.match(/name='([^']+)'/);
  if (q.includes('application/vnd.google-apps.folder') && named) {
    return r.fulfill({ status: 200, json: { files: [{ id: `fold-${named[1]}`, name: named[1] }] } });
  }
  const parent = q.match(/'fold-([^']+)' in parents/);
  const cls = parent && byFolder[parent[1]];
  if (cls) {
    return r.fulfill({
      status: 200,
      json: {
        files: cls.students.map((s) => ({
          id: `ph-${cls.classNum}-${s.num}`, name: `${parent[1]}-${String(s.num).padStart(2, '0')}-${s.name}.png`,
          mimeType: 'image/png', modifiedTime: '2026-01-01T00:00:00Z',
        })),
      },
    });
  }
  return r.fulfill({ status: 200, json: { files: [] } });
});

const page = await ctx.newPage();
page.setDefaultTimeout(15000);
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
const roster = page.locator('[data-roster-embedded]');
const stage = roster.locator('[data-quiz-stage]');
const photoBox = () => roster.locator('[data-quiz-photo]').boundingBox();
const imgBox = () => roster.locator('[data-quiz-photo] img').boundingBox();
const same = (a, b) => a && b && Math.abs(a.x - b.x) < 1 && Math.abs(a.y - b.y) < 1 && Math.abs(a.width - b.width) < 1 && Math.abs(a.height - b.height) < 1;
const fmt = (b) => (b ? `${Math.round(b.x)},${Math.round(b.y)} ${Math.round(b.width)}x${Math.round(b.height)}` : '없음');
const setNum = async (sel, v) => {
  await roster.locator(sel).fill(String(v));
  await page.waitForTimeout(400);
};
const curName = async () => ((await roster.locator('[data-quiz-photo] img').getAttribute('alt')) || '').replace(/ 사진$/, '');

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.locator('header').getByRole('button', { name: '학급', exact: true }).first().click();
  await page.getByLabel('학급 고르기').selectOption(`${AY}_9_1`);
  await page.locator('[data-class-mode="roster"]').click();
  await roster.waitFor();
  await roster.getByRole('button', { name: '암기', exact: true }).click();
  const photosOn = roster.getByRole('button', { name: '사진 켜기' });
  if (await photosOn.count()) await photosOn.click();
  await stage.waitFor({ timeout: 20000 });

  const settings = roster.locator('[data-quiz-settings]');
  check('설정 줄: 자동 넘김(초) · 출제 수 · 함께 외울 학급(9-1 늘 켬, 9-2)',
    (await settings.locator('[data-quiz-auto]').count()) === 1 && (await settings.locator('[data-quiz-count]').count()) === 1
    && (await settings.locator('[data-quiz-class="9-1"]').getAttribute('aria-pressed')) === 'true'
    && (await settings.locator('[data-quiz-class="9-1"]').isDisabled())
    && (await settings.locator('[data-quiz-class="9-2"]').getAttribute('aria-pressed')) === 'false');

  // ── 사진 자리·크기 고정, 정답은 이름만 ──
  const boxes = [];
  const imgs = [];
  for (let i = 0; i < 3; i++) {
    const q = await photoBox();
    const qi = await imgBox();
    const name = await curName();
    await roster.getByRole('button', { name: /알아요/ }).click();
    await roster.locator('[data-quiz-name]').waitFor();
    const a = await photoBox();
    const ai = await imgBox();
    const answerText = (await roster.locator('[data-quiz-answer]').innerText()).trim();
    if (i === 0) {
      if (process.env.SHOT) await roster.screenshot({ path: process.env.SHOT });
      check('문제 → 정답에서 사진의 자리·크기가 같다', same(q, a) && same(qi, ai), `${fmt(qi)} → ${fmt(ai)}`);
      check('정답 칸에는 이름만', answerText === name, `'${answerText}' / '${name}'`);
    }
    boxes.push(q, a);
    imgs.push(qi, ai);
    await roster.getByRole('button', { name: /^다음/ }).click();
    await page.waitForTimeout(250);
  }
  check('가로·세로로 긴 사진도 학생이 바뀌어도 틀이 같다', boxes.every((b) => same(b, boxes[0])) && imgs.every((b) => same(b, imgs[0])), imgs.map(fmt).join(' | '));

  // ── 출제 수 ──
  await setNum('[data-quiz-count]', 2);
  await stage.waitFor();
  const prog = await roster.locator('[data-quiz-progress]').innerText();
  for (let i = 0; i < 2; i++) {
    await roster.getByRole('button', { name: /알아요/ }).click();
    await roster.getByRole('button', { name: /^다음/ }).click();
    await page.waitForTimeout(200);
  }
  check('출제 수 2 → 두 장 뒤 회차를 마친다', /0 \/ 2/.test(prog) && (await roster.getByText(/회차를 마쳤습니다/).count()) === 1, prog.replace(/\s+/g, ' '));
  await setNum('[data-quiz-count]', 0);
  await stage.waitFor();
  for (let i = 0; i < 5; i++) {
    await roster.getByRole('button', { name: /모르겠어요/ }).click();
    await roster.getByRole('button', { name: /^다음/ }).click();
    await page.waitForTimeout(200);
  }
  const prog0 = await roster.locator('[data-quiz-progress]').innerText();
  check('출제 수 0 = 계속: 학생 수(3)보다 많이 넘겨도 끝나지 않고 바퀴가 는다',
    (await stage.count()) === 1 && (await roster.getByText(/회차를 마쳤습니다/).count()) === 0 && /5장째 · 계속 \(([2-9])바퀴째\)/.test(prog0), prog0.replace(/\s+/g, ' '));

  // ── 함께 외울 학급 ──
  await settings.locator('[data-quiz-class="9-2"]').click();
  await roster.locator('[data-quiz-class-label]', { hasText: '2개 학급' }).waitFor({ timeout: 20000 });
  await stage.waitFor();
  const seen = new Set();
  for (let i = 0; i < 6; i++) {
    seen.add(await curName());
    await roster.getByRole('button', { name: /알아요/ }).click();
    await roster.getByRole('button', { name: /^다음/ }).click();
    await page.waitForTimeout(200);
  }
  const names = [...seen];
  check('9-2를 더하면 두 학급 학생이 함께 나온다 (여섯 장에 여섯 명)', names.length === 6 && names.some((n) => n.startsWith('가')) && names.some((n) => n.startsWith('나')), names.join(','));

  // ── 자동 넘김 ──
  await settings.locator('[data-quiz-class="9-2"]').click();
  await roster.locator('[data-quiz-class-label]', { hasText: '9학년' }).waitFor({ timeout: 10000 }).catch(() => {});
  await setNum('[data-quiz-auto]', 1);
  const before = await roster.locator('[data-quiz-progress]').innerText();
  const st0 = await stage.getAttribute('data-quiz-stage');
  await page.waitForTimeout(1300);
  const st1 = await stage.getAttribute('data-quiz-stage');
  await page.waitForTimeout(1100);
  const st2 = await stage.getAttribute('data-quiz-stage');
  const after = await roster.locator('[data-quiz-progress]').innerText();
  check('자동 넘김 1초: 문제 → 이름 → 다음 문제', st0 === 'question' && st1 === 'answer' && st2 === 'question' && before !== after, `${st0}→${st1}→${st2}, ${before.replace(/\s+/g, ' ')} → ${after.replace(/\s+/g, ' ')}`);
  await setNum('[data-quiz-auto]', 0);
  const s0 = await stage.getAttribute('data-quiz-stage');
  await page.waitForTimeout(1500);
  check('자동 넘김 0 = 끔: 기다려도 그대로', (await stage.getAttribute('data-quiz-stage')) === s0);
  check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
} catch (e) {
  check('점검 도중 오류', false, String(e).slice(0, 300));
} finally {
  await page.evaluate(() => { localStorage.removeItem('sp4-photo-quiz'); localStorage.setItem('sp4-roster-photos', '0'); }).catch(() => {});
  await page.locator('[data-class-mode="hub"]').click({ timeout: 2000 }).catch(() => {});
  await page.waitForTimeout(2500);
  await browser.close();
  if (rosterBefore) await setDoc(rosterRef, rosterBefore);
  else await deleteDoc(rosterRef);
  if (quizBefore) await setDoc(quizRef, quizBefore);
  else await deleteDoc(quizRef);
}
console.log(`\n${pass}/${pass + fail}`);
process.exit(fail ? 1 : 0);
