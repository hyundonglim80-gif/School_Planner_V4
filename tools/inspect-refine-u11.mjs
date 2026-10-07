// tools/inspect-refine-u11.mjs
//
// 19번 U11 일정 라벨 '구글 캘린더' - 바뀐 부분만 실제 크롬으로 본다 (docs/ROADMAP-REFINE.md U11, PC 1400px, teacher).
// 클라우드 컨테이너는 googleapis를 막으므로 구글 캘린더 API를 흉내 낸다(page.route, 메모리에 일정을 든다).
//   - 라벨 관리 일정 탭에 '구글 캘린더' 체크(달력과 다름) / 일정 칸에 '📅 구글 캘린더로 보냄'
//   - '달력' 라벨에 켜 둔 채 새 일정 저장 → 큐 → SP(work)에 sp_id·sp_auto로 들어간다, 큐가 빈다, 켜지 않은 라벨 일정은 안 간다
//   - 완료 → 구글 글 앞 ✅ (PUT)
//   - 토큰이 없을 때 지우기 → 머리줄 '📅 못 보낸 날 1' → (로그인한 셈 치고) 누르면 DELETE, 단추가 사라진다
// 점검이 바꾼 일정·설정·큐·휴지통은 끝에 되돌린다.
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-refine-u11.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore,
  connectFirestoreEmulator,
  collection,
  deleteDoc,
  doc,
  getDocFromServer,
  getDocsFromServer,
  setDoc,
} from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const MARK = '점검U11';
const DAY = '2026-10-27';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-u11');
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
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const until = async (fn, timeout = 12000) => {
  const t0 = Date.now();
  let v = await fn();
  while (!v && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 300));
    v = await fn();
  }
  return v;
};

const gcalRef = uref('settings', 'v4_gcal');
const dayRef = uref('events', DAY);
const queueCol = collection(db, 'users', user.uid, 'v4_gcalQueue');
const before = { gcal: await read(gcalRef), day: await read(dayRef) };
const queueBefore = new Set((await getDocsFromServer(queueCol)).docs.map((d) => d.id));
const trashBefore = new Set((await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs.map((d) => d.id));

// ── 흉내 낸 구글 캘린더 ──
const gEvents = new Map(); // id → event
const calls = [];
let nextId = 1;
let tokenOk = true;
const json = (r, status, body) =>
  r.fulfill({ status, contentType: 'application/json', headers: { 'access-control-allow-origin': '*' }, body: body === undefined ? '' : JSON.stringify(body) });

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
await ctx.addInitScript(() => sessionStorage.setItem('google_api_token', 'fake-token'));
await ctx.route('https://oauth2.googleapis.com/tokeninfo**', (r) => json(r, tokenOk ? 200 : 400, {}));
await ctx.route('https://www.googleapis.com/calendar/v3/**', async (r) => {
  const req = r.request();
  const url = new URL(req.url());
  const method = req.method();
  if (method === 'OPTIONS') return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*', 'access-control-allow-headers': '*', 'access-control-allow-methods': '*' } });
  calls.push(`${method} ${url.pathname.replace('/calendar/v3', '')}`);
  if (url.pathname.endsWith('/users/me/calendarList')) return json(r, 200, { items: [{ id: 'cal_work', summary: 'SP(work)' }] });
  const m = /\/calendars\/([^/]+)\/events(?:\/([^/]+))?$/.exec(url.pathname);
  if (!m) return json(r, 404, { error: { message: 'no' } });
  const id = m[2];
  if (method === 'GET') {
    const filters = url.searchParams.getAll('privateExtendedProperty').map((f) => f.split('='));
    const items = [...gEvents.values()].filter((ev) => filters.every(([k, v]) => ev.extendedProperties?.private?.[k] === v));
    return json(r, 200, { items });
  }
  if (method === 'POST') {
    const ev = { ...JSON.parse(req.postData() || '{}'), id: `g${nextId++}` };
    gEvents.set(ev.id, ev);
    return json(r, 200, ev);
  }
  if (method === 'PUT') {
    if (!gEvents.has(id)) return json(r, 404, { error: { message: 'gone' } });
    const ev = { ...JSON.parse(req.postData() || '{}'), id };
    gEvents.set(id, ev);
    return json(r, 200, ev);
  }
  if (method === 'DELETE') {
    gEvents.delete(id);
    return r.fulfill({ status: 204, headers: { 'access-control-allow-origin': '*' } });
  }
  return json(r, 400, {});
});
const page = await ctx.newPage();
page.on('dialog', (d) => d.accept());
const errors = [];
page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));

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
  await page.waitForTimeout(1200);
}
const mine = () => [...gEvents.values()].filter((ev) => String(ev.summary).includes(MARK));

try {
  // '달력'(ev_1)에 '구글 캘린더'를 켜 두고, 그날 켜지 않은 라벨(이월 ev_3)의 일정 하나를 심는다
  await setDoc(gcalRef, { labels: { ev_1: true }, updatedAt: Date.now() });
  const seeded = { id: 'ev_u11_other', content: `${MARK} 안 보낼 일`, completed: false, label: '이월', labelIds: ['ev_3'], attachments: [], linkedItems: [] };
  await setDoc(dayRef, { ...(before.day || {}), eventList: [...(before.day?.eventList || []), seeded], updatedAt: Date.now() });

  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click();
  await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
  await page.waitForTimeout(1200);

  // ── 라벨 관리: '구글 캘린더' 체크 ──
  await page.getByTitle('더보기 메뉴').click();
  await page.getByRole('button', { name: /통합 라벨 관리/ }).click();
  const dlg = page.locator('[role=dialog]', { hasText: '통합 라벨' }).last();
  await dlg.locator('[data-gcal-label="달력"]').waitFor({ timeout: 10000 });
  await page.waitForTimeout(800);
  check("라벨 관리 일정 탭: '달력' 줄에 '구글 캘린더' 체크가 켜져 있다, 다른 라벨은 꺼짐",
    (await dlg.locator('[data-gcal-label="달력"]').isChecked()) && !(await dlg.locator('[data-gcal-label="이월"]').isChecked()));
  await page.keyboard.press('Escape');
  await page.waitForTimeout(500);

  // ── 새 일정 저장 → 보낸다 ──
  await pickDate(DAY);
  await page.getByRole('button', { name: '일정 추가' }).click();
  await page.getByPlaceholder('새로운 일정을 입력하세요...').fill(`${MARK} 공문`);
  const drawer = page.locator('aside', { has: page.getByPlaceholder('새로운 일정을 입력하세요...') }).first();
  const chip = drawer.getByRole('button', { name: '달력', exact: true }).first();
  // 맨 위 라벨이라 미리 골라져 있을 수 있다 - 꺼져 있으면 켠다
  await page.waitForTimeout(300);
  if (!(await drawer.locator('[data-event-gcal]').count())) await chip.click();
  await drawer.locator('[data-event-gcal]').waitFor({ timeout: 5000 });
  check("일정 칸에 '📅 구글 캘린더로 보냄'", /구글 캘린더로 보냄/.test(await drawer.locator('[data-event-gcal]').innerText()));
  await page.getByRole('button', { name: '저장', exact: true }).click();
  const sent = await until(() => mine().find((ev) => ev.summary.includes('공문')));
  const priv = sent?.extendedProperties?.private || {};
  check('저장 → SP(work)에 sp_auto·sp_id·그날 날짜로 들어간다', !!sent && priv.sp_auto === 'true' && !!priv.sp_id && priv.dateStr === DAY && sent.start?.date === DAY, JSON.stringify(priv));
  check('켜지 않은 라벨(이월) 일정은 보내지 않는다', !mine().some((ev) => ev.summary.includes('안 보낼 일')));
  const qEmpty = await until(async () => (await getDocsFromServer(queueCol)).docs.filter((d) => !queueBefore.has(d.id)).length === 0);
  check('보낸 날은 큐에서 지워진다', !!qEmpty);

  // ── 완료 → ✅ ──
  const card = page.locator('div', { hasText: `${MARK} 공문` }).filter({ has: page.locator('[title^="클릭하여 완료"]') }).last();
  await card.locator('[title^="클릭하여 완료"]').first().click();
  const done = await until(() => mine().find((ev) => ev.summary.includes('공문') && /✅/.test(ev.summary)));
  check('완료 → 구글 글 앞 ✅ (PUT)', !!done && done.extendedProperties.private.completed === 'true' && calls.some((c) => c.startsWith('PUT')), done?.summary);

  // ── 토큰 없음 → 못 보낸 날 단추 ──
  tokenOk = false;
  await page.evaluate(() => sessionStorage.removeItem('google_api_token'));
  await page.locator('[title="일정 삭제"]').count();
  const row = page.locator('div', { hasText: `${MARK} 공문` }).filter({ has: page.locator('[title="일정 삭제"]') }).last();
  await row.hover();
  await row.locator('[title="일정 삭제"]').first().click();
  const pending = page.locator('[data-gcal-pending]');
  await pending.waitFor({ timeout: 15000 });
  check("토큰이 없을 때 지우기 → 머리줄 '📅 못 보낸 날 1', 구글에는 아직 남음", (await pending.getAttribute('data-gcal-pending')) === '1' && mine().some((ev) => ev.summary.includes('공문')));
  // 로그인한 셈 치고 누른다
  tokenOk = true;
  await page.evaluate(() => sessionStorage.setItem('google_api_token', 'fake-token'));
  await pending.click();
  const gone = await until(() => !mine().some((ev) => ev.summary.includes('공문')));
  check('단추를 누르면 DELETE, 단추가 사라진다', !!gone && (await until(async () => (await pending.count()) === 0)));
  check('페이지 오류 없음', errors.length === 0, errors.join(' / '));
} catch (e) {
  check('점검이 끝까지 돌았다', false, e.message.split('\n')[0]);
} finally {
  await new Promise((r) => setTimeout(r, 2500));
  await browser.close();
  if (before.gcal) await setDoc(gcalRef, before.gcal);
  else await deleteDoc(gcalRef);
  if (before.day) await setDoc(dayRef, before.day);
  else await deleteDoc(dayRef);
  for (const d of (await getDocsFromServer(queueCol)).docs) if (!queueBefore.has(d.id)) await deleteDoc(d.ref);
  for (const d of (await getDocsFromServer(collection(db, 'users', user.uid, 'trash'))).docs) if (!trashBefore.has(d.id)) await deleteDoc(d.ref);
  console.log('  구글 호출:', calls.join(', '));
}

const pass = results.filter(Boolean).length;
console.log(`\n${pass}/${results.length} 통과`);
process.exit(pass === results.length ? 0 : 1);
