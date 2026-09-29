// tools/inspect-scenarios.mjs
//
// "이럴 때는 되는데 저럴 때는 안 된다"를 찾는 상황별 점검.
// 사용 설명서 점검(inspect-manual)은 기능마다 한 길로만 눌러 본다. 여기서는 같은 기능을
// 여러 조건에서 눌러 본다:
//   공간(개인 / 공유 그룹) · 날짜(오늘 / 다른 날 / 주말 / 빈 날) · 여는 길(하루·주간·월간·년간·검색)
//   · 자료 모양(V3 옛 글 형식, 라벨 id만, 긴 글·특수문자) · 칸 상태(쌓기, 저장 안 한 채 ESC,
//   공간을 바꾼 뒤 저장) · 동시에 두 탭 · 화면(PC 1400 / 휴대폰 390)
//
// 에뮬레이터 안에서만 돈다. 시작할 때 점검용 자료를 에뮬레이터에 직접 심는다.
//   npm run emu / npm run seed (먼저)
//   VITE_USE_EMULATOR=1 npm run build && npx vite preview --port 4173
//   SITE=http://localhost:4173/ OUT=<폴더> node tools/inspect-scenarios.mjs
//   ONLY=pc|mobile  (한쪽만)
//   MATCH=<정규식>  (이름이 맞는 점검만)
import { chromium } from 'playwright';
import fs from 'node:fs';
import { initializeApp } from 'firebase/app';
import { getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, deleteDoc } from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const SITE = process.env.SITE || 'http://localhost:4173/';
const OUT = process.env.OUT || 'tools/report/scenarios';
const ONLY = process.env.ONLY || '';
/** 이름에 이 말이 든 점검만 돌린다 (예: MATCH=기록 카드). 앞 점검에 기대는 점검은 함께 골라야 한다. */
const MATCH = process.env.MATCH ? new RegExp(process.env.MATCH) : null;
fs.mkdirSync(OUT, { recursive: true });

// ── 점검용 자료를 에뮬레이터에 직접 심는다 ─────────────────────────────
const fbApp = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'scenario');
const db = getFirestore(fbApp);
const fbAuth = getAuth(fbApp);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(fbAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(fbAuth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const evRef = (date) => doc(db, 'users', uid, 'events', date);

/** 점검 날짜들 (시드 자료가 있는 학년도 안, 오늘과 겹치지 않게) */
const D = {
  v3: '2026-11-10', // V3 옛 글 형식(eventText만)
  ids: '2026-11-11', // 라벨을 id로만 들고 있는 일정
  long: '2026-11-12', // 긴 글·특수문자
  weekend: '2026-11-14', // 토요일, 빈 날
  twoTabs: '2026-11-16', // 두 탭 동시 저장
  space: '2026-11-17', // 공간을 바꾼 뒤 저장
  bracket: '2026-11-13', // 본문이 '[무엇]'으로 시작하는 일정
  jrTabs: '2026-11-20', // 두 탭에서 기록 동시 추가
  jrCold: '2026-11-23', // 기록 칸을 열자마자 저장
  bulk: '2026-11-24', // 다중 선택 라벨 바꾸기
  trash: '2026-11-25', // 지우고 되살리기
  jrKeep: '2026-11-26', // 기록 고치기·지우기에 곁의 기록과 모르는 필드가 남는가
};
const pad2 = (n) => String(n).padStart(2, '0');
const localDate = (d) => `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
/** 이월 점검: 어제(이 컴퓨터 날짜)와 오늘 */
const TODAY = localDate(new Date());
const YESTERDAY = localDate(new Date(Date.now() - 864e5));
const jrRef = (date, groupId = null) => (groupId ? doc(db, 'groups', groupId, 'journals', date) : doc(db, 'users', uid, 'journals', date));
async function storedJournals(date, groupId = null) {
  const snap = await getDoc(jrRef(date, groupId));
  return snap.exists() && Array.isArray(snap.data().entries) ? snap.data().entries : [];
}
async function plantFixtures() {
  await setDoc(evRef(D.v3), {
    eventText: '[이월] V3 옛 일정 하나\n[v] V3 끝난 일정\nV3 라벨 없는 일정',
    updatedAt: Date.now(),
  });
  await setDoc(evRef(D.ids), {
    eventList: [
      { id: 'fx_ids_1', content: '라벨 id만 있는 일정', label: '', labelIds: ['ev_3'], completed: false, linkedItems: [], attachments: [] },
      { id: 'fx_ids_2', content: '곁에 있는 다른 일정', label: '달력', labelIds: [], completed: false, linkedItems: [], attachments: [] },
    ],
    updatedAt: Date.now(),
  });
  await setDoc(evRef(D.bracket), {
    eventList: [
      { id: 'fx_br_user', content: '[참고] 공문 회신', label: '달력', labelIds: ['ev_1'], completed: false, linkedItems: [], attachments: [] },
      { id: 'fx_br_legacy', content: '[이월] 옛 V4 방식 일정', completed: false, linkedItems: [], attachments: [] },
      { id: 'fx_br_other', content: '같은 날 다른 일정', label: '달력', labelIds: ['ev_1'], completed: false, linkedItems: [], attachments: [] },
    ],
    updatedAt: Date.now(),
  });
  for (const d of [D.long, D.weekend, D.twoTabs, D.space]) await deleteDoc(evRef(d)).catch(() => {});
  // 기록: 두 탭 / 열자마자 저장
  await deleteDoc(jrRef(D.jrTabs)).catch(() => {});
  await setDoc(jrRef(D.jrCold), {
    entries: [
      { id: 'fx_jr_1', content: '먼저 있던 기록 하나', createdAt: 1, label: '학급활동', labelIds: ['j_1'], linkedItems: [], attachments: [] },
      { id: 'fx_jr_2', content: '먼저 있던 기록 둘', createdAt: 2, label: '학생상담', labelIds: ['j_2'], linkedItems: [], attachments: [] },
    ],
    updatedAt: Date.now(),
  });
  await setDoc(jrRef(D.jrKeep), {
    entries: [
      { id: 'fx_keep_1', content: '고칠 기록', createdAt: 1, label: '학급활동', labelIds: ['j_1'], linkedItems: [], attachments: [] },
      { id: 'fx_keep_2', content: '곁의 기록', createdAt: 2, label: '학생상담', labelIds: ['j_2'], linkedItems: [], attachments: [], v3Extra: '남아야 함' },
      { id: 'fx_keep_3', content: '지울 기록', createdAt: 3, label: '', labelIds: [], linkedItems: [], attachments: [] },
    ],
    updatedAt: Date.now(),
  });
  // 다중 선택 라벨: 라벨을 id로만 든 일정
  await setDoc(evRef(D.bulk), {
    eventList: [
      { id: 'fx_bulk_1', content: '다중 라벨 하나', label: '', labelIds: ['ev_3'], completed: false, linkedItems: [], attachments: [] },
      { id: 'fx_bulk_2', content: '다중 라벨 둘', label: '이월', labelIds: ['ev_3'], completed: false, linkedItems: [], attachments: [] },
    ],
    updatedAt: Date.now(),
  });
  // 지우고 되살리기: 기간 묶음 한 건과 보통 일정
  await setDoc(evRef(D.trash), {
    eventList: [
      { id: 'fx_tr_group', content: '되살릴 기간 (1/3)', label: '기간', labelIds: ['ev_4'], groupId: 'group_fx_trash', period: true, completed: false, linkedItems: [], attachments: [] },
      { id: 'fx_tr_keep', content: '남아 있을 일정', label: '달력', labelIds: ['ev_1'], completed: false, linkedItems: [], attachments: [] },
    ],
    updatedAt: Date.now(),
  });
  // 이월: 어제 날짜에 미완료 이월 / 완료한 이월 / 이월을 끈 것
  const y = (await getDoc(evRef(YESTERDAY))).data();
  const keepY = (y?.eventList || []).filter((e) => !String(e.id).startsWith('fx_fw_'));
  await setDoc(evRef(YESTERDAY), {
    eventList: [
      ...keepY,
      { id: 'fx_fw_open', content: '어제 못 끝낸 이월', label: '이월', labelIds: ['ev_3'], completed: false, linkedItems: [], attachments: [] },
      { id: 'fx_fw_done', content: '어제 끝낸 이월', label: '이월', labelIds: ['ev_3'], completed: true, linkedItems: [], attachments: [] },
      { id: 'fx_fw_optout', content: '이월 끈 일정', label: '이월', labelIds: ['ev_3'], forwardOptOut: true, completed: false, linkedItems: [], attachments: [] },
    ],
    updatedAt: Date.now(),
  }, { merge: true });
}
await plantFixtures();

// ── 점검 틀 ───────────────────────────────────────────────────────────
const results = [];
let page;
let shotNo = 0;
let tag = 'pc';
async function check(name, fn) {
  const full = `[${tag}] ${name}`;
  if (MATCH && !MATCH.test(full)) return;
  try {
    const note = await fn();
    results.push({ ok: true, name: full, note });
    console.log(`✅ ${full}${note ? ` — ${note}` : ''}`);
  } catch (e) {
    const msg = String(e?.message || e).split('\n')[0].slice(0, 220);
    results.push({ ok: false, name: full, note: msg });
    console.log(`❌ ${full} — ${msg}`);
    try {
      await page.screenshot({ path: `${OUT}/fail-${String(++shotNo).padStart(2, '0')}.png` });
    } catch {}
    await closeAll();
  }
}
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};
const wait = (ms) => page.waitForTimeout(ms);
/** 조건이 맞을 때까지 기다린다 (고정 대기 대신) */
async function until(fn, ms = 8000, step = 200) {
  const end = Date.now() + ms;
  for (;;) {
    const v = await fn().catch(() => false);
    if (v) return v;
    if (Date.now() > end) return v;
    await page.waitForTimeout(step);
  }
}
/** 확인창이 뜨면: 기본은 '확인'. 한 번만 '취소'로 바꿀 수 있다. */
let dialogAnswer = true;
const dialogsSeen = [];

async function closeAll() {
  // 쓰는 칸·팝업을 모두 닫는다. 저장 안 한 글이 있으면 묻는 창이 뜨는데, 그때는 버린다.
  const prev = dialogAnswer;
  dialogAnswer = true;
  for (let i = 0; i < 4; i++) {
    const closers = page.locator('aside [title="닫기"], [role=dialog] [title="닫기"]');
    if ((await closers.count()) === 0) break;
    await closers.first().click({ timeout: 800 }).catch(() => {});
    await wait(250);
  }
  await page.keyboard.press('Escape').catch(() => {});
  await wait(200);
  await page.mouse.move(2, 300).catch(() => {});
  dialogAnswer = prev;
}
const scopeTitle = () => page.locator('header span.font-extrabold').first().innerText();
async function goScope(k) {
  await page.keyboard.press(`Shift+Digit${k}`);
  await wait(1500);
}
/** 작은 달력의 '직접 선택'으로 그 날짜로 간다 */
async function goDate(date) {
  // 작은 달력은 마우스를 올리면 열리고, 누르면 열고 닫는다. 열렸는지 보고 필요할 때만 누른다.
  const direct = page.locator('label', { hasText: '직접 선택' }).locator('input[type=date]');
  await page.getByTitle(/달력에서 날짜 선택/).first().hover();
  await wait(300);
  if (!(await direct.count())) {
    await page.getByTitle(/달력에서 날짜 선택/).first().click();
    await wait(300);
  }
  await direct.fill(date);
  const [, m, d] = date.split('-').map(Number);
  // 제목에 그 날짜가 보일 때까지 (하루: '11월 12일', 주간·월간·년간은 달·주·학년도로 보인다)
  await until(async () => {
    const t = await scopeTitle();
    return t.includes(`${m}월 ${d}일`) || t.includes(`${m}월`) || /학년도/.test(t);
  }, 5000);
  await page.mouse.move(2, 400);
  await wait(800);
}
async function goDay(date) {
  await goScope(1);
  await goDate(date);
}
const eventPanel = () => page.locator('[aria-label="일정 쓰기"]').last();
const journalPanel = () => page.locator('[aria-label="기록 쓰기"]').last();
const EVENT_PH = '새로운 일정을 입력하세요...';
/** 하루 화면 머리줄의 '+ 추가' (일정 / 기록) */
const addEventBtn = () => page.getByRole('button', { name: '일정 추가', exact: true });
const addJournalBtn = () => page.getByRole('button', { name: '기록 추가', exact: true });
const eventRows = () => page.locator('[data-focus-key^="event"]');
const rowText = async (text) => eventRows().filter({ hasText: text }).count();

/** 에뮬레이터에서 그날 일정 목록을 직접 읽는다 (화면이 아니라 저장된 것) */
async function storedEvents(date, groupId = null) {
  const ref = groupId ? doc(db, 'groups', groupId, 'events', date) : evRef(date);
  const snap = await getDoc(ref);
  if (!snap.exists()) return [];
  const d = snap.data();
  return Array.isArray(d.eventList) ? d.eventList : [];
}

async function newEventViaDay(text) {
  await addEventBtn().click();
  await wait(600);
  const box = eventPanel().getByPlaceholder(EVENT_PH);
  await box.fill(text);
  await box.press('Control+s');
  await until(async () => (await rowText(text)) > 0);
}

const browser = await chromium.launch({ channel: 'chrome', headless: true });

async function openApp(viewport, extra = {}) {
  const ctx = await browser.newContext({ viewport, ...extra });
  const p = await ctx.newPage();
  p.on('dialog', (d) => {
    dialogsSeen.push(d.message());
    (dialogAnswer ? d.accept() : d.dismiss()).catch(() => {});
  });
  await p.goto(SITE, { waitUntil: 'domcontentloaded' });
  await p.getByRole('heading', { name: '수업' }).first().waitFor({ timeout: 40000 });
  await p.waitForTimeout(1500);
  return { ctx, p };
}

// ═══════════════════════════════ PC (1400) ═══════════════════════════════
if (ONLY !== 'mobile') {
  const { ctx, p } = await openApp({ width: 1400, height: 950 });
  page = p;
  tag = 'PC';
  const pageErrors = [];
  page.on('pageerror', (e) => {
    if (/Firestore\/(Write|Listen)\/channel/.test(e.message)) return;
    pageErrors.push(e.message);
  });

  // ── 자료 모양 ──
  await check('V3 옛 글 형식(eventText만 있는 날)도 하루 화면에 세 건 모두, 라벨·완료까지 보인다', async () => {
    await goDay(D.v3);
    const n = await until(async () => (await rowText('V3')) === 3 && 3);
    const chip = await eventRows().filter({ hasText: 'V3 옛 일정 하나' }).innerText();
    const done = await eventRows().filter({ hasText: 'V3 끝난 일정' }).locator('.line-through').count();
    assert(n === 3, `보이는 V3 일정 ${await rowText('V3')}건`);
    assert(/이월/.test(chip), `라벨 칩이 없음: ${chip.replace(/\s+/g, ' ')}`);
    assert(done > 0, '완료 표시([v])가 안 보임');
  });

  await check('V3 옛 글 형식의 날에 한 건을 고쳐 저장해도 나머지 두 건이 남는다', async () => {
    await eventRows().filter({ hasText: 'V3 라벨 없는 일정' }).click();
    await wait(600);
    const box = eventPanel().locator('textarea').first();
    await box.fill('V3 라벨 없는 일정 (V4에서 고침)');
    await box.press('Control+s');
    await until(async () => (await rowText('V4에서 고침')) > 0);
    await closeAll();
    const stored = await storedEvents(D.v3);
    const names = stored.map((e) => e.content);
    assert(stored.length === 3, `저장된 일정 ${stored.length}건: ${names.join(' / ')}`);
    assert(names.some((n) => /V4에서 고침/.test(n)), '고친 내용이 저장되지 않음');
  });

  await check('라벨을 id로만 들고 있는 일정도 칩이 보이고, 떼고 저장하면 칩이 사라진다', async () => {
    await goDay(D.ids);
    const row = eventRows().filter({ hasText: '라벨 id만 있는 일정' });
    await row.waitFor({ timeout: 8000 });
    const before = await row.innerText();
    assert(/이월/.test(before), `칩이 안 보임: ${before.replace(/\s+/g, ' ')}`);
    await row.click({ position: { x: 200, y: 12 } });
    await wait(600);
    const chip = eventPanel().getByRole('button', { name: '이월', exact: true });
    if ((await chip.getAttribute('aria-pressed')) === 'true') await chip.click();
    await eventPanel().locator('textarea').first().press('Control+s');
    await wait(1500);
    await closeAll();
    const after = await until(async () => {
      const t = await eventRows().filter({ hasText: '라벨 id만 있는 일정' }).innerText();
      return !/이월/.test(t) && t;
    });
    const stored = (await storedEvents(D.ids)).find((e) => e.id === 'fx_ids_1');
    assert(after, '저장한 뒤에도 이월 칩이 보임');
    assert(!(stored.labelIds || []).includes('ev_3'), `저장된 labelIds: ${JSON.stringify(stored.labelIds)}`);
    assert((await storedEvents(D.ids)).length === 2, '곁에 있던 일정이 사라짐');
  });

  const LONG = '긴 일정 ' + '가나다라마바사 '.repeat(40) + '끝';
  const SPECIAL = `특수 "따옴표" <꺾쇠> & 앰퍼샌드 '홑' \\역슬래시 😀 이모지 #26040305`;
  await check('긴 글(300자)과 특수문자·이모지·여러 줄 일정이 그대로 저장되고 화면이 가로로 넘치지 않는다', async () => {
    await goDay(D.long);
    await newEventViaDay(LONG);
    // 저장한 새 일정 칸은 그 일정의 수정 칸이 된다(3251f4f). 둘째 일정은 새 칸에서 쓴다.
    await closeAll();
    await addEventBtn().click();
    await wait(500);
    const box = eventPanel().getByPlaceholder(EVENT_PH);
    await box.fill(SPECIAL + '\n둘째 줄');
    await box.press('Control+s');
    await until(async () => (await rowText('앰퍼샌드')) > 0);
    await closeAll();
    const stored = await storedEvents(D.long);
    const special = stored.find((e) => /앰퍼샌드/.test(e.content));
    assert(stored.some((e) => e.content === LONG.trim()), '긴 글이 잘렸거나 없음');
    assert(special && special.content === (SPECIAL + '\n둘째 줄').trim(), `특수문자 글: ${special?.content}`);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflow <= 1, `가로 넘침 ${overflow}px`);
    await goScope(3);
    await goDate(D.long);
    const overflowMonth = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    assert(overflowMonth <= 1, `월간 가로 넘침 ${overflowMonth}px`);
  });

  await check("새 일정이 '[v]'·'[중요]'로 시작하거나 여러 줄이어도 적은 글 그대로 저장된다 (완료·라벨로 바뀌지 않는다)", async () => {
    await goDay(D.long);
    const texts = ['[v] 대괄호 v로 시작', '[중요] 대괄호 말로 시작\n둘째 줄\n셋째 줄'];
    for (const t of texts) {
      await addEventBtn().click();
      await wait(500);
      const box = eventPanel().getByPlaceholder(EVENT_PH);
      await box.fill(t);
      await box.press('Control+s');
      await wait(1800);
      await closeAll();
    }
    const stored = await storedEvents(D.long);
    for (const t of texts) {
      const e = stored.find((x) => x.content === t);
      assert(e, `'${t.replace(/\n/g, '⏎')}' 이 그대로 없음. 저장된 것: ${stored.map((x) => x.content.replace(/\n/g, '⏎')).join(' / ')}`);
      assert(!e.completed, `'${t}' 가 완료로 저장됨`);
      assert(!/중요|^v$/.test(e.label || ''), `'${t}' 의 라벨이 '${e.label}'`);
    }
  });

  await check("본문이 '[참고]'로 시작하는 일정은, 같은 날 다른 일정을 완료해도 앞부분이 지워지지 않는다", async () => {
    await goDay(D.bracket);
    const row = eventRows().filter({ hasText: '공문 회신' });
    await row.waitFor({ timeout: 8000 });
    const shown = await row.innerText();
    await eventRows().filter({ hasText: '같은 날 다른 일정' }).locator('span[title^="클릭하여 완료"]').first().click();
    await wait(2000);
    const stored = (await storedEvents(D.bracket)).find((e) => e.id === 'fx_br_user');
    assert(/\[참고\] 공문 회신/.test(shown), `화면 글 '${shown.replace(/\s+/g, ' ')}'`);
    assert(stored.content === '[참고] 공문 회신', `저장된 글 '${stored.content}'`);
  });

  await check("옛 방식('[이월] 본문', 라벨 칸 없음) 일정은 이월 칩과 본문으로 나뉘어 보이고, 고치면 라벨로 옮겨 저장된다", async () => {
    const row = eventRows().filter({ hasText: '옛 V4 방식 일정' });
    const shown = await row.innerText();
    assert(/이월/.test(shown) && !/\[이월\]/.test(shown), `화면 '${shown.replace(/\s+/g, ' ')}'`);
    await row.click({ position: { x: 220, y: 12 } });
    await wait(700);
    const box = eventPanel().locator('textarea').first();
    const v = await box.inputValue();
    await box.fill(v + ' (고침)');
    await box.press('Control+s');
    await wait(1800);
    await closeAll();
    const e = (await storedEvents(D.bracket)).find((x) => x.id === 'fx_br_legacy');
    assert(v === '옛 V4 방식 일정', `수정 칸의 글 '${v}'`);
    assert(e.content === '옛 V4 방식 일정 (고침)' && /이월/.test(e.label || ''), `저장된 것 ${JSON.stringify({ c: e.content, label: e.label })}`);
  });

  // ── 날짜와 여는 길 ──
  await check('주말·빈 날(일정 문서가 아예 없는 날)에 주간 + 로 일정을 넣으면 그날 생긴다', async () => {
    await goScope(2);
    await goDate(D.weekend);
    // 주말이 꺼져 있으면 켠다
    if ((await page.locator('[data-today], [class*="rounded-2xl"]', { hasText: '11.14' }).count()) === 0) {
      await page.getByRole('button', { name: '주말', exact: true }).click();
      await wait(800);
    }
    const card = page.locator('div.rounded-2xl', { hasText: /토\s*11\.14/ }).first();
    await card.hover();
    await card.getByTitle('일정 빠른 추가').click();
    await wait(600);
    const sub = await eventPanel().locator('p.text-primary').innerText();
    const box = eventPanel().getByPlaceholder(EVENT_PH);
    await box.fill('주말 빈 날 일정');
    await box.press('Control+s');
    await wait(1800);
    await closeAll();
    const stored = await storedEvents(D.weekend);
    assert(/11\/14/.test(sub), `칸의 날짜 '${sub}'`);
    assert(stored.some((e) => e.content === '주말 빈 날 일정'), `저장된 것: ${JSON.stringify(stored.map((e) => e.content))}`);
  });

  for (const [k, name] of [
    [2, '주간'],
    [3, '월간'],
    [4, '년간'],
  ]) {
    await check(`${name} 화면에서 다른 날(${D.ids}) 일정을 고치면 그 날짜에 저장된다`, async () => {
      await goScope(k);
      await goDate(D.ids);
      const ev = page.locator('[title="클릭하여 상세 보기"]', { hasText: '곁에 있는 다른 일정' }).first();
      await ev.waitFor({ timeout: 8000 });
      const b = await ev.boundingBox();
      await ev.click({ position: { x: b.width - 3, y: b.height / 2 } });
      await wait(700);
      const box = eventPanel().locator('textarea').first();
      const next = `곁에 있는 다른 일정 ${name}`;
      await box.fill(next);
      await box.press('Control+s');
      await wait(1800);
      await closeAll();
      const stored = await storedEvents(D.ids);
      assert(stored.some((e) => e.content === next), `저장된 것: ${stored.map((e) => e.content).join(' / ')}`);
      assert(stored.length === 2, `그날 일정 ${stored.length}건`);
      // 다음 화면 점검을 위해 되돌린다
      const all = stored.map((e) => (e.content === next ? { ...e, content: '곁에 있는 다른 일정' } : e));
      await setDoc(evRef(D.ids), { eventList: all, updatedAt: Date.now() }, { merge: true });
      await wait(800);
    });
  }

  await check('검색에서 찾은 다른 날 일정으로 이동하면 그 날짜 하루 화면에서 짚어 준다', async () => {
    await goScope(1);
    await page.keyboard.press('Control+f');
    await wait(800);
    const box = page.getByPlaceholder(/검색어 입력 후 엔터/);
    await box.fill('앰퍼샌드');
    await box.press('Enter');
    const first = page.locator('[data-scroll-lock] div.cursor-pointer', { hasText: /앰퍼샌드/ }).first();
    await first.waitFor({ timeout: 10000 });
    await first.click();
    await wait(500);
    await page.getByRole('button', { name: /하루 화면으로 이동/ }).first().click();
    await wait(2500);
    const t = await scopeTitle();
    assert(/11월 12일/.test(t), `이동한 뒤 제목 '${t}'`);
    assert((await rowText('앰퍼샌드')) > 0, '그 일정이 목록에 없음');
  });

  // ── 쓰는 칸의 상태 ──
  await check('새 일정 칸을 연 채 새 기록 칸을 열면 쌓이고, 일정 칸의 적던 글이 남는다', async () => {
    await goDay(D.long);
    await addEventBtn().click();
    await wait(500);
    await eventPanel().getByPlaceholder(EVENT_PH).fill('쌓기 점검 적던 일정');
    await addJournalBtn().click();
    await wait(700);
    const stacked = await page.locator('[aria-label="기록 쓰기"]').count();
    const kept = await page.locator('[aria-label="일정 쓰기"]').getByPlaceholder(EVENT_PH).inputValue().catch(() => '');
    assert(stacked === 1, '기록 칸이 안 열림');
    assert(kept === '쌓기 점검 적던 일정', `일정 칸의 글 '${kept}'`);
  });

  await check('저장 안 한 글이 있는 채 ESC → 묻는 창에서 취소하면 칸과 글이 남는다', async () => {
    dialogsSeen.length = 0;
    dialogAnswer = false;
    await page.locator('body').click({ position: { x: 5, y: 500 } });
    await page.keyboard.press('Escape');
    await wait(600);
    dialogAnswer = true;
    const kept = await page.locator('[aria-label="일정 쓰기"]').getByPlaceholder(EVENT_PH).inputValue().catch(() => '(칸 없음)');
    assert(dialogsSeen.length > 0, '묻지 않고 닫힘');
    assert(kept === '쌓기 점검 적던 일정', `ESC 취소 뒤 일정 칸 '${kept}'`);
  });

  await check('ESC → 확인하면 오른쪽 칸이 모두 닫히고, 적던 글은 저장되지 않는다', async () => {
    dialogAnswer = true;
    await page.keyboard.press('Escape');
    await wait(800);
    const open = await page.locator('[aria-label$="쓰기"]').count();
    const stored = await storedEvents(D.long);
    assert(open === 0, `남은 칸 ${open}개`);
    assert(!stored.some((e) => e.content === '쌓기 점검 적던 일정'), 'ESC로 버렸는데 저장됨');
  });

  await check('커서가 왼쪽 화면에 있을 때 Ctrl+S 는 맨 위 칸만 저장한다', async () => {
    await addEventBtn().click();
    await wait(500);
    await eventPanel().getByPlaceholder(EVENT_PH).fill('맨 위 칸 저장 점검');
    await page.locator('main').click({ position: { x: 10, y: 10 } });
    await page.keyboard.press('Control+s');
    await wait(1800);
    await closeAll();
    const stored = await storedEvents(D.long);
    assert(stored.some((e) => e.content === '맨 위 칸 저장 점검'), '저장되지 않음');
  });

  await check('칸 안에서 Shift+1 같은 단축키를 쳐도 화면이 바뀌지 않고 글자로 들어간다', async () => {
    await goScope(2);
    await addEventBtn().click().catch(async () => {
      await page.getByTitle('일정 빠른 추가').first().click();
    });
    await wait(500);
    const box = eventPanel().getByPlaceholder(EVENT_PH);
    await box.click();
    await page.keyboard.press('Shift+Digit1');
    await wait(500);
    const t = await scopeTitle();
    const v = await box.inputValue();
    await closeAll();
    assert(/주$/.test(t), `화면이 바뀜: '${t}'`);
    assert(v.includes('!'), `글자가 안 들어감: '${v}'`);
  });

  await check('같은 일정을 두 번 누르면 칸이 둘 생기지 않고 그 칸이 맨 위로 온다', async () => {
    await goDay(D.ids);
    const row = eventRows().filter({ hasText: '곁에 있는 다른 일정' });
    await row.click({ position: { x: 200, y: 12 } });
    await wait(500);
    await addEventBtn().click();
    await wait(500);
    await row.click({ position: { x: 200, y: 12 } });
    await wait(500);
    const edits = await page.locator('[aria-label="일정 쓰기"]', { hasText: '일정 수정' }).count();
    await closeAll();
    assert(edits === 1, `같은 일정의 수정 칸 ${edits}개`);
  });

  await check('새 일정 저장을 빠르게 두 번 눌러도 하나만 생긴다', async () => {
    await goDay(D.long);
    await addEventBtn().click();
    await wait(500);
    await eventPanel().getByPlaceholder(EVENT_PH).fill('두 번 누른 저장');
    const save = eventPanel().getByRole('button', { name: '저장', exact: true });
    await save.click();
    await save.click().catch(() => {});
    await wait(2500);
    await closeAll();
    const n = (await storedEvents(D.long)).filter((e) => e.content === '두 번 누른 저장').length;
    assert(n === 1, `${n}건 생김`);
  });

  await check('두 탭(두 기기)에서 같은 날 동시에 일정을 넣어도 둘 다 남는다', async () => {
    const other = await openApp({ width: 1400, height: 950 });
    const pages = [page, other.p];
    for (const [i, pg] of pages.entries()) {
      page = pg;
      await goDay(D.twoTabs);
      await pg.getByRole('button', { name: '일정 추가', exact: true }).click();
      await wait(500);
      await eventPanel().getByPlaceholder(EVENT_PH).fill(`동시 저장 ${i + 1}번 탭`);
    }
    // 거의 동시에 저장
    await Promise.all(pages.map((pg) => pg.locator('[aria-label="일정 쓰기"]').last().getByRole('button', { name: '저장', exact: true }).click()));
    page = pages[0];
    await wait(3000);
    await other.ctx.close();
    await closeAll();
    const stored = (await storedEvents(D.twoTabs)).map((e) => e.content);
    assert(stored.includes('동시 저장 1번 탭') && stored.includes('동시 저장 2번 탭'), `저장된 것: ${stored.join(' / ')}`);
  });

  // ── 공간 (개인 / 공유 그룹) ──
  let groupId = '';
  let groupName = '';
  await check('공유 그룹을 만들고 그룹 공간으로 바꾸면 개인 일정이 보이지 않는다', async () => {
    await goDay(D.ids);
    if ((await page.locator('header select').count()) === 0) {
      await page.getByTitle('더보기 메뉴').click();
      await page.getByRole('button', { name: /공유 그룹 관리/ }).click();
      await wait(800);
      await page.getByRole('button', { name: /새 그룹 만들기/ }).click();
      await page.getByPlaceholder(/교과협의회/).fill('상황 점검 그룹');
      await page.getByRole('button', { name: '그룹 만들기', exact: true }).last().click();
      await wait(2500);
      await closeAll();
    }
    const sel = page.locator('header select');
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => ({ v: o.value, t: o.textContent })));
    const g = opts.find((o) => o.v);
    groupId = g.v;
    groupName = g.t.replace('👥', '').trim();
    await sel.selectOption(groupId);
    await wait(2000);
    const personal = await rowText('곁에 있는 다른 일정');
    assert(personal === 0, '그룹 공간인데 개인 일정이 보임');
    return `그룹 '${groupName}'`;
  });

  await check('그룹 공간에서 넣은 일정은 그룹에 저장되고 개인 공간에는 없다', async () => {
    await newEventViaDay('그룹 공간 일정');
    await closeAll();
    const inGroup = (await storedEvents(D.ids, groupId)).some((e) => e.content === '그룹 공간 일정');
    const inPersonal = (await storedEvents(D.ids)).some((e) => e.content === '그룹 공간 일정');
    assert(inGroup && !inPersonal, `그룹 ${inGroup} / 개인 ${inPersonal}`);
  });

  await check('칸을 연 채 공간을 개인으로 바꾸고 저장해도, 칸을 연 공간(그룹)에 들어간다', async () => {
    await goDate(D.space);
    await addEventBtn().click();
    await wait(500);
    const sub = await eventPanel().locator('p.text-primary').innerText();
    await eventPanel().getByPlaceholder(EVENT_PH).fill('공간 바꾼 뒤 저장');
    await page.locator('header select').selectOption('');
    await wait(1200);
    await eventPanel().getByPlaceholder(EVENT_PH).press('Control+s');
    await wait(2000);
    await closeAll();
    const inGroup = (await storedEvents(D.space, groupId)).some((e) => e.content === '공간 바꾼 뒤 저장');
    const inPersonal = (await storedEvents(D.space)).some((e) => e.content === '공간 바꾼 뒤 저장');
    assert(/👥/.test(sub), `칸 제목 아래 공간 '${sub}'`);
    assert(inGroup && !inPersonal, `그룹 ${inGroup} / 개인 ${inPersonal}`);
  });

  await check('그룹 공간에서 기간 일정(2일)을 등록하면 그룹에 생긴다', async () => {
    await page.locator('header select').selectOption(groupId);
    await wait(1500);
    await goDay(D.space);
    await addEventBtn().click();
    await wait(500);
    await eventPanel().getByPlaceholder(EVENT_PH).fill('그룹 기간');
    await eventPanel().locator('label', { hasText: /^기간$/ }).locator('input').check();
    await wait(800);
    const weekdayOnly = page.getByRole('checkbox', { name: /주말\(토\/일\)과 공휴일 제외/ });
    if ((await weekdayOnly.count()) && (await weekdayOnly.isChecked())) await weekdayOnly.uncheck();
    await page.getByLabel('종료일').fill('2026-11-18');
    await page.getByRole('button', { name: /등록 \(2일\)/ }).click();
    await wait(3000);
    await closeAll();
    const g1 = (await storedEvents(D.space, groupId)).some((e) => /그룹 기간 \(1\/2\)/.test(e.content));
    const g2 = (await storedEvents('2026-11-18', groupId)).some((e) => /그룹 기간 \(2\/2\)/.test(e.content));
    const p1 = (await storedEvents(D.space)).some((e) => /그룹 기간/.test(e.content));
    assert(g1 && g2 && !p1, `그룹 1일 ${g1}, 2일 ${g2}, 개인 ${p1}`);
  });

  await check('그룹 공간에서 반복 일정을 만들면 그룹에 생긴다', async () => {
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /반복 일정 등록/ }).click();
    await wait(800);
    await page.getByPlaceholder(/학년 협의회/).fill('그룹 반복');
    await page.getByRole('button', { name: '매주', exact: true }).click();
    const tue = page.locator('[role=dialog] button.rounded-full, [data-scroll-lock] button.rounded-full', { hasText: /^화$/ }).first();
    if (!(await tue.getAttribute('class')).includes('bg-primary')) await tue.click();
    const dates = page.locator('[role=dialog] input[type=date], [data-scroll-lock] input[type=date]');
    await dates.nth(0).fill('2026-11-17');
    await dates.nth(1).fill('2026-11-24');
    await page.getByRole('button', { name: /미리보기/ }).click();
    await page.getByRole('button', { name: /반복 일정 생성/ }).click();
    await wait(3000);
    await closeAll();
    const g = (await storedEvents('2026-11-24', groupId)).some((e) => e.content === '그룹 반복');
    const p = (await storedEvents('2026-11-24')).some((e) => e.content === '그룹 반복');
    assert(g && !p, `그룹 ${g} / 개인 ${p}`);
  });

  await check('그룹 공간의 알림장을 저장하고 기록에서 지우면 그룹의 알림장이 비워진다', async () => {
    await goDay(D.space);
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1500);
    const box = page.locator('[aria-label="알림장 쓰기"]').getByLabel('알림장 내용');
    await box.fill('그룹 알림장 한 줄');
    await box.press('Control+s');
    await wait(2500);
    await closeAll();
    const card = page.locator('[data-focus-key^="journal"]', { hasText: '그룹 알림장 한 줄' }).first();
    await card.waitFor({ timeout: 8000 });
    await card.hover();
    await card.getByTitle('기록 삭제').click();
    await wait(2500);
    const notice = await getDoc(doc(db, 'groups', groupId, 'notices', D.space));
    const lines = notice.exists() ? notice.data().lines : null;
    const personalNotice = await getDoc(doc(db, 'users', uid, 'notices', D.space));
    assert(Array.isArray(lines) && lines.length === 0, `그룹 알림장 줄: ${JSON.stringify(lines)}`);
    assert(!personalNotice.exists() || (personalNotice.data().lines || []).length === 0, '개인 알림장이 생김');
  });

  await check('그룹 공간에서 검색하면 그룹 자료를 찾는다', async () => {
    await page.keyboard.press('Control+f');
    await wait(800);
    const box = page.getByPlaceholder(/검색어 입력 후 엔터/);
    await box.fill('그룹 공간 일정');
    await box.press('Enter');
    const hit = await until(async () => (await page.locator('[data-scroll-lock] div.cursor-pointer', { hasText: '그룹 공간 일정' }).count()) > 0, 10000);
    await closeAll();
    // 개인으로 돌려 둔다
    await page.locator('header select').selectOption('');
    await wait(1200);
    assert(hit, '그룹 공간 일정을 못 찾음');
  });

  // ── 학급 운영의 빈 상태 ──
  await check('학생이 없는 학급을 고르면 출석부가 멈추지 않고 안내를 보인다', async () => {
    await goDay(D.long);
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(1500);
    const panel = page.locator('[aria-label="출석부 쓰기"]');
    const sel = panel.getByLabel('학급');
    const opts = await sel.locator('option').evaluateAll((os) => os.map((o) => o.value));
    // 학생이 없는 학급이 없으면 명렬표 점검에서 만든 학급이라도 고른다
    let empty = false;
    for (const v of opts) {
      await sel.selectOption(v);
      await wait(900);
      if ((await panel.getByText('이 학급에 학생이 없습니다.').count()) > 0) {
        empty = true;
        break;
      }
    }
    const ok = (await panel.locator('[data-attendance-num]').count()) > 0 || empty;
    await closeAll();
    assert(ok, '학생 줄도, 빈 학급 안내도 없음');
    return empty ? '빈 학급 안내 확인' : '빈 학급이 없어 학생 줄만 확인';
  });

  // ═══ 2차: 자료가 사라지지 않는가 ═══
  await check('두 탭(두 기기)에서 같은 날 동시에 기록을 넣어도 둘 다 남는다', async () => {
    const other = await openApp({ width: 1400, height: 950 });
    const pages = [page, other.p];
    for (const [i, pg] of pages.entries()) {
      page = pg;
      await goDay(D.jrTabs);
      await addJournalBtn().click();
      await wait(600);
      await pg.locator('[aria-label="기록 쓰기"]').last().getByPlaceholder(/오늘 있었던 일을 기록해보세요/).fill(`동시 기록 ${i + 1}번 탭`);
    }
    await Promise.all(pages.map((pg) => pg.locator('[aria-label="기록 쓰기"]').last().getByRole('button', { name: '저장', exact: true }).click()));
    page = pages[0];
    await wait(3000);
    await other.ctx.close();
    await closeAll();
    const stored = (await storedJournals(D.jrTabs)).map((e) => e.content);
    assert(stored.includes('동시 기록 1번 탭') && stored.includes('동시 기록 2번 탭'), `저장된 기록: ${stored.join(' / ') || '(없음)'}`);
  });

  await check('달력에서 기록 칸을 열자마자 저장해도(그날 자료가 오기 전) 그날의 다른 기록이 남는다', async () => {
    await goScope(3);
    await goDate(D.jrCold);
    // 달력 칸의 '기록 2건 보기' → '이 날 기록 추가' (하루 화면과 같은 기록 칸)
    const badge = page.locator('button[title="기록 2건 보기"]');
    const cell = page.locator('div').filter({ has: page.getByText('23', { exact: true }) }).filter({ has: badge }).last();
    const peek = cell.locator(badge).first();
    await peek.click();
    await wait(600);
    await page.getByRole('button', { name: '이 날 기록 추가' }).click();
    // 곧바로 적고 저장한다 (구독이 오기 전)
    const box = page.locator('[aria-label="기록 쓰기"]').last().getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await box.fill('열자마자 저장한 기록');
    await box.press('Control+s');
    await wait(2500);
    await closeAll();
    const stored = (await storedJournals(D.jrCold)).map((e) => e.content);
    assert(stored.length === 3, `그날 기록 ${stored.length}건: ${stored.join(' / ')}`);
  });

  await check('기록을 고치고 지워도 곁의 기록과 앱이 모르는 필드(V3 등)가 남는다', async () => {
    await goDay(D.jrKeep);
    const card = (t) => page.locator('[data-focus-key^="journal"]', { hasText: t }).first();
    await card('고칠 기록').click();
    await wait(800);
    const box = journalPanel().getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await box.fill('고친 기록');
    await box.press('Control+s');
    await wait(1800);
    await closeAll();
    // 화면이 받지 못한 기록을 서버에 바로 넣고, 곧바로 지운다
    const snap = await getDoc(jrRef(D.jrKeep));
    await setDoc(jrRef(D.jrKeep), { entries: [...snap.data().entries, { id: 'fx_keep_srv', content: '다른 기기 기록', createdAt: 4, labelIds: [], linkedItems: [], attachments: [] }] }, { merge: true });
    const del = card('지울 기록');
    await del.hover();
    await del.getByTitle(/삭제/).first().click();
    await wait(2500);
    const stored = await storedJournals(D.jrKeep);
    const by = (id) => stored.find((e) => e.id === id);
    assert(by('fx_keep_1')?.content === '고친 기록', `고친 글: ${by('fx_keep_1')?.content}`);
    assert(by('fx_keep_2')?.v3Extra === '남아야 함', `곁의 기록: ${JSON.stringify(by('fx_keep_2'))}`);
    assert(!by('fx_keep_3'), '지운 기록이 남음');
    assert(by('fx_keep_srv'), '다른 기기에서 넣은 기록이 사라짐');
  });

  await check('다중 선택으로 라벨을 바꾸면 옛 라벨(id로 든 것까지)이 남지 않는다', async () => {
    await goDay(D.bulk);
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /다중 선택 모드 켜기/ }).click();
    await wait(500);
    for (const t of ['다중 라벨 하나', '다중 라벨 둘']) await eventRows().filter({ hasText: t }).click();
    await page.getByTitle('선택 일정 라벨 일괄 변경').click();
    await wait(400);
    const menu = page.locator('div').filter({ has: page.getByText('라벨 일괄 변경', { exact: true }) }).filter({ has: page.getByRole('button', { name: /라벨 해제/ }) }).last();
    await menu.getByRole('button', { name: '달력', exact: true }).click();
    await wait(2500);
    // 다중 선택 모드가 남아 있으면 끈다 (다음 점검이 줄 단추를 눌러야 한다)
    await page.getByTitle('더보기 메뉴').click();
    const off = page.getByRole('button', { name: /다중 선택 모드 종료/ });
    if (await off.count()) await off.click();
    await wait(400);
    await closeAll();
    const stored = await storedEvents(D.bulk);
    const shown = await eventRows().allInnerTexts();
    const bad = stored.filter((e) => (e.labelIds || []).includes('ev_3') || /이월/.test(e.label || ''));
    assert(bad.length === 0, `옛 이월 라벨이 남음: ${JSON.stringify(stored.map((e) => ({ c: e.content, label: e.label, ids: e.labelIds })))}`);
    assert(!shown.some((t) => /이월/.test(t)), `화면에 이월 칩: ${shown.map((t) => t.replace(/\s+/g, ' ')).join(' / ')}`);
  });

  await check('기간 묶음의 한 날을 지웠다가 휴지통에서 되살리면 그날로, 묶음 표시(groupId)째 돌아온다', async () => {
    await goDay(D.trash);
    const row = eventRows().filter({ hasText: '되살릴 기간' });
    await row.hover();
    await row.getByTitle('일정 삭제').click();
    await wait(800);
    await page.getByRole('button', { name: /이 날짜의 일정만 삭제/ }).click();
    await wait(2000);
    const afterDel = await storedEvents(D.trash);
    await page.getByRole('button', { name: '휴지통', exact: true }).first().click();
    await wait(1500);
    const item = page.locator('div', { hasText: '되살릴 기간' }).filter({ has: page.getByRole('button', { name: '복원', exact: true }) }).last();
    await item.getByRole('button', { name: '복원', exact: true }).click();
    await wait(2500);
    await closeAll();
    const back = (await storedEvents(D.trash)).find((e) => e.id === 'fx_tr_group');
    assert(!afterDel.some((e) => e.id === 'fx_tr_group') && afterDel.some((e) => e.id === 'fx_tr_keep'), '지우기가 잘못됨');
    assert(back && back.groupId === 'group_fx_trash', `되살린 것: ${JSON.stringify(back)}`);
    assert((await storedEvents(D.trash)).some((e) => e.id === 'fx_tr_keep'), '곁의 일정이 사라짐');
  });

  await check('메모를 지웠다가 휴지통에서 되살리면 라벨·즐겨찾기째 돌아온다', async () => {
    await goScope(5);
    await page.getByRole('button', { name: /전체 메모/ }).click();
    await wait(600);
    const M = `되살릴 메모 ${Date.now() % 10000}`;
    await page.getByRole('button', { name: /새 메모/ }).click();
    await wait(600);
    const ta = page.getByPlaceholder(/자유롭게 생각을 기록해보세요/);
    await ta.fill(M);
    await ta.press('Control+s');
    await wait(1500);
    await closeAll();
    const card = page.locator('[data-focus-key^="memo"]', { hasText: M }).first();
    await card.getByTitle('즐겨찾기').click();
    await wait(1200);
    await card.hover();
    await card.getByTitle('삭제').click();
    await wait(1500);
    const gone = await page.locator('[data-focus-key^="memo"]', { hasText: M }).count();
    await page.getByRole('button', { name: '휴지통', exact: true }).first().click();
    await wait(1500);
    await page.locator('div', { hasText: M }).filter({ has: page.getByRole('button', { name: '복원', exact: true }) }).last().getByRole('button', { name: '복원', exact: true }).click();
    await wait(2500);
    await closeAll();
    await page.getByRole('button', { name: /즐겨찾기/ }).first().click();
    await wait(800);
    const back = await page.locator('[data-focus-key^="memo"]', { hasText: M }).count();
    assert(gone === 0, '지운 메모가 남아 있음');
    assert(back === 1, '되살린 메모가 ⭐ 즐겨찾기에 없음');
  });

  await check('이월: 어제 못 끝낸 이월 일정은 오늘로 옮겨 오고, 끝낸 것·이월을 끈 것은 어제에 남는다', async () => {
    await goScope(1);
    await page.keyboard.press('Control+Space');
    await wait(1500);
    // 이월은 앱을 열 때 돈다. 새로 연다.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await page.getByRole('heading', { name: '수업' }).first().waitFor({ timeout: 40000 });
    await until(async () => (await storedEvents(TODAY)).some((e) => e.content === '어제 못 끝낸 이월'), 15000, 500);
    const today = await storedEvents(TODAY);
    const yest = await storedEvents(YESTERDAY);
    const t = (list, c) => list.some((e) => e.content === c);
    assert(t(today, '어제 못 끝낸 이월') && !t(yest, '어제 못 끝낸 이월'), `못 끝낸 이월: 오늘 ${t(today, '어제 못 끝낸 이월')} / 어제 ${t(yest, '어제 못 끝낸 이월')}`);
    assert(t(yest, '어제 끝낸 이월') && !t(today, '어제 끝낸 이월'), '끝낸 이월이 옮겨짐');
    assert(t(yest, '이월 끈 일정') && !t(today, '이월 끈 일정'), '이월을 끈 일정이 옮겨짐');
    assert((await rowText('어제 못 끝낸 이월')) === 1, '오늘 화면에 이월 일정이 한 건이 아님');
  });

  await check('그룹 공간에서 쓴 기록·메모는 개인 공간에 보이지 않는다', async () => {
    const sel = page.locator('header select');
    if ((await sel.count()) === 0) return '그룹이 없어 건너뜀';
    const gid = (await sel.locator('option').evaluateAll((os) => os.map((o) => o.value))).find((v) => v);
    await sel.selectOption(gid);
    await wait(1500);
    await goDay(D.jrTabs);
    await addJournalBtn().click();
    await wait(600);
    const box = page.locator('[aria-label="기록 쓰기"]').last().getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await box.fill('그룹 공간 기록');
    await box.press('Control+s');
    await wait(1800);
    await closeAll();
    await sel.selectOption('');
    await wait(1500);
    const inPersonal = await page.locator('[data-focus-key^="journal"]', { hasText: '그룹 공간 기록' }).count();
    const g = (await storedJournals(D.jrTabs, gid)).some((e) => e.content === '그룹 공간 기록');
    const pStored = (await storedJournals(D.jrTabs)).some((e) => e.content === '그룹 공간 기록');
    assert(g && !pStored && inPersonal === 0, `그룹 ${g} / 개인 저장 ${pStored} / 개인 화면 ${inPersonal}`);
  });

  await check('점검 동안 페이지 오류가 없다', async () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  });
  await ctx.close();
}

// ═════════════════════════════ 휴대폰 (390) ═════════════════════════════
if (ONLY !== 'pc') {
  const { ctx, p } = await openApp({ width: 390, height: 844 }, { hasTouch: true, isMobile: true });
  page = p;
  tag = '휴대폰';
  const pageErrors = [];
  page.on('pageerror', (e) => {
    if (/Firestore\/(Write|Listen)\/channel/.test(e.message)) return;
    pageErrors.push(e.message);
  });
  const tab = (name) => page.locator('nav').last().getByText(name, { exact: true });

  await check('새 일정 칸이 화면을 덮고, 저장·닫기 뒤 목록에 생긴다', async () => {
    await goDate(D.long);
    await addEventBtn().click();
    await wait(800);
    const box = page.getByPlaceholder(EVENT_PH);
    const b = await box.boundingBox();
    await box.fill('휴대폰 새 일정');
    await page.getByRole('button', { name: '저장', exact: true }).last().click();
    await wait(1800);
    await page.getByRole('button', { name: '닫기', exact: true }).last().click();
    await wait(800);
    assert(b && b.width > 250, `입력칸 폭 ${b?.width}`);
    assert((await rowText('휴대폰 새 일정')) > 0, '목록에 없음');
  });

  await check('휴대폰 뒤로가기로 쓰는 칸만 닫히고 앱은 그대로다', async () => {
    await eventRows().filter({ hasText: '휴대폰 새 일정' }).click();
    await wait(800);
    const opened = await page.getByPlaceholder(EVENT_PH).count();
    await page.goBack();
    await wait(1000);
    const still = await page.getByPlaceholder(EVENT_PH).count();
    assert(opened > 0, '칸이 안 열림');
    assert(still === 0, '뒤로가기로 칸이 닫히지 않음');
    assert(page.url().startsWith(SITE.replace(/\/$/, '')), '앱을 나감');
  });

  await check('아래 탭으로 월간에 가서 일정을 누르면 고칠 칸이 열린다', async () => {
    await tab('월간').click();
    await wait(2000);
    await goDate(D.ids);
    const ev = page.locator('[title="클릭하여 상세 보기"]').first();
    await ev.waitFor({ timeout: 8000 });
    const b = await ev.boundingBox();
    await ev.click({ position: { x: b.width - 3, y: b.height / 2 } });
    await wait(900);
    const heading = await page.getByRole('heading', { name: '일정 수정' }).count();
    await closeAll();
    assert(heading > 0, '일정 수정 칸이 안 열림');
  });

  await check('하루 화면의 기록 카드를 눌러 고치고 저장할 수 있다', async () => {
    await tab('하루').click();
    await wait(1500);
    await goDate(D.long);
    await addJournalBtn().click();
    await wait(800);
    const ta = page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/);
    await ta.fill('휴대폰 기록');
    await page.getByRole('button', { name: '저장', exact: true }).last().click();
    await wait(1800);
    await page.getByRole('button', { name: '닫기', exact: true }).last().click();
    await wait(800);
    // 카드 왼쪽 위는 접기·차례 단추다. 글을 누른다.
    await page.locator('[data-focus-key^="journal"]', { hasText: '휴대폰 기록' }).first().getByText('휴대폰 기록').click();
    await wait(800);
    const v = await page.getByPlaceholder(/오늘 있었던 일을 기록해보세요/).inputValue();
    await closeAll();
    assert(v === '휴대폰 기록', `열린 칸의 글 '${v}'`);
  });

  await check('알림장·출석부 칸이 화면 폭 안에 들어오고 저장된다', async () => {
    await page.getByRole('button', { name: '📢 알림장' }).click();
    await wait(1500);
    const box = page.getByLabel('알림장 내용');
    await box.fill('휴대폰 알림장');
    await page.getByRole('button', { name: '저장', exact: true }).last().click();
    await wait(2000);
    const over1 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await page.getByRole('button', { name: '닫기', exact: true }).last().click();
    await wait(600);
    await page.getByRole('button', { name: '📋 출석부' }).click();
    await wait(2000);
    const over2 = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    const rows = await page.locator('[data-attendance-num]').count();
    await page.getByRole('button', { name: '닫기', exact: true }).last().click();
    await wait(600);
    const saved = await getDoc(doc(db, 'users', uid, 'notices', D.long));
    assert(over1 <= 1 && over2 <= 1, `가로 넘침 알림장 ${over1}px, 출석부 ${over2}px`);
    assert(saved.exists() && saved.data().lines.includes('휴대폰 알림장'), '알림장이 저장되지 않음');
    return `출석부 학생 줄 ${rows}개`;
  });

  await check('⋮ 메뉴 맨 아래 항목(앱 설치)까지 닿는다', async () => {
    await page.getByTitle('더보기 메뉴').click();
    await wait(400);
    const last = page.getByRole('button', { name: /앱 설치하기/ });
    await last.scrollIntoViewIfNeeded();
    const b = await last.boundingBox();
    await page.keyboard.press('Escape');
    assert(b && b.y + b.height <= 844, `맨 아래 항목 위치 ${b?.y}`);
  });

  await check('다중 선택: 일정 두 개를 골라 완료하면 모드가 끝난다', async () => {
    await goDate(D.ids);
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /다중 선택 모드 켜기/ }).click();
    await wait(600);
    const rows = eventRows();
    const n = await rows.count();
    for (let i = 0; i < Math.min(2, n); i++) await rows.nth(i).click();
    await wait(300);
    const bar = await page.getByText('선택됨').count();
    await page.getByTitle('선택 일정 일괄 완료 처리').click();
    await wait(2000);
    const barAfter = await page.getByText('선택됨').count();
    assert(bar > 0 && barAfter === 0, `선택 막대 전 ${bar} / 후 ${barAfter}`);
  });

  await check('사용 설명서: 분류 → 기능 → 사용 예, 가로로 넘치지 않는다', async () => {
    await page.getByTitle('더보기 메뉴').click();
    await page.getByRole('button', { name: /사용 설명서/ }).first().click();
    await wait(1200);
    await page.locator('[data-help-category="classroom"]').click();
    await page.locator('[data-help-topic="attendance"]').click();
    await wait(300);
    const ex = await page.locator('section[aria-labelledby="help-example-heading"] li').count();
    const over = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    await closeAll();
    assert(ex > 0 && over <= 1, `사용 예 ${ex}줄, 넘침 ${over}px`);
  });

  await check('점검 동안 페이지 오류가 없다', async () => {
    assert(pageErrors.length === 0, pageErrors.slice(0, 3).join(' | '));
  });
  await ctx.close();
}

await browser.close();
const fails = results.filter((r) => !r.ok);
console.log(`\n결과: ${results.length - fails.length}/${results.length} 통과`);
fs.writeFileSync(`${OUT}/result.json`, JSON.stringify(results, null, 2));
process.exit(0);
