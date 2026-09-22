// tools/inspect-idb.mjs
//
// V4가 오프라인 저장소(IndexedDB)를 만드는지 본다.
//
// 왜 이것을 재나: '사용 기록을 지우면 화면이 빈다'는 사고는 재현이 안 된다.
// 헤드리스 크롬에서 CDP로 지우면 IndexedDB까지 깨끗이 지워져서, 실제 브라우저가
// '열린 탭이 붙잡은 DB만 못 지우고 넘어가는' 반쪽 상태가 만들어지지 않는다
// (inspect-clear-live / inspect-partial-clear 둘 다 통과해 버린다).
//
// 증상을 못 만들면 증상으로는 확인할 수 없다. 대신 '사고가 일어나는 조건'을 잰다.
// 그 사고는 Firestore의 IndexedDB가 있어야만 일어난다. 하나도 안 만들면 일어날 수 없다.
//
// ⚠️ 2026-09-22에 이 도구로 알아낸 것: 에뮬레이터에 붙은 빌드
//    (VITE_USE_EMULATOR=1, connectFirestoreEmulator)는 오프라인 저장소를 켜 두어도
//    Firestore IndexedDB를 아예 만들지 않는다. 로그인하고 오늘 일정까지 읽어 온
//    상태에서 재어도 firebase-heartbeat-database / firebaseLocalStorageDb 둘뿐이다.
//    즉 에뮬레이터 하네스는 이미 '저장소 없는 앱'을 재고 있었다. 세 세션에 걸친
//    재현 시도가 전부 통과해 버린 까닭이 이것이다. 이 사고는 하네스로는 볼 수 없다.
//
//   VITE_USE_EMULATOR=1 npm run build && node tools/serve-both.mjs
//   node tools/inspect-idb.mjs
import { chromium } from 'playwright';

const V4 = (process.env.SITE || 'http://localhost:4190') + '/School_Planner_V4/';

const browser = await chromium.launch({ channel: 'chrome', headless: true });
const ctx = await browser.newContext({ viewport: { width: 1280, height: 950 } });
const page = await ctx.newPage();

const logs = [];
page.on('console', (m) => logs.push(`${m.type()}: ${m.text().slice(0, 200)}`));

await page.goto(V4, { waitUntil: 'domcontentloaded' });
const ok = await page
  .getByRole('heading', { name: '일정' })
  .waitFor({ timeout: 40000 })
  .then(() => true)
  .catch(() => false);
// 구독이 붙고 캐시가 만들어질 시간을 넉넉히 준다
await page.waitForTimeout(12000);

const { dbs, loggedIn } = await page.evaluate(async () => {
  const names = ('databases' in indexedDB)
    ? (await indexedDB.databases()).map((d) => d.name || '(이름없음)')
    : ['(이 브라우저는 목록을 못 준다)'];
  // 로그인까지 갔는지 함께 본다. 로그인 전이면 Firestore를 읽지 않으므로
  // 저장소가 없는 것이 당연해서, 재 봐야 아무 뜻이 없다.
  return { dbs: names, loggedIn: document.body.innerText.includes('로그아웃') };
});

const firestoreDbs = dbs.filter((n) => /firestore/i.test(n));

console.log(`앱 화면: ${ok ? '떴다' : '못 떴다'} / 로그인: ${loggedIn ? '됐다' : '안 됐다 (측정 의미 없음)'}`);
console.log(`IndexedDB 목록: ${dbs.length ? dbs.join(', ') : '(없음)'}`);
console.log(
  firestoreDbs.length
    ? `✘ Firestore 오프라인 저장소가 생겼다 (${firestoreDbs.length}개) — 잠길 수 있는 문이 남아 있다`
    : '✔ Firestore 오프라인 저장소를 하나도 만들지 않았다 — 잠길 문이 없다'
);

const bad = [...new Set(logs.filter((l) => /error|ASSERTION|lease|실패/i.test(l)))];
if (bad.length) {
  console.log('\n── 콘솔 ──');
  bad.slice(0, 10).forEach((l) => console.log('  ' + l));
}

await browser.close();
process.exit(firestoreDbs.length ? 1 : 0);
