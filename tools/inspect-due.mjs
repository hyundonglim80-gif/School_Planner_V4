// tools/inspect-due.mjs
//
// 일정 기한(docs/ROADMAP.md 11-2)을 실제 크롬으로 확인한다.
//   - 어제 이월 일정(기한 +3일) → 오늘 하루 화면을 열면 V4 이월이 옮기며 기한도 따라와 'D-3'
//   - V3가 옮긴 모양(사슬 id만, due 없음) + 사슬 기한 문서 → 'D-1' / 지난 기한 → '기한 1일 지남' / 끝낸 일정 → 표시 없음
//   - 새 일정 '…까지' 칩 → 기한 칸 → 저장하면 일정에 due·사슬 id, 사슬 기한 문서에도
//   - 고치는 칸에서 ✕로 떼면 due '' · 사슬 기한도 빠진다, 주간 화면에도 표시
// 점검 일정('점검기한'으로 시작)과 점검 사슬 기한은 끝에 지운다.
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-due.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer, deleteField } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-due');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const pad = (n) => String(n).padStart(2, '0');
const ymd = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const base = new Date();
base.setHours(0, 0, 0, 0);
const plus = (n) => {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
};
const TODAY = ymd(base);
const YESTERDAY = ymd(plus(-1));
const D5 = plus(5);

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
const dueRef = doc(db, 'users', uid, 'settings', 'v4_eventDue');
const serverEvents = async (date) => (await getDocFromServer(eventsRef(date))).data()?.eventList || [];
const serverDues = async () => (await getDocFromServer(dueRef)).data()?.dues || {};
const mine = (e) => String(e?.content || '').startsWith('점검기한');

async function writeEvents(date, mutate) {
  const snap = await getDocFromServer(eventsRef(date));
  const list = mutate((snap.data()?.eventList || []).filter((e) => !mine(e)));
  await setDoc(eventsRef(date), { eventList: list, eventText: list.map((e) => e.content).join('\n'), updatedAt: Date.now() }, { merge: true });
}

async function cleanup() {
  for (const date of [YESTERDAY, TODAY]) {
    const snap = await getDocFromServer(eventsRef(date));
    if (snap.exists() && (snap.data().eventList || []).some(mine)) await writeEvents(date, (l) => l);
  }
  const dues = await serverDues();
  const ours = Object.keys(dues).filter((k) => k.startsWith('chain_inspect') || k.startsWith('chain_'));
  // 점검이 만든 사슬만 - 남은 일정이 가리키지 않는 사슬 기한은 지운다
  const live = new Set();
  for (const date of [YESTERDAY, TODAY]) for (const e of await serverEvents(date)) if (e.forwardChainId) live.add(e.forwardChainId);
  const drop = ours.filter((k) => k.startsWith('chain_inspect') || !live.has(k));
  if (drop.length) await setDoc(dueRef, { dues: Object.fromEntries(drop.map((k) => [k, deleteField()])) }, { merge: true });
}

const ev = (id, content, extra = {}) => ({ id, content, text: content, completed: false, label: '', labelIds: [], linkedItems: [], attachments: [], createdAt: Date.now(), ...extra });

const run = async () => {
  await cleanup();
  // 어제: 이월할 일정(기한 +3일)
  await writeEvents(YESTERDAY, (l) => [...l, ev('ev_due_fw', '점검기한 이월 보고', { forward: true, due: ymd(plus(3)) })]);
  // 오늘: V3가 옮긴 모양(사슬 id만) · 지난 기한 · 끝낸 일정
  await writeEvents(TODAY, (l) => [
    ...l,
    ev('ev_due_v3', '점검기한 V3 이월', { forwardChainId: 'chain_inspect_v3', originalDate: YESTERDAY }),
    ev('ev_due_over', '점검기한 지남', { due: YESTERDAY }),
    ev('ev_due_done', '점검기한 끝냄', { due: ymd(plus(1)), completed: true }),
  ]);
  await setDoc(dueRef, { dues: { chain_inspect_v3: ymd(plus(1)) } }, { merge: true });

  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  const card = (text) => page.locator('[data-focus-key^="event"]', { hasText: text }).first();
  const badgeOf = async (text) => (await card(text).locator('[data-due-badge]').getAttribute('data-due-badge').catch(() => null));
  const panel = page.getByRole('complementary', { name: '일정 쓰기' });

  try {
    await page.goto(V4, { waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();

    // ── 1. 이월하며 기한이 따라온다 ──
    await card('점검기한 이월 보고').waitFor({ timeout: 15000 });
    const moved = await until(() => serverEvents(TODAY), (l) => l.some((e) => e.content === '점검기한 이월 보고'));
    const copy = moved.find((e) => e.content === '점검기한 이월 보고');
    check('V4 이월 사본에 기한이 따라온다', copy?.due === ymd(plus(3)), JSON.stringify({ due: copy?.due }));
    await card('점검기한 이월 보고').locator('[data-due-badge]').waitFor({ timeout: 5000 }).catch(() => {});
    check('오늘 하루 화면에 D-3', (await badgeOf('점검기한 이월 보고')) === 'D-3', String(await badgeOf('점검기한 이월 보고')));

    // ── 2. V3 모양·지남·끝냄 ──
    await card('점검기한 V3 이월').locator('[data-due-badge]').waitFor({ timeout: 6000 }).catch(() => {});
    check('V3가 옮긴 일정(사슬 id만)도 사슬 기한으로 D-1', (await badgeOf('점검기한 V3 이월')) === 'D-1', String(await badgeOf('점검기한 V3 이월')));
    check('지난 기한은 "기한 1일 지남"', (await badgeOf('점검기한 지남')) === '기한 1일 지남', String(await badgeOf('점검기한 지남')));
    check('끝낸 일정에는 표시가 없다', (await card('점검기한 끝냄').locator('[data-due-badge]').count()) === 0);
    await page.screenshot({ path: 'tools/report/due-day.png' });

    // ── 3. 새 일정 '…까지' 칩 → 저장 ──
    await page.getByRole('button', { name: '일정 추가' }).first().click();
    const box = panel.getByPlaceholder('새로운 일정을 입력하세요...');
    await box.waitFor({ timeout: 10000 });
    await box.fill(`점검기한 새 보고서 ${D5.getMonth() + 1}/${D5.getDate()}까지 제출`);
    await panel.locator('[data-quick-chip="due"]').waitFor({ timeout: 4000 });
    check('⏳ 기한 칩', (await panel.locator('[data-quick-chip="due"]').innerText()).includes('기한'));
    await panel.locator('[data-quick-chip="due"]').click();
    await page.waitForTimeout(250);
    check('칩 → 기한 칸, 그 말은 글에서 빠진다', (await panel.getByLabel('기한', { exact: true }).inputValue()) === ymd(D5) && (await box.inputValue()) === '점검기한 새 보고서 제출',
      `${await panel.getByLabel('기한', { exact: true }).inputValue()} / ${await box.inputValue()}`);
    check('칸에 D-5 미리 보기', (await panel.locator('[data-event-due] [data-due-badge]').getAttribute('data-due-badge')) === 'D-5');
    const forwardOn = await panel.getByRole('checkbox', { name: '이월' }).isChecked();
    check('이월이 꺼져 있을 때만 안내', (await panel.getByText('이월을 켜면 끝낼 때까지').count()) === (forwardOn ? 0 : 1), `이월 ${forwardOn}`);
    await box.press('Control+s');
    const savedList = await until(() => serverEvents(TODAY), (l) => l.some((e) => e.content === '점검기한 새 보고서 제출'));
    const saved = savedList.find((e) => e.content === '점검기한 새 보고서 제출');
    check('저장 → 일정에 due와 사슬 id', saved?.due === ymd(D5) && /^chain_/.test(saved?.forwardChainId || ''), JSON.stringify({ due: saved?.due, chain: saved?.forwardChainId }));
    const dues = await until(serverDues, (m) => !!saved?.forwardChainId && m[saved.forwardChainId] === ymd(D5));
    check('사슬 기한 문서에도', !!saved?.forwardChainId && dues[saved.forwardChainId] === ymd(D5));

    // ── 4. ✕로 떼기 ──
    await panel.getByRole('button', { name: '기한 빼기' }).click();
    await box.press('Control+s');
    const cleared = await until(() => serverEvents(TODAY), (l) => l.some((e) => e.content === '점검기한 새 보고서 제출' && e.due === ''));
    check('떼면 due는 빈 글자', cleared.some((e) => e.content === '점검기한 새 보고서 제출' && e.due === ''));
    const dues2 = await until(serverDues, (m) => !m[saved?.forwardChainId]);
    check('사슬 기한도 빠진다 (되살아나지 않게)', !dues2[saved?.forwardChainId]);
    await panel.getByRole('button', { name: '닫기', exact: true }).click();
    await page.waitForTimeout(300);
    check('뗀 일정에는 표시가 없다', (await card('점검기한 새 보고서 제출').locator('[data-due-badge]').count()) === 0);

    // ── 5. 주간 화면 ──
    await page.getByRole('button', { name: '주간', exact: true }).first().click();
    await page.locator('[data-due-badge="D-3"]').first().waitFor({ timeout: 8000 }).catch(() => {});
    check('주간 화면에도 D-3', (await page.locator('[data-due-badge="D-3"]').count()) >= 1);
    check('주간 화면에도 사슬 기한 D-1', (await page.locator('[data-due-badge="D-1"]').count()) >= 1);
    await page.screenshot({ path: 'tools/report/due-week.png' });
    await page.getByRole('button', { name: '하루', exact: true }).first().click();
  } catch (e) {
    check('예상 못 한 오류', false, String(e).slice(0, 300));
    await page.screenshot({ path: 'tools/report/due-error.png' }).catch(() => {});
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
