// tools/inspect-print.mjs
//
// 인쇄(docs/ROADMAP.md 12)를 실제 크롬으로 확인한다. 인쇄 창은 열지 않는다 - window.print를 바꿔 끼우고,
// 찍을 준비(#sp4-print-root·@page)를 본 뒤 인쇄 모양(media print)으로 PDF를 만들어 tools/report에 둔다.
//   - 12-1 주간: 🖨️ 인쇄 → A4 가로, 이번 주 칸만, 요일마다 한 열, 제목 / 인쇄가 끝나면(afterprint) 치운다
//   - 12-2 주간학습안내: 다음 주 표(과목·메모·준비물·알림장), 넣을 것 체크, 제목·알리는 말(이 기기), 주 넘기기, 표 복사, A4 세로 인쇄,
//     주간 화면 단추는 보고 있는 주로. 다음 주 월·화 수업·알림장 문서를 심었다가 처음 모습으로 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-print.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, deleteDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-print');
const db = getFirestore(fbApp);
const auth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const t0 = new Date();
t0.setHours(0, 0, 0, 0);
const thisMon = new Date(t0);
thisMon.setDate(t0.getDate() - ((t0.getDay() + 6) % 7));
const day = (base, n) => {
  const d = new Date(base);
  d.setDate(base.getDate() + n);
  return d;
};
const NEXT_MON = ymd(day(thisMon, 7));
const NEXT_TUE = ymd(day(thisMon, 8));
const rangeOf = (mon) => `${mon.getMonth() + 1}.${mon.getDate()} ~ ${day(mon, 4).getMonth() + 1}.${day(mon, 4).getDate()}`;
const schedRef = (d) => doc(db, 'users', uid, 'schedules', d);
const noticeRef = (d) => doc(db, 'users', uid, 'notices', d);
const originals = new Map();
async function seedGuide() {
  for (const ref of [schedRef(NEXT_MON), schedRef(NEXT_TUE), noticeRef(NEXT_MON)]) originals.set(ref.path, (await getDocFromServer(ref)).data() || null);
  await setDoc(schedRef(NEXT_MON), {
    periods: { 1: { subject: '점검국어', memo: '시 낭송', supplies: '공책, 색연필' }, 3: { subject: '점검미술', supplies: '색연필·풀' } },
    updatedAt: Date.now(),
  });
  await setDoc(schedRef(NEXT_TUE), { periods: { 2: '점검수학' }, updatedAt: Date.now() });
  await setDoc(noticeRef(NEXT_MON), { date: NEXT_MON, lines: ['점검 우유 급식', '체육복'], updatedAt: Date.now() });
}
async function restoreGuide() {
  for (const ref of [schedRef(NEXT_MON), schedRef(NEXT_TUE), noticeRef(NEXT_MON)]) {
    const orig = originals.get(ref.path);
    if (orig) await setDoc(ref, orig);
    else await deleteDoc(ref).catch(() => {});
  }
}
await seedGuide();

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
const page = await ctx.newPage();
const logs = [];
page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
// 인쇄 창 대신 센다
await ctx.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: BASE });
await ctx.addInitScript(() => {
  window.__printed = 0;
  window.print = () => {
    window.__printed += 1;
  };
});

const root = () => page.locator('#sp4-print-root');
const pageRule = () => page.evaluate(() => document.getElementById('sp4-print-root-page')?.textContent || '');
const afterPrint = () => page.evaluate(() => window.dispatchEvent(new Event('afterprint')));

try {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });

  // ── 12-1 주간 ──
  await page.getByRole('button', { name: '주간', exact: true }).first().click();
  await page.locator('[data-week-grid]').first().waitFor({ timeout: 15000 });
  await page.locator('[data-week-print]').click();
  check('🖨️ 인쇄 → 인쇄 창을 연다', (await page.evaluate(() => window.__printed)) === 1);
  check('찍을 것을 준비 (#sp4-print-root)', (await root().count()) === 1);
  check('A4 가로', /size:\s*A4 landscape/.test(await pageRule()), await pageRule());
  check('제목에 주간 날짜', /년 \d+\.\d+ ~ \d+\.\d+ 주간/.test(await root().locator('.sp4-print-title').innerText()), await root().locator('.sp4-print-title').innerText());
  check('이번 주 칸 하나만 (다음 주 칸은 빼고)', (await root().locator('[data-week-grid]').count()) === 1);
  check('화면에서는 보이지 않는다', !(await root().isVisible()));
  await page.emulateMedia({ media: 'print' });
  const cols = await root().locator('[data-week-grid]').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  const days = await root().locator('[data-week-grid]').evaluate((el) => Number(getComputedStyle(el).getPropertyValue('--week-cols')) || 0);
  check('인쇄 모양: 요일마다 한 열', cols === days && cols >= 5, `${cols}열 / 요일 ${days}`);
  check('인쇄 모양: 앱 화면은 숨는다', !(await page.locator('#root').isVisible()));
  // 눈으로 볼 그림 - A4 가로 인쇄 폭(약 1060px)에서 인쇄 모양 (pdf()는 인쇄 흉내를 되돌리므로 먼저)
  await page.setViewportSize({ width: 1060, height: 750 });
  await page.screenshot({ path: 'tools/report/print-week.png', fullPage: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.pdf({ path: 'tools/report/print-week.pdf', preferCSSPageSize: true, printBackground: true });
  await page.emulateMedia({ media: 'screen' });
  await afterPrint();
  check('인쇄가 끝나면 치운다', (await root().count()) === 0 && (await page.evaluate(() => document.body.hasAttribute('data-printing'))) === false);

  // ── 12-2 주간학습안내 ──
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByTitle('더보기 메뉴').click();
  await page.locator('[data-menu-section]').getByRole('button', { name: /주간학습안내/ }).click();
  const guide = page.getByRole('dialog').filter({ hasText: '📰 주간학습안내' });
  const preview = guide.locator('[data-weekly-guide]');
  await guide.locator('[data-guide-table]').waitFor({ timeout: 10000 });
  check('⋮ 메뉴 → 다음 주로 열린다', (await guide.locator('[data-guide-range]').innerText()) === rangeOf(day(thisMon, 7)), await guide.locator('[data-guide-range]').innerText());
  const cell = (row, col) => preview.locator(`[data-guide-cell="${row}:${col}"]`);
  await cell('1교시', 1).filter({ hasText: '점검국어' }).waitFor({ timeout: 8000 }).catch(() => {});
  check('월 1교시: 과목 + 수업 메모', (await cell('1교시', 1).innerText()).includes('점검국어') && (await cell('1교시', 1).innerText()).includes('시 낭송'), await cell('1교시', 1).innerText());
  check('화 2교시: 과목 글자만 적힌 옛 모양도', (await cell('2교시', 2).innerText()) === '점검수학');
  check('월 준비물: 모아서 겹친 것 하나로', (await cell('준비물', 1).innerText()) === '공책, 색연필, 풀', await cell('준비물', 1).innerText());
  check('월 알림장 줄', (await cell('알림장', 1).innerText()).includes('1. 점검 우유 급식') && (await cell('알림장', 1).innerText()).includes('2. 체육복'));
  await guide.getByRole('checkbox', { name: '수업 메모' }).uncheck();
  await guide.getByRole('checkbox', { name: '알림장' }).uncheck();
  check('수업 메모·알림장을 빼면 빠진다', !(await cell('1교시', 1).innerText()).includes('시 낭송') && (await preview.locator('[data-guide-row="알림장"]').count()) === 0);
  await guide.getByRole('checkbox', { name: '수업 메모' }).check();
  await guide.getByRole('checkbox', { name: '알림장' }).check();
  await guide.getByLabel('제목').fill('점검 4-3 안내');
  await guide.getByLabel('알리는 말').fill('점검 수요일은 체험학습');
  check('제목·알리는 말이 표 위에', (await preview.locator('h2').innerText()).startsWith('점검 4-3 안내 (') && (await preview.locator('[data-guide-note]').innerText()) === '점검 수요일은 체험학습');
  await guide.getByTitle('앞 주').click();
  await page.waitForTimeout(300);
  check('◀ → 앞 주, 그 주의 알리는 말은 따로', (await guide.locator('[data-guide-range]').innerText()) === rangeOf(thisMon) && (await guide.getByLabel('알리는 말').inputValue()) === '');
  await guide.getByRole('button', { name: '다음 주', exact: true }).click();
  await cell('1교시', 1).filter({ hasText: '점검국어' }).waitFor({ timeout: 8000 }).catch(() => {});
  check('다음 주로 돌아오면 알리는 말이 남아 있다 (이 기기)', (await guide.getByLabel('알리는 말').inputValue()) === '점검 수요일은 체험학습');
  // 표 복사
  await guide.getByRole('button', { name: '📋 표 복사' }).click();
  await page.waitForTimeout(300);
  const tsv = await page.evaluate(() => navigator.clipboard.readText());
  check('표 복사 (탭 글: 요일 머리·과목)', tsv.split(/\r?\n/)[0].includes('(월)') && tsv.includes('점검국어') && tsv.includes('\t'), tsv.slice(0, 80).replace(/\r?\n/g, ' / '));
  // 인쇄 (A4 세로)
  const before = await page.evaluate(() => window.__printed);
  await guide.getByRole('button', { name: '🖨️ 인쇄' }).click();
  check('🖨️ 인쇄 → A4 세로로 표만', (await page.evaluate(() => window.__printed)) === before + 1 && /size:\s*A4 portrait/.test(await pageRule()) &&
    (await root().locator('[data-guide-table]').count()) === 1);
  await page.emulateMedia({ media: 'print' });
  await page.setViewportSize({ width: 720, height: 1000 });
  await page.screenshot({ path: 'tools/report/print-guide.png', fullPage: true });
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.emulateMedia({ media: 'screen' });
  await afterPrint();
  await guide.getByRole('button', { name: '닫기' }).last().click();
  await page.waitForTimeout(300);
  // 다시 열면 제목이 남아 있다
  await page.getByTitle('더보기 메뉴').click();
  await page.locator('[data-menu-section]').getByRole('button', { name: /주간학습안내/ }).click();
  await guide.locator('[data-guide-table]').waitFor({ timeout: 10000 });
  check('다시 열면 제목이 남아 있다 (이 기기)', (await guide.getByLabel('제목').inputValue()) === '점검 4-3 안내');
  await guide.getByLabel('제목').fill('주간학습안내');
  await guide.getByLabel('알리는 말').fill('');
  await guide.getByRole('button', { name: '닫기' }).last().click();
  await page.waitForTimeout(300);
  // 주간 화면 단추는 보고 있는 주로
  await page.getByRole('button', { name: '주간', exact: true }).first().click();
  await page.locator('[data-week-guide]').click();
  await guide.locator('[data-guide-range]').waitFor({ timeout: 8000 });
  check('주간 화면 단추 → 보고 있는 주(이번 주)', (await guide.locator('[data-guide-range]').innerText()) === rangeOf(thisMon), await guide.locator('[data-guide-range]').innerText());
  await guide.getByRole('button', { name: '닫기' }).last().click();
} catch (e) {
  check('예상 못 한 오류', false, String(e).slice(0, 300));
  await page.screenshot({ path: 'tools/report/print-error.png' }).catch(() => {});
} finally {
  check('페이지 오류 없음', logs.length === 0, logs.join(' / '));
  await browser.close();
  await restoreGuide();
}

const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} 통과`);
process.exit(failed.length ? 1 : 0);
