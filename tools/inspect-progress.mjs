// tools/inspect-progress.mjs
//
// 진도 관리(docs/ROADMAP.md 5번)를 실제 크롬으로 확인한다. 단계마다 항목을 더한다.
//
// 5-1 수업이 없는 날(lib/classDays) - 시간표 적용이 진도 세기와 같은 규칙으로 건너뛰는가.
//     점검 주(2027-03-08 월 ~ 03-12 금)에 자료를 심고 시간표 설정에서 그 주에 적용한 뒤 서버의 수업 문서를 본다.
//     월: 보통 날 → 과목 / 화: 공휴일(V3 개인 공휴일) → 비움 / 수: V3 수업X 라벨(labelIds만) → 비움 /
//     목: '휴업'이 든 일정 → 비움 / 금: 수업X 라벨인데 일정에서 끈 것(skip:false) → 과목.
//     예전에는 화·수에도 과목이 채워졌다(공휴일은 holidays/{연도}로 옮겨 간 뒤로, V3 라벨은 처음부터 안 봤다).
//
//   npm run emu / node tools/serve-both.mjs / VITE_USE_EMULATOR=1 npm run build
//   node tools/inspect-progress.mjs
import { chromium } from 'playwright';
import { initializeApp } from 'firebase/app';
import {
  getFirestore,
  connectFirestoreEmulator,
  doc,
  getDocFromServer,
  setDoc,
  deleteDoc,
  deleteField,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const V4 = `${process.env.SITE || 'http://localhost:4190'}/School_Planner_V4/`;
const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'progress');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;
const ref = (...p) => doc(db, 'users', uid, ...p);

const results = [];
const check = (name, ok, detail = '') => {
  results.push(ok);
  console.log(`${ok ? '✔' : '✘'} ${name}${detail ? '  ' + detail : ''}`);
};

// ── 점검 자료 ──────────────────────────────────────────────────────
const WEEK = ['2027-03-08', '2027-03-09', '2027-03-10', '2027-03-11', '2027-03-12'];
const ttRef = ref('settings', 'timetable_v5');
const holRef = ref('settings', 'holidays');
const oldTimetable = (await getDocFromServer(ttRef)).data() || null;
const labels = (await getDocFromServer(ref('settings', 'labels'))).data()?.eventLabels || [];
const skipLabel = labels.find((l) => l.isSkip ?? l.skip);
if (!skipLabel) throw new Error('수업X 라벨이 없습니다 - npm run seed');

const day = { 1: '국어', 2: '수학' };
await setDoc(ttRef, {
  templates: { '점검 시간표': { names: ['1교시', '2교시'], data: { mon: day, tue: day, wed: day, thu: day, fri: day } } },
  currentNames: ['1교시', '2교시'],
  // 통째로 쓴다 (merge면 원래 템플릿이 남아 그것이 골라진다). 방학 기간은 그대로
  ...(oldTimetable?.semesterConfig ? { semesterConfig: oldTimetable.semesterConfig } : {}),
  updatedAt: Date.now(),
});
await setDoc(holRef, { map: { [WEEK[1]]: '점검 공휴일' } }, { merge: true });
const ev = (id, extra) => ({ eventList: [{ id, completed: false, linkedItems: [], attachments: [], ...extra }], updatedAt: Date.now() });
await setDoc(ref('events', WEEK[2]), ev('chk_v3skip', { content: '점검 운동회', labelIds: [skipLabel.id] }));
await setDoc(ref('events', WEEK[3]), ev('chk_rest', { content: '점검 재량휴업일' }));
await setDoc(ref('events', WEEK[4]), ev('chk_off', { content: '점검 체험학습', label: skipLabel.name, skip: false }));
for (const d of WEEK) await deleteDoc(ref('schedules', d));

// ── 시간표 설정에서 그 주에 적용 ─────────────────────────────────────
const browser = await chromium.launch({ channel: 'chrome', headless: true });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
page.on('dialog', (d) => d.accept());
await page.goto(V4, { waitUntil: 'domcontentloaded' });
await page.getByRole('heading', { name: '일정' }).first().waitFor({ timeout: 40000 });
await page.waitForTimeout(1500);
await page.getByTitle('더보기 메뉴').click();
await page.getByRole('button', { name: /시간표 적용/ }).click();
await page.getByRole('button', { name: /템플릿 클라우드 저장/ }).waitFor({ timeout: 20000 });
await page.waitForTimeout(1000);
const range = page.getByText('적용 기간:').locator('..').locator('input[type="date"]');
await range.nth(0).fill(WEEK[0]);
await range.nth(1).fill(WEEK[4]);
await page.getByRole('button', { name: /이 기간에 시간표 일괄 덮어쓰기/ }).click();
const toast = page.getByText(/시간표 적용 완료/).first();
await toast.waitFor({ timeout: 20000 });
check('적용 안내: 수업일 2일, 제외 3일', /수업일 2일, 제외 3일/.test(await toast.innerText()), await toast.innerText());

const subjects = [];
for (const d of WEEK) {
  const p = (await getDocFromServer(ref('schedules', d))).data()?.periods || {};
  subjects.push(`${p[1]?.subject || ''}/${p[2]?.subject || ''}`);
}
const want = ['국어/수학', '/', '/', '/', '국어/수학'];
const names = ['월 보통 날', '화 공휴일(V3 개인)', '수 V3 수업X 라벨', "목 '휴업' 일정", '금 일정에서 끈 수업X'];
WEEK.forEach((d, i) => check(`${names[i]} → ${want[i] === '/' ? '비움' : '과목'}`, subjects[i] === want[i], `${d} ${subjects[i]}`));
await page.screenshot({ path: 'tools/report/progress-apply.png' });
await browser.close();

// ── 되돌리기 ─────────────────────────────────────────────────────
for (const d of WEEK) {
  await deleteDoc(ref('schedules', d));
  await deleteDoc(ref('events', d));
}
await setDoc(holRef, { map: { [WEEK[1]]: deleteField() } }, { merge: true });
if (oldTimetable) await setDoc(ttRef, oldTimetable);
else await deleteDoc(ttRef);

const failed = results.filter((r) => !r).length;
console.log(`\n${results.length - failed}/${results.length} 통과`);
process.exit(failed ? 1 : 0);
