// tools/inspect-auto-backup.mjs
//
// 드라이브 자동 백업(docs/ROADMAP.md 3-3)의 화면을 실제 크롬으로 본다. 에뮬레이터에는 구글 토큰이 없어
// 드라이브 실제 업로드는 못 본다(사용자가 실제 사이트의 환경설정 '지금 백업'으로 확인). 여기서 보는 것:
// - 마지막 백업을 20일 전으로 심으면 PC 화면 위에 띠가 뜬다 (7일마다 + 3일 넘게 밀림 → '13일 밀렸습니다')
// - 토큰이 없으니 자동 백업은 조용히 넘어가고 마지막 백업 시각은 그대로다 (권한 창도 뜨지 않는다)
// - '나중에'를 누르면 띠가 내려가고, 새로 고쳐도 다시 뜨지 않는다 (이 기기에서 하루)
// - 환경설정 '드라이브 자동 백업': 마지막 백업 표시, 끄기/켜기·주기·개수가 Firestore에 저장되고
//   끄면 띠가 내려가고, 주기를 바꾸면 띠의 밀린 날 수가 바로 바뀐다
// 끝나면 마지막 백업을 지금으로 되돌린다 (seed와 같게 - 다른 점검 화면에 띠가 뜨지 않게).
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-auto-backup.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, getDocFromServer, setDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'auto-backup');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const ref = doc(db, 'users', user.uid, 'settings', 'v4_autoBackup');
const saved = async () => (await getDocFromServer(ref)).data() || {};

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const DAY = 86_400_000;
const lastAt = Date.now() - 20 * DAY;
await setDoc(ref, {
  enabled: true,
  intervalDays: 7,
  keep: 8,
  lastAt,
  lastName: 'SP4_자동백업_점검.json',
  lastSummary: '점검',
  folderLink: 'https://drive.google.com/drive/folders/inspect',
});

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const open = async () => {
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const popups = [];
  page.on('popup', (p) => popups.push(p.url()));
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  return { ctx, page, popups };
};
const banner = (page) => page.locator('[data-auto-backup-banner]');

try {
  // ── 띠와 '나중에' ───────────────────────────────────────────
  const a = await open();
  await banner(a.page).waitFor({ timeout: 10000 }).catch(() => {});
  const text = (await banner(a.page).count()) ? await banner(a.page).innerText() : '';
  check('20일 전 백업이면 화면 위에 띠', /13일 밀렸습니다/.test(text), text.split('\n')[0]);
  await a.page.screenshot({ path: 'tools/report/auto-backup-banner.png' });
  await a.page.waitForTimeout(2500);
  check('토큰이 없으면 백업하지 않는다 (마지막 백업 그대로)', (await saved()).lastAt === lastAt);
  check('권한 창을 띄우지 않는다', a.popups.length === 0, a.popups.join(' '));

  await banner(a.page).getByRole('button', { name: '나중에' }).click();
  await a.page.waitForTimeout(500);
  check("'나중에'를 누르면 띠가 내려간다", (await banner(a.page).count()) === 0);
  await a.page.reload({ waitUntil: 'domcontentloaded' });
  await a.page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await a.page.waitForTimeout(3000);
  check('새로 고쳐도 하루 동안 다시 뜨지 않는다', (await banner(a.page).count()) === 0);
  await a.ctx.close();

  // ── 환경설정 ───────────────────────────────────────────────
  const b = await open();
  const page = b.page;
  await banner(page).waitFor({ timeout: 10000 });
  check("'나중에'는 그 기기에서만 (다른 브라우저에는 뜬다)", (await banner(page).count()) === 1);
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  const box = page.locator('[data-auto-backup-settings]');
  await box.waitFor({ timeout: 10000 });
  await box.scrollIntoViewIfNeeded();
  const last = await box.locator('[data-last-backup]').innerText();
  check('마지막 백업 시각·파일 이름', /SP4_자동백업_점검\.json/.test(last) && /점검/.test(last), last);
  check("'드라이브에서 열기' 링크", (await box.getByRole('link', { name: '드라이브에서 열기' }).count()) === 1);
  check("'지금 백업' 단추", (await box.getByRole('button', { name: '지금 백업' }).count()) === 1);
  const pressed = async (name) => (await box.getByRole('button', { name, exact: true }).getAttribute('aria-pressed')) === 'true';
  check('처음 값: 켜기 · 7일마다 · 8개', (await pressed('켜기')) && (await pressed('7일마다')) && (await pressed('8개 남기기')));

  await box.getByRole('button', { name: '끄기', exact: true }).click();
  await page.waitForTimeout(1000);
  check("'끄기'가 계정에 저장된다", (await saved()).enabled === false);
  check('끄면 주기·개수는 고를 수 없다', await box.getByRole('button', { name: '14일마다' }).isDisabled());
  check('끄면 띠가 내려간다', (await banner(page).count()) === 0);

  await box.getByRole('button', { name: '켜기', exact: true }).click();
  await page.waitForTimeout(1000);
  check("'켜기'가 계정에 저장된다", (await saved()).enabled === true);
  check('켜면 띠가 다시 뜬다', (await banner(page).count()) === 1);

  await box.getByRole('button', { name: '14일마다' }).click();
  await page.waitForTimeout(1000);
  check('14일마다가 저장된다', (await saved()).intervalDays === 14);
  const text14 = (await banner(page).count()) ? await banner(page).innerText() : '';
  check('주기를 바꾸면 밀린 날 수도 바뀐다 (20-14 = 6일)', /6일 밀렸습니다/.test(text14), text14.split('\n')[0]);
  await box.getByRole('button', { name: '12개 남기기' }).click();
  await page.waitForTimeout(1000);
  const s = await saved();
  check('12개 남기기가 저장되고 마지막 백업은 그대로', s.keep === 12 && s.lastAt === lastAt, JSON.stringify({ keep: s.keep, lastAt: s.lastAt === lastAt }));
  await page.screenshot({ path: 'tools/report/auto-backup-settings.png' });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /환경설정/ }).first().click();
  await box.waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check('새로 고친 뒤에도 14일마다 · 12개', (await pressed('14일마다')) && (await pressed('12개 남기기')));
  check('권한 창은 끝까지 뜨지 않았다', b.popups.length === 0, b.popups.join(' '));
  await b.ctx.close();
} finally {
  await browser.close();
  // seed와 같게: 방금 백업한 것으로, 설정은 처음 값
  await setDoc(ref, { lastAt: Date.now() });
}

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
