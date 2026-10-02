// tools/inspect-teaching-mode.mjs
//
// 교사 유형 (docs/ROADMAP-SUBJECT.md S1)을 실제 크롬으로 본다.
// - teacher3(교과 전담, ?as=3): 환경설정에 '교과 전담'이 골라져 있고 과목 칩 '과학', 처음 안내 띠는 없다
//   → 과목 더하기 → '교과 + 담임' → 서버 문서 unit 'class' · hasHomeroom true → 담임반 '5-2' → homeroomClass '5-2'
// - teacher2(?as=2): v4_teaching 문서를 지우고 열면 하루 화면에 처음 안내 띠 → '나중에' → 초등 담임 문서가 생기고 띠가 사라진다
// - teacher(기본): 띠가 없고 환경설정은 초등 담임
// 끝나면 두 계정의 문서를 seed 값으로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-teaching-mode.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, setDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'teaching-mode');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

// seed와 같은 값
const HOMEROOM = { unit: 'subject', hasHomeroom: true, homeroomClass: '', subjects: [], classColors: {} };
const SUBJECT = { unit: 'class', hasHomeroom: false, homeroomClass: '', subjects: ['과학'], classColors: {} };

/** 그 계정으로 들어가 v4_teaching 문서를 다룬다 (규칙상 제 문서만 읽고 쓴다) */
const as = async (email) => {
  const { user } = await signInWithEmailAndPassword(auth, email, 'test1234');
  return doc(db, 'users', user.uid, 'settings', 'v4_teaching');
};
const read = async (email) => {
  const snap = await getDocFromServer(await as(email));
  return snap.exists() ? snap.data() : null;
};
/** 화면이 로컬 쓰기를 먼저 보여 주므로 서버는 기다려 읽는다 */
const serverUntil = async (email, ok, ms = 8000) => {
  const until = Date.now() + ms;
  let d = null;
  while (Date.now() < until) {
    d = await read(email);
    if (ok(d)) return d;
    await new Promise((r) => setTimeout(r, 300));
  }
  return d;
};

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const open = async (who) => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  await page.goto(`${V4}${who ? `?as=${who}` : ''}`, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  // 보던 화면이 기억되어 있을 수 있다 - 하루 화면에서 시작
  await page.getByRole('button', { name: '하루', exact: true }).first().click().catch(() => {});
  return { ctx, page };
};
const openSettings = async (page) => {
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  const box = page.locator('[data-teaching-mode]');
  await box.waitFor({ timeout: 10000 });
  await box.scrollIntoViewIfNeeded();
  return box;
};
const checked = async (box) =>
  box.locator('[data-teacher-preset][aria-checked="true"]').getAttribute('data-teacher-preset').catch(() => null);
const banner = (page) => page.locator('[data-teacher-mode-banner]');

try {
  await setDoc(await as('teacher3@example.com'), SUBJECT);
  await setDoc(await as('teacher@example.com'), HOMEROOM);

  // ── teacher3: 교과 전담 ────────────────────────────────────
  {
    const { ctx, page } = await open('3');
    await page.waitForTimeout(1500);
    check('teacher3: 처음 안내 띠가 없다', (await banner(page).count()) === 0);
    const box = await openSettings(page);
    await box.locator('[data-teacher-preset="subject"][aria-checked="true"]').waitFor({ timeout: 8000 }).catch(() => {});
    check("teacher3: '교과 전담'이 골라져 있다", (await checked(box)) === 'subject', String(await checked(box)));
    check("teacher3: 과목 칩 '과학'", (await box.locator('[data-teaching-subject="과학"]').count()) === 1);
    check('teacher3: 교과 전담에는 담임반 고르기가 없다', (await box.locator('[data-teaching-homeroom]').count()) === 0);

    await box.locator('[data-teaching-subject-input]').fill('수학');
    await box.locator('[data-teaching-subject-input]').press('Enter');
    const s1 = await serverUntil('teacher3@example.com', (d) => d?.subjects?.length === 2);
    check('과목을 Enter로 더하면 계정에 저장된다', JSON.stringify(s1?.subjects) === '["과학","수학"]', JSON.stringify(s1?.subjects));
    await box.getByRole('button', { name: '수학 빼기' }).click();
    const s2 = await serverUntil('teacher3@example.com', (d) => d?.subjects?.length === 1);
    check('✕로 빼면 계정에서도 빠진다', JSON.stringify(s2?.subjects) === '["과학"]', JSON.stringify(s2?.subjects));

    await box.locator('[data-teacher-preset="subjectHomeroom"]').click();
    const s3 = await serverUntil('teacher3@example.com', (d) => d?.hasHomeroom === true);
    check("'교과 + 담임' → unit 'class' · hasHomeroom true", s3?.unit === 'class' && s3?.hasHomeroom === true, JSON.stringify({ unit: s3?.unit, hasHomeroom: s3?.hasHomeroom }));
    const homeroom = box.locator('[data-teaching-homeroom]');
    await homeroom.waitFor({ timeout: 5000 }).catch(() => {});
    const classes = await homeroom.locator('[data-homeroom-class]').evaluateAll((els) => els.map((e) => e.getAttribute('data-homeroom-class')));
    check('담임반 후보 = 그 학년도 명렬표의 학년-반', JSON.stringify(classes) === '["","5-1","5-2","5-3","5-4"]', JSON.stringify(classes));
    await homeroom.locator('[data-homeroom-class="5-2"]').click();
    const s4 = await serverUntil('teacher3@example.com', (d) => d?.homeroomClass === '5-2');
    check("담임반 '5-2' → homeroomClass '5-2'", s4?.homeroomClass === '5-2', String(s4?.homeroomClass));
    await page.screenshot({ path: 'tools/report/teaching-mode-settings.png' });

    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    const box2 = await openSettings(page);
    await box2.locator('[data-homeroom-class="5-2"][aria-pressed="true"]').waitFor({ timeout: 8000 }).catch(() => {});
    check(
      '새로 고친 뒤에도 교과 + 담임 · 5-2',
      (await checked(box2)) === 'subjectHomeroom' && (await box2.locator('[data-homeroom-class="5-2"]').getAttribute('aria-pressed')) === 'true'
    );
    await ctx.close();
  }

  // ── teacher2: 문서가 없으면 처음 안내 띠 ───────────────────────
  {
    await deleteDoc(await as('teacher2@example.com'));
    const { ctx, page } = await open('2');
    await banner(page).waitFor({ timeout: 10000 }).catch(() => {});
    check('teacher2: 문서가 없으면 하루 화면 맨 위에 처음 안내 띠', (await banner(page).count()) === 1);
    await page.screenshot({ path: 'tools/report/teaching-mode-banner.png' });
    await banner(page).locator('[data-teacher-mode-later]').click();
    const d = await serverUntil('teacher2@example.com', (x) => !!x);
    check("'나중에' → 초등 담임 문서가 생긴다", d?.unit === 'subject' && d?.hasHomeroom === true, JSON.stringify(d && { unit: d.unit, hasHomeroom: d.hasHomeroom }));
    await banner(page).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    check("'나중에' 뒤 띠가 사라진다", (await banner(page).count()) === 0);
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.waitForTimeout(2000);
    check('새로 고쳐도 띠가 다시 뜨지 않는다', (await banner(page).count()) === 0);
    await ctx.close();
  }

  // ── teacher(기본): 지금과 같다 ───────────────────────────────
  {
    const { ctx, page } = await open('');
    await page.waitForTimeout(2000);
    check('teacher: 띠가 없다', (await banner(page).count()) === 0);
    const box = await openSettings(page);
    await page.waitForTimeout(500);
    check("teacher: 환경설정은 '초등 담임', 과목 칸 없음", (await checked(box)) === 'homeroom' && (await box.locator('[data-teaching-subjects]').count()) === 0);
    await ctx.close();
  }
} finally {
  await browser.close();
  // seed 값으로 되돌린다
  await setDoc(await as('teacher3@example.com'), SUBJECT);
  await setDoc(await as('teacher2@example.com'), HOMEROOM);
  await setDoc(await as('teacher@example.com'), HOMEROOM);
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
