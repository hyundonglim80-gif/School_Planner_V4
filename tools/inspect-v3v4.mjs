// tools/inspect-v3v4.mjs
//
// V3와 V4를 실제 배포와 같은 조건(같은 출처의 하위 경로)에 올려놓고,
// '사용기록 삭제 -> V4 -> V3 -> V4' 한 바퀴를 자동으로 돈다.
//
// 이걸 만든 이유: 라벨과 이월 문제를 쫓으면서 선생님께 매번 화면을 찍어
// 보내 달라고 했다. 두 앱과 에뮬레이터를 다 갖고 있으면서 그랬다.
// 이제 여기서 돈다.
//
//   npm run emu                      (다른 창)
//   node tools/inspect-v3v4.mjs
//
// 준비: tools/serve-both.mjs 가 두 앱을 한 출처에 올려 준다.
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, getDocFromServer, deleteDoc,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const BASE = process.env.SITE || 'http://localhost:4190';
const V4 = `${BASE}/School_Planner_V4/`;
const V3 = `${BASE}/School_Planner_V3/`;

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'v3v4');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const cred = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = cred.user.uid;

const p2 = (n) => String(n).padStart(2, '0');
const now = new Date();
const ds = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const today = ds(now);
const past = ds(new Date(now.getTime() - 4 * 86400000));

const labelsRef = doc(db, 'users', uid, 'settings', 'labels');

/** 선생님 데이터와 같은 모양을 만든다: 라벨은 V3식 id, 일정은 id로만 참조 */
async function setupLikeUser({ cloudLabels }) {
  if (cloudLabels) {
    await setDoc(labelsRef, {
      eventLabels: [
        { id: 'lbl_ev_aaa_111', name: '회의', color: 'blue', isForward: false },
        { id: 'lbl_ev_bbb_222', name: 'ToDo', color: 'orange', isForward: true },
      ],
      updatedAt: Date.now(),
    });
  } else {
    await deleteDoc(labelsRef).catch(() => {});
  }
  await setDoc(doc(db, 'users', uid, 'events', past), {
    eventList: [
      { id: 'ev_todo', content: '교통안전지도사 배치 희망 제출', completed: false, label: 'lbl_ev_bbb_222', labelIds: ['lbl_ev_bbb_222'] },
      { id: 'ev_meet', content: '지난 협의회', completed: false, label: 'lbl_ev_aaa_111', labelIds: ['lbl_ev_aaa_111'] },
    ],
    eventText: '교통안전지도사 배치 희망 제출\n지난 협의회',
    updatedAt: Date.now(),
  });
  await deleteDoc(doc(db, 'users', uid, 'events', today)).catch(() => {});
}

const cloudState = async () => {
  const d = await getDocFromServer(labelsRef);
  return d.exists() ? (d.data().eventLabels || []).map((l) => l.name) : null;
};
const todayHas = async (text) => {
  const d = await getDocFromServer(doc(db, 'users', uid, 'events', today));
  return (d.data()?.eventList || []).some((e) => String(e.content).includes(text));
};

// ⚠️ '화면에 글자가 보이는가'로 이월을 판단하면 안 된다. 월간 화면은 지난
//    날짜도 함께 보여주므로, 옮겨지지 않은 일정도 '보인다'. 오늘 문서에
//    실제로 들어왔는지를 서버에서 확인해야 한다.
async function openV4(browser, tag) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  const page = await ctx.newPage();
  const errs = [];
  page.on('pageerror', (e) => errs.push(e.message.slice(0, 120)));
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.getByRole('heading', { name: '일정' }).waitFor({ timeout: 40000 });
  await page.waitForTimeout(2500);
  await page.getByRole('button', { name: '월간', exact: true }).click();
  await page.waitForTimeout(6000); // 이월이 돌 시간
  const body = await page.locator('body').innerText();
  const out = {
    chips: ['회의', 'ToDo'].filter((n) => body.includes(n)),
    forwarded: await todayHas('교통안전지도사'),
    errors: errs,
  };
  await page.screenshot({ path: `tools/report/v-${tag}.png` });
  await ctx.close();
  return out;
}

async function openV3(ctx) {
  const page = await ctx.newPage();
  await page.goto(V3, { waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(14000);
  await page.close();
}

async function wipe(ctx) {
  const page = await ctx.newPage();
  await page.goto(V4, { waitUntil: 'domcontentloaded' });
  await page.evaluate(async () => {
    localStorage.clear();
    sessionStorage.clear();
    if (indexedDB.databases) {
      for (const d of await indexedDB.databases()) if (d.name) indexedDB.deleteDatabase(d.name);
    }
  });
  await page.close();
}

const show = (tag, r) =>
  console.log(`  ${tag}: 라벨칩 ${JSON.stringify(r.chips)} / 이월 일정 ${r.forwarded ? '보임' : '안 보임'}${r.errors.length ? ` / 오류 ${r.errors.length}` : ''}`);

async function run() {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  let fails = 0;

  // ── 상황 1: 클라우드에 라벨이 있는 정상 상태에서 기기만 비운다 ──
  console.log('\n[상황 1] 클라우드에 라벨 있음 + 기기 비움');
  await setupLikeUser({ cloudLabels: true });
  let ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await wipe(ctx);
  await ctx.close();
  const a = await openV4(browser, '1-after-wipe');
  show('  V4', a);
  if (a.chips.length === 2 && a.forwarded) console.log('  ✔ 기기를 비워도 정상');
  else { console.log('  ✘ 기기를 비우니 깨진다'); fails++; }

  // ── 상황 2: 클라우드에 라벨이 없다 (선생님이 겪은 상태) ──────────
  console.log('\n[상황 2] 클라우드에 라벨 없음 + 기기 비움 (신고된 상태)');
  await setupLikeUser({ cloudLabels: false });
  ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await wipe(ctx);
  await ctx.close();
  const b1 = await openV4(browser, '2-before-v3');
  show('  V4 (V3 열기 전)', b1);
  console.log(`  클라우드 라벨: ${JSON.stringify(await cloudState())}`);

  console.log('  … V3를 연다');
  ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
  await openV3(ctx);
  await ctx.close();
  console.log(`  V3를 연 뒤 클라우드 라벨: ${JSON.stringify(await cloudState())}`);

  const b2 = await openV4(browser, '2-after-v3');
  show('  V4 (V3 연 뒤)', b2);

  if (!b1.forwarded && b2.forwarded) {
    console.log('  ✘ 신고와 같은 증상 재현됨 — V3를 열어야 이월이 보인다');
    fails++;
  } else if (b1.forwarded) {
    console.log('  ✔ V3 없이도 이월이 보인다');
  }

  // ── 상황 3: 라벨을 아예 못 읽어도 이월이 이어지는가 ──────────────
  console.log('\n[상황 3] 라벨 없이도 이미 이월된 일정은 계속 이어지는가');
  await setupLikeUser({ cloudLabels: false });
  await setDoc(doc(db, 'users', uid, 'events', past), {
    eventList: [{ id: 'ev_marked', content: '이미 이월되던 일정', completed: false, forward: true }],
    eventText: '이미 이월되던 일정',
    updatedAt: Date.now(),
  });
  await openV4(browser, '3-marked');
  const moved = await todayHas('이미 이월되던 일정');
  console.log(`  항목에 forward가 적힌 일정이 오늘로 왔나: ${moved ? '왔다' : '안 왔다'}`);
  if (moved) console.log('  ✔ 라벨을 못 읽어도 이어진다');
  else { console.log('  ✘ 라벨이 없으면 끊긴다'); fails++; }

  await browser.close();
  console.log(`\n──────── ${fails === 0 ? '전부 통과' : `${fails}건 실패`} ────────`);
  process.exit(0);
}

run().catch((e) => { console.error(e); process.exit(1); });
