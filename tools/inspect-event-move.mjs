// tools/inspect-event-move.mjs
//
// 일정 날짜 옮기기(docs/ROADMAP.md 1번)를 실제 크롬으로 눌러 보고, 서버에 남은 모습을 확인한다.
//   - 고치던 일정: 날짜 칸에서 새 날짜 → '옮기고 저장' → 옛 날짜에서 빠지고 새 날짜에 같은 id로,
//     V3 글(eventText)도 두 날 모두, 연결된 기록의 역링크 날짜, 알림 날짜까지
//   - 새 일정: 날짜 칸을 바꾸면 그 날짜에 저장된다
//
//   npm run emu                (다른 창)
//   node tools/serve-both.mjs  (다른 창)
//   VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-event-move.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'event-move');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const p2 = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const plus = (n) => {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return ds(d);
};
const today = ds(new Date());
const to = plus(3);
const newDay = plus(5);

const MOVE = '옮길 회의 ' + Date.now().toString(36);
const STAY = '남을 일정';
const NEW = '새 일정 날짜 바꾸기 ' + Date.now().toString(36);
const JR = 'jr_move_probe';

const results = [];
const check = (name, ok, detail = '') => {
  results.push({ name, ok });
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

async function seed() {
  const evRef = doc(db, 'users', uid, 'events', today);
  await setDoc(evRef, {
    eventList: [
      { id: 'ev_stay', content: STAY, completed: false, calendar: true },
      {
        id: 'ev_move',
        content: MOVE,
        completed: false,
        calendar: true,
        time: `${today}T23:50`,
        linkedItems: [{ targetType: 'journal', targetId: JR, targetDate: today, targetFId: 'personal', title: '[기록] 회의 준비' }],
      },
    ],
    eventText: `${STAY}\n${MOVE}`,
    updatedAt: Date.now(),
  });
  // 옮길 날짜에 원래 있던 일정 (덮이면 안 된다)
  await setDoc(doc(db, 'users', uid, 'events', to), {
    eventList: [{ id: 'ev_there', content: '그날 원래 일정', completed: false }],
    eventText: '그날 원래 일정',
    updatedAt: Date.now(),
  });
  await setDoc(doc(db, 'users', uid, 'journals', today), {
    entries: [
      {
        id: JR,
        content: '회의 준비 기록',
        createdAt: Date.now(),
        linkedItems: [{ targetType: 'event', targetId: 'ev_move', targetDate: today, targetFId: 'personal', title: `[${today}] ${MOVE}` }],
      },
    ],
    updatedAt: Date.now(),
  });
}

const listOf = async (date) => {
  const s = await getDocFromServer(doc(db, 'users', uid, 'events', date));
  return { list: s.data()?.eventList || [], text: s.data()?.eventText || '' };
};

const run = async () => {
  await seed();
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  const logs = [];
  page.on('pageerror', (e) => logs.push(`pageerror: ${e.message.slice(0, 200)}`));
  page.on('dialog', (d) => d.accept());

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.getByText(MOVE).first().waitFor({ timeout: 20000 });

  // ── 1. 고치던 일정을 옮긴다 ──
  await page.getByText(MOVE).first().click();
  const panel = page.getByRole('complementary', { name: '일정 쓰기' });
  await panel.getByLabel('일정 날짜').waitFor({ timeout: 10000 });
  check('수정 칸 맨 위에 날짜 칸이 있고 그 일정의 날짜다', (await panel.getByLabel('일정 날짜').inputValue()) === today);
  await panel.getByLabel('일정 날짜').fill(to);
  check("날짜를 바꾸면 '저장하면 … 옮깁니다'가 뜬다", await panel.getByText(/저장하면 .* 옮깁니다/).isVisible());
  await panel.getByRole('button', { name: '옮기고 저장' }).click();
  await page.getByText(/일정을 .*로 옮겼습니다/).first().waitFor({ timeout: 15000 });
  check('옮겼다는 안내가 뜬다', true);
  await page.waitForTimeout(1500);
  check('칸은 새 날짜의 수정 칸이 된다', (await panel.getByLabel('일정 날짜').inputValue()) === to);

  const a = await listOf(today);
  const b = await listOf(to);
  // 앱을 열 때 이월이 지난 일정을 오늘로 데려올 수 있다 - 옮긴 것만 빠지고 남을 일정은 남았는지 본다
  check('옛 날짜에서 그 일정만 빠졌다', !a.list.some((e) => e.id === 'ev_move') && a.list.some((e) => e.id === 'ev_stay'), JSON.stringify(a.list.map((e) => e.id)));
  check('옛 날짜의 V3 글도 고쳐졌다', a.text.includes(STAY) && !a.text.includes(MOVE), JSON.stringify(a.text));
  const moved = b.list.find((e) => e.content === MOVE);
  check('새 날짜에 같은 id로 들어갔고 그날 원래 일정은 남았다', !!moved && moved.id === 'ev_move' && b.list.some((e) => e.id === 'ev_there'), JSON.stringify(b.list.map((e) => e.id)));
  check('새 날짜의 V3 글에도 들어갔다', b.text.includes(MOVE));
  check('알림도 같은 날 수만큼 옮겨졌다', moved?.time === `${to}T23:50`, moved?.time);
  const jr = await getDocFromServer(doc(db, 'users', uid, 'journals', today));
  const back = (jr.data()?.entries || [])[0]?.linkedItems || [];
  check('연결된 기록의 역링크가 새 날짜를 가리킨다', back.length === 1 && back[0].targetDate === to && back[0].targetId === 'ev_move', JSON.stringify(back));
  await page.screenshot({ path: 'tools/report/event-move-edit.png' });
  await panel.getByRole('button', { name: '닫기' }).click();

  // ── 2. 새 일정: 날짜를 바꾸면 그 날짜에 저장 ──
  await page.getByRole('button', { name: '일정 추가' }).first().click();
  const panel2 = page.getByRole('complementary', { name: '일정 쓰기' });
  await panel2.getByPlaceholder('새로운 일정을 입력하세요...').fill(NEW);
  await panel2.getByLabel('일정 날짜').fill(newDay);
  await page.waitForTimeout(500);
  check('새 일정 칸: 날짜를 고르면 칸 제목의 날짜도 바뀐다', await panel2.getByText(new RegExp(`${Number(newDay.slice(5, 7))}/${Number(newDay.slice(8))}\\(.\\) 일정`)).isVisible());
  await panel2.getByRole('button', { name: '저장' }).click();
  await page.getByText('일정을 추가했습니다').first().waitFor({ timeout: 15000 });
  await page.waitForTimeout(1000);
  const c = await listOf(newDay);
  const t = await listOf(today);
  check('새 일정이 고른 날짜에 저장됐다', c.list.some((e) => e.content === NEW));
  check('오늘에는 들어가지 않았다', !t.list.some((e) => e.content === NEW));
  await page.screenshot({ path: 'tools/report/event-move-new.png' });

  if (logs.length) {
    console.log('\n── 콘솔 ──');
    logs.slice(0, 10).forEach((l) => console.log('  ' + l));
  }
  await browser.close();
  const failed = results.filter((r) => !r.ok).length;
  console.log(`\n${results.length - failed}/${results.length} 통과`);
  process.exit(failed ? 1 : 0);
};
run().catch((e) => {
  console.error(e);
  process.exit(1);
});
