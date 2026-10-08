// tools/inspect-push-alarm.mjs
//
// 일정 알림 서버 푸시 - 앱 쪽 (2026-10-08). 실제 크롬, PC 1400px, teacher. 진짜 FCM은 에뮬레이터에 없어
// 에뮬레이터 빌드는 가짜 토큰(emulator-token-pc)을 쓰고, 서비스 워커가 넘기는 메시지는 직접 흘려 넣는다.
//   - 알림이 이미 허용된 기기는 앱이 뜰 때 토큰을 저절로 올린다 (users/{uid}/v4_pushTokens)
//   - 환경설정 '일정 알림 (앱을 닫아도)': 이 기기에서 끄기 → 토큰 문서 지움 / 🔔 이 기기에서 받기 → 다시
//   - 서비스 워커 메시지 'sp4-event-alarm' → 알림 창·소리, 그 일정에 alarmTriggered, 같은 것을 두 번 받아도 한 번
// 심은 것(그날 일정 문서·토큰)은 끝에 되돌린다.
//
//   node tools/inspect-push-alarm.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, collection, deleteDoc, doc, getDocFromServer, getDocsFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-push');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const read = async (r) => {
  const s = await getDocFromServer(r);
  return s.exists() ? s.data() : null;
};
const tokens = async () => (await getDocsFromServer(collection(db, 'users', user.uid, 'v4_pushTokens'))).docs.map((d) => ({ id: d.id, ...d.data() }));
async function until(fn, ok, timeout = 10000) {
  const t0 = Date.now();
  let v = await fn();
  while (!ok(v) && Date.now() - t0 < timeout) {
    await new Promise((r) => setTimeout(r, 300));
    v = await fn();
  }
  return v;
}
const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};
const pad = (n) => String(n).padStart(2, '0');
const now = new Date();
const today = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
const later = new Date(now.getTime() + 3 * 3600_000); // 앱의 20초 확인에는 걸리지 않는 시각 - 푸시 메시지로만 울린다
const time = `${today}T${pad(later.getHours())}:${pad(later.getMinutes())}`;
const dayRef = doc(db, 'users', user.uid, 'events', today);
const before = await read(dayRef);
const beforeTokens = await tokens();
const ID = 'ev_push_probe';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  for (const t of beforeTokens) await deleteDoc(doc(db, 'users', user.uid, 'v4_pushTokens', t.id));
  const list = Array.isArray(before?.eventList) ? before.eventList : [];
  await setDoc(dayRef, { ...(before || {}), eventList: [...list, { id: ID, content: '푸시 점검 일정', text: '푸시 점검 일정', completed: false, time }], updatedAt: Date.now() });

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  await ctx.grantPermissions(['notifications'], { origin: new URL(V4).origin });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 });

  const auto = await until(tokens, (l) => l.length === 1);
  check('알림이 허용된 기기는 앱이 뜰 때 토큰을 저절로 올린다', auto.length === 1 && auto[0].token === 'emulator-token-pc' && auto[0].device === 'pc', JSON.stringify(auto.map((t) => t.token)));

  // 환경설정
  await page.getByRole('button', { name: /더보기|⋮/ }).first().click();
  await page.getByRole('menuitem', { name: /환경설정/ }).first().click().catch(async () => page.getByText('환경설정', { exact: false }).first().click());
  const panel = page.locator('[data-push-alarm]');
  await panel.waitFor();
  check("환경설정 '일정 알림 (앱을 닫아도)' - 받는 중", (await panel.getAttribute('data-push-state')) === 'on');
  await panel.locator('[data-push-off]').click();
  await page.locator('[data-push-alarm][data-push-state="off"]').waitFor();
  const off = await until(tokens, (l) => l.length === 0);
  check('  이 기기에서 끄기 → 토큰 문서가 지워진다', off.length === 0);
  await page.locator('[data-push-on]').click();
  await page.locator('[data-push-alarm][data-push-state="on"]').waitFor();
  const on = await until(tokens, (l) => l.length === 1);
  check('  🔔 이 기기에서 받기 → 다시 올린다', on.length === 1);
  await page.keyboard.press('Escape');

  // 서비스 워커가 넘기는 알림
  const alarm = { type: 'event-alarm', id: ID, content: '푸시 점검 일정', time, path: `users/${user.uid}/events/${today}` };
  const send = () => page.evaluate((a) => navigator.serviceWorker.dispatchEvent(new MessageEvent('message', { data: { type: 'sp4-event-alarm', alarm: a } })), alarm);
  await send();
  await page.locator('[data-alarm-mute]').waitFor();
  check('서비스 워커 메시지 → ⏰ 알림 창', await page.getByText('푸시 점검 일정').first().isVisible());
  check('  소리가 난다', (await page.evaluate(() => window.__spAlarmSoundCount || 0)) >= 1);
  await send();
  await page.waitForTimeout(500);
  check('  같은 알림을 두 번 받아도 하나', (await page.locator('.sp4-alarm-content p').count()) === 1);
  const saved = await until(() => read(dayRef), (d) => d?.eventList?.find((e) => e.id === ID)?.alarmTriggered === true);
  check('  그 일정에 alarmTriggered', saved?.eventList?.find((e) => e.id === ID)?.alarmTriggered === true);
  await page.getByRole('button', { name: /확 인/ }).click({ force: true });
  check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await ctx.close();
} catch (e) {
  check('점검이 끝까지 돌았다', false, String(e?.message || e).slice(0, 300));
} finally {
  if (before) await setDoc(dayRef, before);
  else await deleteDoc(dayRef);
  for (const t of await tokens()) await deleteDoc(doc(db, 'users', user.uid, 'v4_pushTokens', t.id));
  for (const t of beforeTokens) {
    const { id, ...rest } = t;
    await setDoc(doc(db, 'users', user.uid, 'v4_pushTokens', id), rest);
  }
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
