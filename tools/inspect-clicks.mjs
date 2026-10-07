// tools/inspect-clicks.mjs
//
// 19번 U12 직관성 점검 - 자주 하는 일을 실제 크롬으로 따라 하며 누르기·키 수를 센다 (docs/UX-AUDIT.md의 '클릭 수표').
// 일마다 하루 화면(점검 날짜)에서 새로 시작한다(그 준비는 세지 않는다). 글자 치기는 '글'로 따로 적고 세지 않는다.
// 마지막 단추가 되돌리기 어려운 일(백업 받기·구글 보내기·영구 삭제)은 그 단추를 누르지 않고 +1로 센다.
// 점검이 쓴 일정·기록·메모·출석·알림장·휴지통은 끝에 되돌린다. 결과는 표로 찍는다(UX-AUDIT.md에 옮긴다).
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-clicks.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검클릭';
const DAY = '2026-10-28';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-clicks');
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
const dayDocs = ['events', 'journals', 'attendance', 'notices', 'schedules'].map((c) => uref(c, DAY));
const before = await Promise.all(dayDocs.map(read));
const listIds = async (c) => new Set((await getDocsFromServer(collection(db, 'users', user.uid, c))).docs.map((d) => d.id));
const trashBefore = await listIds('trash');
const tasksBefore = await listIds('tasks');

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
page.setDefaultTimeout(8000);

let n = { click: 0, key: 0, text: 0, extra: 0, hidden: '' };
const click = async (loc) => {
  n.click++;
  await loc.click();
  await page.waitForTimeout(350);
};
const key = async (k) => {
  n.key++;
  await page.keyboard.press(k);
  await page.waitForTimeout(350);
};
const typeIn = async (loc, text) => {
  n.text++;
  await loc.fill(text);
};
const more = async (name) => {
  await click(page.getByTitle('더보기 메뉴'));
  await click(page.getByRole('button', { name }).first());
};
async function pickDate(date) {
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await page.waitForTimeout(300);
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await page.waitForTimeout(300);
  }
  await direct.fill(date);
  await page.mouse.move(5, 600);
  await page.waitForTimeout(1000);
}
async function reset() {
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(800);
  await pickDate(DAY);
  n = { click: 0, key: 0, text: 0, extra: 0, hidden: '' };
}
const visible = (loc) => loc.first().waitFor({ timeout: 8000 }).then(() => true, () => false);
const dialog = (text) => page.locator('[role=dialog], aside', { hasText: text });

const TASKS = [
  ['일정 추가 (라벨은 기본)', async () => {
    await click(page.getByRole('button', { name: '일정 추가' }));
    await typeIn(page.getByPlaceholder('새로운 일정을 입력하세요...'), `${MARK} 일정`);
    await click(page.getByRole('button', { name: '저장', exact: true }));
    return visible(page.getByText(`${MARK} 일정`));
  }],
  ['일정 완료', async () => {
    n.hidden = '라벨 칩을 누르면 완료 (칩이 단추로 보이지 않는다)';
    await click(page.locator('div', { hasText: `${MARK} 일정` }).locator('[title^="클릭하여 완료"]').last());
    return true;
  }],
  ['일정을 다른 날로 옮기기 (칸에서)', async () => {
    n.hidden = '끌어 옮기기(주간·월간)는 1번이지만 알려 주지 않으면 모른다';
    await click(page.getByText(`${MARK} 일정`).first());
    await typeIn(page.getByLabel('일정 날짜'), '2026-10-29');
    await click(page.getByRole('button', { name: '옮기고 저장', exact: true }));
    return true;
  }],
  ['기록 쓰기 + 라벨 하나', async () => {
    await click(page.getByRole('button', { name: '기록 추가' }).first());
    const panel = page.locator('aside[aria-label="기록 쓰기"]').first();
    await typeIn(panel.locator('textarea').first(), `${MARK} 기록`);
    await click(panel.locator('[data-entry-label-chip="학생상담"]'));
    await key('Control+s');
    return true;
  }],
  ['메모 쓰기', async () => {
    await click(page.getByRole('button', { name: '메모', exact: true }).first());
    await click(page.getByRole('button', { name: /새 메모/ }).first());
    await typeIn(page.locator('aside[aria-label="메모 쓰기"] textarea').first(), `${MARK} 메모`);
    await key('Control+s');
    return true;
  }],
  ['새 라벨 만들어 붙이기 (라벨 관리로)', async () => {
    await more(/통합 라벨 관리/);
    await click(page.locator('[data-label-tab="entry"]'));
    await typeIn(page.getByLabel('새 메모·기록 라벨 이름'), `${MARK}라벨`);
    await click(page.getByRole('button', { name: '추가', exact: true }).last());
    n.extra += 3; // 창 닫기 → 기록 추가 → 칩 (세지 않고 더함)
    return true;
  }],
  ["새 라벨 만들어 붙이기 ('#라벨' 마지막 줄)", async () => {
    await click(page.getByRole('button', { name: '기록 추가' }).first());
    const panel = page.locator('aside[aria-label="기록 쓰기"]').first();
    await typeIn(panel.locator('textarea').first(), `${MARK} 기록2\n#${MARK}라벨2`);
    await key('Control+s');
    n.hidden = "마지막 줄 '#이름'은 칸 아래 안내로만 알 수 있다";
    return true;
  }],
  ['출석: 한 학생 결석 (사유는 처음부터 질병)', async () => {
    await click(page.getByTitle('이 날 출석 체크 / 누계 보기').first());
    // 점검 계정(teacher)에는 명렬표가 없다 - 결석·저장을 코드대로 더한다
    if (await visible(page.getByText('명렬표가 없습니다'))) {
      n.extra += 1;
      n.key += 1;
      n.hidden = '명렬표 없는 점검 계정 - 결석·Ctrl+S를 코드대로 셈';
      return true;
    }
    const num = await page.locator('[data-attendance-num]').first().getAttribute('data-attendance-num');
    const row = page.locator(`[data-attendance-num="${num}"]`).first();
    await click(row.getByRole('button', { name: '결석', exact: true }));
    await key('Control+s');
    return true;
  }],
  ['알림장 쓰기', async () => {
    await click(page.getByTitle('이 날 알림장 쓰기 / 날짜별로 모아 보기').first());
    await typeIn(page.getByPlaceholder(/국어 준비물/).first(), `${MARK} 알림`);
    await key('Control+s');
    return true;
  }],
  ['진도 보기 (진도 관리 창)', async () => {
    await more(/진도 관리/);
    return visible(dialog('진도'));
  }],
  ['통합 검색', async () => {
    await click(page.getByTitle(/통합 검색/).first());
    await typeIn(page.getByRole('textbox').last(), '회의');
    await key('Enter');
    return true;
  }],
  ['주간 화면 보기', async () => {
    await click(page.getByRole('button', { name: '주간', exact: true }).first());
    return true;
  }],
  ['오늘이 아닌 날짜로 가기 (달력에서 직접)', async () => {
    n.hidden = '날짜 단추에 마우스를 올려야 달력이 뜬다';
    await page.getByTitle(/달력에서 날짜 선택/).first().hover();
    await page.waitForTimeout(300);
    await typeIn(page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]'), '2026-11-02');
    return true;
  }],
  ['휴지통에서 되살리기', async () => {
    await click(page.getByRole('button', { name: '휴지통' }).first());
    await visible(dialog('휴지통'));
    n.extra += 1; // 복원 단추 (누르지 않음)
    return true;
  }],
  ['백업 받기', async () => {
    await more(/내보내기 \/ 가져오기/);
    n.extra += 1; // 내보내기 단추 (누르지 않음)
    return visible(page.getByText('내보내기 / 가져오기 통합 관리'));
  }],
  ['구글 캘린더로 보내기 (수동)', async () => {
    await more(/구글 캘린더로 보내기/);
    n.extra += 1; // 보내기 단추 (누르지 않음)
    return visible(dialog('구글 캘린더'));
  }],
  ['시간표 적용 창 열기', async () => {
    await more(/시간표 적용/);
    return visible(dialog('시간표'));
  }],
  ['발표자 뽑기', async () => {
    await more(/발표자 뽑기/);
    if (await visible(page.getByText('명렬표가 없습니다'))) {
      n.extra += 1;
      n.hidden = "명렬표 없는 점검 계정 - '뽑기' 단추를 코드대로 셈";
      return true;
    }
    await click(page.getByRole('button', { name: /뽑기/ }).last());
    return true;
  }],
  ['D-Day 보기', async () => {
    await click(page.getByTitle(/학사 D-Day 관리/).first());
    return visible(dialog('D-Day'));
  }],
  ['메모를 라벨로 거르기', async () => {
    await click(page.getByRole('button', { name: '메모', exact: true }).first());
    await click(page.locator('nav[aria-label="메모 라벨 거르개"] button').nth(1));
    return true;
  }],
];

const rows = [];
try {
  for (const [name, run] of TASKS) {
    await reset();
    let ok = false;
    try {
      ok = await run();
    } catch (e) {
      ok = false;
      n.hidden = (n.hidden ? n.hidden + ' / ' : '') + '점검이 막힘: ' + e.message.split('\n')[0].slice(0, 80);
    }
    const total = n.click + n.key + n.extra;
    rows.push({ name, ...n, total, ok });
    console.log(`${ok ? '✔' : '✘'} ${name}: 누르기 ${n.click} · 키 ${n.key}${n.extra ? ` · 안 누른 마지막 ${n.extra}` : ''} = ${total}${n.text ? ` (+ 글 ${n.text})` : ''}${n.hidden ? `  ※ ${n.hidden}` : ''}`);
  }
} finally {
  await new Promise((r) => setTimeout(r, 1500));
  await browser.close();
  for (let i = 0; i < dayDocs.length; i++) {
    if (before[i]) await setDoc(dayDocs[i], before[i]);
    else await deleteDoc(dayDocs[i]);
  }
  await deleteDoc(uref('events', '2026-10-29')).catch(() => {});
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'tasks'))).docs) if (!tasksBefore.has(d.id)) await deleteDoc(d.ref);
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs) if (!trashBefore.has(d.id)) await deleteDoc(d.ref);
  // 만든 라벨을 뺀다
  const L = await read(uref('settings', 'labels'));
  if (L) {
    const keep = (l) => !String(typeof l === 'string' ? l : l?.name).includes(MARK);
    await setDoc(uref('settings', 'labels'), { ...L, memoLabels: (L.memoLabels || []).filter(keep), journalLabels: (L.journalLabels || []).filter(keep) });
  }
}
console.log('\n| 일 | 누르기 | 키 | 합 |');
for (const r of rows) console.log(`| ${r.name} | ${r.click + r.extra} | ${r.key} | ${r.total} |`);
