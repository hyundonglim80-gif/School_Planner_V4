// tools/inspect-teaching-mode.mjs
//
// 18번 교과 전담 S1 '교사 유형' - 바뀐 부분만 실제 크롬으로 본다 (PC 1400px).
//   - teacher3(교과 전담): 시간표 창에 '교과 전담'이 골라져 있고 과목 칩 '과학'
//   - teacher3: '교과 + 담임' → 서버 unit:'class', hasHomeroom:true → 담임반 5-2 → homeroomClass:'5-2', 과목 더하기·빼기
//   - teacher2: 교사 유형 문서를 지우고 열면 하루 화면에 처음 안내 띠 → '나중에' → 초등 담임 문서가 생기고 띠가 사라진다
//   - teacher(기본): 띠가 없고 시간표 창은 '초등 담임'
//   바꾼 문서는 끝에 seed 값으로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-teaching-mode.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

// seed.mjs와 같은 값
const HOMEROOM_MODE = { unit: 'subject', hasHomeroom: true, homeroomClass: '', subjects: [], classColors: {} };
const SUBJECT_MODE = { unit: 'class', hasHomeroom: false, homeroomClass: '', subjects: ['과학'], classColors: {} };

/** 계정마다 따로 들어간다 - 규칙상 남의 문서는 못 쓴다 */
async function account(email) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, `inspect-teaching-${email}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const { user } = await signInWithEmailAndPassword(auth, email, 'test1234');
  const ref = doc(db, 'users', user.uid, 'settings', 'v4_teaching');
  return { ref, read: async () => (await getDocFromServer(ref)).data() || null };
}
const t1 = await account('teacher@example.com');
const t2 = await account('teacher2@example.com');
const t3 = await account('teacher3@example.com');

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
async function open(as) {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.on('pageerror', (e) => logs.push(`pageerror(${as || 1}): ${e.message.slice(0, 200)}`));
  await page.goto(`${V4}${as ? `?as=${as}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  return { ctx, page };
}
// 2026-10-07: 교사 유형 구역은 환경설정에서 시간표 창으로 옮겼다 (이름은 그대로 둔다)
async function openSettings(page) {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /^⏰\s*시간표/ }).click();
  const box = page.locator('[data-teaching-mode-setting]');
  await box.waitFor({ timeout: 10000 });
  return box;
}
const checked = (box, p) => box.locator(`[data-teacher-preset="${p}"]`).getAttribute('aria-checked');

try {
  // ── teacher3: 교과 전담 ───────────────────────────────────────
  await t3.read().then((d) => d || setDoc(t3.ref, { ...SUBJECT_MODE, updatedAt: Date.now() }));
  {
    const { ctx, page } = await open(3);
    check('teacher3: 처음 안내 띠가 없다 (문서가 있다)', (await page.locator('[data-teacher-mode-banner]').count()) === 0);
    const box = await openSettings(page);
    await box.locator('[data-teacher-preset="subject"][aria-checked="true"]').waitFor({ timeout: 10000 }).catch(() => {});
    check("teacher3: 시간표 창에 '교과 전담'이 골라져 있다", (await checked(box, 'subject')) === 'true');
    check("teacher3: 과목 칩 '과학', 담임반 칸은 없다",
      (await box.locator('[data-teaching-subject="과학"]').count()) === 1 && (await box.locator('[data-teaching-homeroom]').count()) === 0);

    await box.locator('[data-teacher-preset="subjectHomeroom"]').click();
    const [m1, ms1] = await serverUntil(t3.read, (d) => d?.unit === 'class' && d?.hasHomeroom === true);
    check("teacher3: '교과 + 담임' → 서버 unit:'class', hasHomeroom:true", m1?.unit === 'class' && m1?.hasHomeroom === true, `${ms1}ms`);

    const homeroom = box.locator('[data-teaching-homeroom]');
    await homeroom.waitFor({ timeout: 5000 }).catch(() => {});
    const opts = await homeroom.locator('[data-homeroom-class]:not([data-homeroom-class=""])').allInnerTexts();
    check('teacher3: 담임반 고르기에 올해 명렬표의 네 반', opts.join(',') === '5-1,5-2,5-3,5-4', opts.join(','));
    await homeroom.locator('[data-homeroom-class="5-2"]').click();
    const [m2, ms2] = await serverUntil(t3.read, (d) => d?.homeroomClass === '5-2');
    check("teacher3: 담임반 5-2 → 서버 homeroomClass:'5-2' (과목은 그대로)",
      m2?.homeroomClass === '5-2' && (m2?.subjects || []).join(',') === '과학', `${ms2}ms`);

    const input = box.getByRole('textbox', { name: '가르치는 과목 더하기' });
    await input.fill('영어, 수학');
    await input.press('Enter');
    const [m3] = await serverUntil(t3.read, (d) => (d?.subjects || []).join(',') === '과학,영어,수학');
    await box.getByRole('button', { name: '영어 빼기' }).click();
    const [m4] = await serverUntil(t3.read, (d) => (d?.subjects || []).join(',') === '과학,수학');
    check('teacher3: 과목 더하기(쉼표 두 개)·빼기가 서버에', (m3?.subjects || []).join(',') === '과학,영어,수학' && (m4?.subjects || []).join(',') === '과학,수학',
      `${(m3?.subjects || []).join(',')} → ${(m4?.subjects || []).join(',')}`);
    await ctx.close();
  }

  // ── teacher2: 문서가 없으면 처음 안내 띠 ──────────────────────
  await deleteDoc(t2.ref);
  {
    const { ctx, page } = await open(2);
    const banner = page.locator('[data-teacher-mode-banner]');
    await banner.waitFor({ timeout: 10000 }).catch(() => {});
    check('teacher2: 문서가 없으면 하루 화면에 처음 안내 띠', (await banner.count()) === 1);
    await banner.getByRole('button', { name: '나중에' }).click();
    const [m, ms] = await serverUntil(t2.read, (d) => !!d);
    check("teacher2: '나중에' → 초등 담임 문서가 생긴다", m?.unit === 'subject' && m?.hasHomeroom === true, `${ms}ms`);
    await banner.waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    check('teacher2: 띠가 사라진다', (await banner.count()) === 0);
    await ctx.close();
  }

  // ── teacher(기본): 지금과 같다 ────────────────────────────────
  {
    const { ctx, page } = await open();
    await page.waitForTimeout(1500);
    check('teacher: 처음 안내 띠가 없다', (await page.locator('[data-teacher-mode-banner]').count()) === 0);
    const box = await openSettings(page);
    await box.locator('[data-teacher-preset="homeroom"][aria-checked="true"]').waitFor({ timeout: 10000 }).catch(() => {});
    check("teacher: 시간표 창은 '초등 담임', 과목 칸은 없다",
      (await checked(box, 'homeroom')) === 'true' && (await box.locator('[data-teaching-subjects]').count()) === 0);
    await ctx.close();
  }
} catch (e) {
  check('점검 도중 오류', false, String(e?.message || e).slice(0, 300));
} finally {
  // 되돌리기 (seed 값)
  await setDoc(t3.ref, { ...SUBJECT_MODE, updatedAt: Date.now() });
  await setDoc(t2.ref, { ...HOMEROOM_MODE, updatedAt: Date.now() });
  await setDoc(t1.ref, { ...HOMEROOM_MODE, updatedAt: Date.now() });
  await browser.close();
}

if (logs.length) console.log(logs.join('\n'));
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
