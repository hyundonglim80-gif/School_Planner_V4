// tools/inspect-teaching-mode.mjs
//
// 교사 유형 설정(docs/ROADMAP-SUBJECT.md S1)을 실제 크롬으로 확인한다.
//   - teacher3(교과 전담, ?as=3): 환경설정에 '교과 전담'이 골라져 있고 과목 칩 '과학', 처음 안내 띠가 없다
//   - teacher3: '교과 + 담임' → 서버 unit:'class', hasHomeroom:true → 담임반 '5-2' → 과목 더하기·빼기
//   - teacher2: 교사 유형 문서를 지우고 열면 처음 안내 띠 → '나중에' → 초등 담임 문서가 생기고 띠가 사라진다
//   - teacher(기본): 띠가 없고 초등 담임, 과목 칸이 없다
// 바꾼 문서는 끝에 처음 값으로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-teaching-mode.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

// 계정마다 앱을 따로 둔다 (한 앱에는 로그인이 하나뿐)
async function account(email, n) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, `inspect-teaching-${n}`);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  const { user } = await signInWithEmailAndPassword(auth, email, 'test1234');
  const ref = doc(db, 'users', user.uid, 'settings', 'v4_teaching');
  return { ref, read: async () => (await getDocFromServer(ref)).data() || null };
}
const t1 = await account('teacher@example.com', 1);
const t2 = await account('teacher2@example.com', 2);
const t3 = await account('teacher3@example.com', 3);
const before = { t1: await t1.read(), t2: await t2.read(), t3: await t3.read() };

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
// 서버에 그 값이 닿을 때까지 기다려 읽는다 (화면은 로컬 쓰기를 먼저 보여 준다)
async function serverUntil(acc, pred, ms = 8000) {
  const end = Date.now() + ms;
  let data = null;
  while (Date.now() < end) {
    data = await acc.read();
    if (data && pred(data)) return data;
    await new Promise((r) => setTimeout(r, 300));
  }
  return data;
}

async function restore() {
  for (const [key, acc] of [['t1', t1], ['t2', t2], ['t3', t3]]) {
    if (before[key]) await setDoc(acc.ref, before[key]);
    else await deleteDoc(acc.ref);
  }
}

const run = async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const logs = [];
  const open = async (as) => {
    const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
    const page = await ctx.newPage();
    page.on('pageerror', (e) => logs.push(`pageerror(${as || 1}): ${e.message.slice(0, 200)}`));
    await page.goto(`${V4}${as ? `?as=${as}` : ''}`, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
    return { ctx, page };
  };
  const openSettings = async (page) => {
    await page.getByTitle('더보기 메뉴').click();
    await page.locator('[data-menu-section]').getByRole('button', { name: '환경설정' }).click();
    await page.locator('[data-teaching-mode]').waitFor({ timeout: 8000 });
    await page.locator('[data-teacher-preset][aria-checked=true]').waitFor({ timeout: 8000 });
  };
  const checked = (page) => page.locator('[data-teacher-preset][aria-checked=true]').getAttribute('data-teacher-preset');
  const banner = (page) => page.locator('[data-teacher-mode-banner]');

  // ── 1. teacher3 (교과 전담) ──
  {
    const { ctx, page } = await open(3);
    await page.waitForTimeout(1500);
    check('teacher3: 처음 안내 띠가 없다', (await banner(page).count()) === 0);
    await openSettings(page);
    check("teacher3: '교과 전담'이 골라져 있다", (await checked(page)) === 'subject', await checked(page));
    check("teacher3: 과목 칩 '과학'", await page.locator('[data-teaching-subject="과학"]').isVisible());
    check('teacher3: 교과 전담에는 담임반 칸이 없다', (await page.locator('[data-homeroom-class]').count()) === 0);

    await page.locator('[data-teacher-preset=subjectHomeroom]').click();
    const d1 = await serverUntil(t3, (d) => d.hasHomeroom === true);
    check("'교과 + 담임' → 서버 unit:'class', hasHomeroom:true", d1?.unit === 'class' && d1?.hasHomeroom === true, JSON.stringify(d1));
    const sel = page.locator('[data-homeroom-class]');
    await sel.waitFor({ timeout: 5000 });
    const opts = await sel.locator('option').allInnerTexts();
    check('담임반 목록 = 그 학년도 명렬표 5-1~5-4', JSON.stringify(opts) === JSON.stringify(['고르지 않음', '5-1', '5-2', '5-3', '5-4']), opts.join(','));
    await sel.selectOption('5-2');
    const d2 = await serverUntil(t3, (d) => d.homeroomClass === '5-2');
    check("담임반 '5-2' → 서버 homeroomClass:'5-2'", d2?.homeroomClass === '5-2');

    await page.locator('[data-teaching-subject-input]').fill('실과, 체육');
    await page.locator('[data-teaching-subject-input]').press('Enter');
    const d3 = await serverUntil(t3, (d) => (d.subjects || []).includes('체육'));
    check('과목 더하기(쉼표) → 서버 과학·실과·체육', JSON.stringify(d3?.subjects) === JSON.stringify(['과학', '실과', '체육']), JSON.stringify(d3?.subjects));
    await page.getByRole('button', { name: '실과 빼기' }).click();
    const d4 = await serverUntil(t3, (d) => !(d.subjects || []).includes('실과'));
    check('✕로 빼기 → 서버에서 빠진다', JSON.stringify(d4?.subjects) === JSON.stringify(['과학', '체육']), JSON.stringify(d4?.subjects));
    await page.screenshot({ path: 'tools/report/teaching-mode-settings.png' });
    await ctx.close();
  }

  // ── 2. teacher2: 문서가 없으면 처음 안내 띠 ──
  {
    await deleteDoc(t2.ref);
    const { ctx, page } = await open(2);
    await banner(page).waitFor({ timeout: 10000 }).catch(() => {});
    check('teacher2(문서 없음): 처음 안내 띠가 뜬다', await banner(page).isVisible());
    await page.screenshot({ path: 'tools/report/teaching-mode-banner.png' });
    await page.locator('[data-teacher-mode-banner-later]').click();
    const d = await serverUntil(t2, () => true);
    check("'나중에' → 초등 담임 문서가 생긴다", d?.unit === 'subject' && d?.hasHomeroom === true, JSON.stringify(d));
    await banner(page).waitFor({ state: 'detached', timeout: 5000 }).catch(() => {});
    check("'나중에' 뒤 띠가 사라진다", (await banner(page).count()) === 0);
    await ctx.close();
  }

  // ── 3. teacher(기본): 지금과 같다 ──
  {
    const { ctx, page } = await open(null);
    await page.waitForTimeout(1500);
    check('teacher: 처음 안내 띠가 없다', (await banner(page).count()) === 0);
    await openSettings(page);
    check("teacher: '초등 담임'이 골라져 있다", (await checked(page)) === 'homeroom');
    check('teacher: 초등 담임에는 과목 칸이 없다', (await page.locator('[data-teaching-subject-input]').count()) === 0);
    await ctx.close();
  }

  await browser.close();
  if (logs.length) console.log(logs.join('\n'));
  check('페이지 오류 없음', logs.length === 0);
};

try {
  await run();
} finally {
  await restore();
}
const bad = results.filter((r) => !r.ok);
console.log(`\n${results.length - bad.length}/${results.length} 통과`);
process.exit(bad.length ? 1 : 0);
