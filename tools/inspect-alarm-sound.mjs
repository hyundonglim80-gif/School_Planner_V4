// tools/inspect-alarm-sound.mjs
//
// 일정 알림 소리 (2026-10-08) - 실제 크롬으로 본다 (PC 1400px, teacher).
//   - 오늘 일정에 1분 전 알림을 심고 앱을 열면 ⏰ 알림 창 + 소리(window.__spAlarmSoundCount)
//   - 3초마다 되풀이 / '🔇 소리 끄기'를 누르면 멈추고 창은 남는다 / 확인을 누르면 창이 닫힌다
//   - 서버의 그 일정에 alarmTriggered
// 점검이 심은 일정은 끝에 되돌린다(그날 문서를 통째로 원래대로).
//
//   npm run emu / node tools/serve-both.mjs / npm run seed / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-alarm-sound.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator, deleteDoc, doc, getDocFromServer, setDoc } from 'firebase/firestore';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'inspect-alarm');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const read = async (r) => {
  const s = await getDocFromServer(r);
  return s.exists() ? s.data() : null;
};
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
const at = new Date(now.getTime() - 60_000);
const alarmTime = `${today}T${pad(at.getHours())}:${pad(at.getMinutes())}`;
const dayRef = doc(db, 'users', user.uid, 'events', today);
const before = await read(dayRef);
const ID = 'ev_alarm_sound_probe';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const errors = [];
try {
  const list = Array.isArray(before?.eventList) ? before.eventList : [];
  await setDoc(dayRef, {
    ...(before || {}),
    eventList: [...list, { id: ID, content: '알림 소리 점검', text: '알림 소리 점검', completed: false, time: alarmTime, alarmTriggered: false }],
    updatedAt: Date.now(),
  });

  const ctx = await browser.newContext({ viewport: { width: 1400, height: 900 } });
  const page = await ctx.newPage();
  page.setDefaultTimeout(15000);
  page.on('pageerror', (e) => errors.push(e.message.slice(0, 160)));
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('button', { name: '하루', exact: true }).first().click({ timeout: 40000 }); // 누르기 = 소리 장치 깨우기

  const mute = page.locator('[data-alarm-mute]');
  await mute.waitFor({ timeout: 40000 });
  check('⏰ 알림 창이 뜬다 (1분 전 알림)', await page.getByText('알림 소리 점검').first().isVisible());
  const count = () => page.evaluate(() => window.__spAlarmSoundCount || 0);
  const c1 = await count();
  check('  창이 뜨면 소리가 난다', c1 >= 1, `count=${c1}`);
  await page.waitForTimeout(3500);
  const c2 = await count();
  check('  3초마다 되풀이한다', c2 > c1, `${c1} → ${c2}`);
  const state = await page.evaluate(() => {
    const w = window;
    return w.AudioContext ? 'ok' : 'no-audio';
  });
  check('  소리 장치(Web Audio)가 있다', state === 'ok');

  await mute.click({ force: true }); // 창이 깜빡이며 커졌다 작아져(scale) 멈추기를 기다리면 끝나지 않는다
  const c3 = await count();
  await page.waitForTimeout(3500);
  const c4 = await count();
  check("'🔇 소리 끄기' → 소리가 멈추고 창은 남는다", c4 === c3 && (await page.getByText('알림 소리 점검').first().isVisible()) && !(await mute.isVisible()), `${c3} → ${c4}`);

  await page.getByRole('button', { name: /확 인/ }).click({ force: true });
  await page.waitForTimeout(400);
  check('확인 → 창이 닫힌다', !(await page.getByRole('button', { name: /확 인/ }).isVisible()));
  const c5 = await count();
  await page.waitForTimeout(3500);
  check('  닫은 뒤에는 울리지 않는다', (await count()) === c5);

  const saved = await until(() => read(dayRef), (d) => d?.eventList?.find((e) => e.id === ID)?.alarmTriggered === true);
  check('서버의 그 일정에 alarmTriggered', saved?.eventList?.find((e) => e.id === ID)?.alarmTriggered === true);
  check('페이지 오류 없음', errors.length === 0, errors.join(' | '));
  await ctx.close();
} catch (e) {
  check('점검이 끝까지 돌았다', false, String(e?.message || e).slice(0, 300));
} finally {
  if (before) await setDoc(dayRef, before);
  else await deleteDoc(dayRef);
  await browser.close();
}
const ok = results.filter(Boolean).length;
console.log(`\n${ok}/${results.length} 통과`);
process.exit(ok === results.length ? 0 : 1);
