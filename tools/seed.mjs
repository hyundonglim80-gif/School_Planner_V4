// tools/seed.mjs
//
// 점검용 에뮬레이터에 "그럴듯한 한 학년도치" 데이터를 심는다.
// 선생님 실제 계정/데이터는 건드리지 않는다. 전부 에뮬레이터 안에서만 일어난다.
//
//   node tools/seed.mjs
import { initializeApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, collection, writeBatch,
} from 'firebase/firestore';
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword,
} from 'firebase/auth';

const EMAIL = process.env.SEED_EMAIL || 'teacher@example.com';
const PASSWORD = 'test1234';
// 공유 그룹을 둘이서 써 보려면 계정이 두 개 필요하다.
// 두 번째 계정은 데이터를 심지 않는다 (그룹에 들어가기만 한다).
const SECOND_EMAIL = 'teacher2@example.com';
// 개발자 전용 화면(공휴일, 공유 그룹 점검)을 확인하려면 이 계정으로 들어가야 한다.
// src/lib/developers.ts 의 목록과 같아야 한다.
const DEVELOPER_EMAIL = 'hyundonglim80@gmail.com';
// 교과 전담 점검 계정 (docs/ROADMAP-SUBJECT.md). 5학년 네 반에 과학을 가르친다. 주소 ?as=3.
const SUBJECT_EMAIL = 'teacher3@example.com';
// 초등 담임 교사 유형 문서 - 이것이 없으면 하루 화면에 처음 안내 띠가 떠서 다른 점검의 화면을 밀어낸다.
const HOMEROOM_MODE = { unit: 'subject', hasHomeroom: true, homeroomClass: '', subjects: [], classColors: {} };

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'seed');
const db = getFirestore(app);
const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });

const pad = (n) => String(n).padStart(2, '0');
const dateStr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

// 되풀이해 돌려도 같은 데이터가 나오도록 난수를 고정한다.
let seed = 20260916;
const rnd = () => {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
};
const pick = (arr) => arr[Math.floor(rnd() * arr.length)];

const SUBJECTS = ['국어', '수학', '사회', '과학', '영어', '체육', '음악', '미술', '실과', '창체'];
const EVENTS = [
  '학년 협의회', '과학실 예약', '학부모 상담 전화', '급식 지도', '독서록 검사',
  '체험학습 동의서 취합', '단원평가 채점', '알림장 확인', '교실 환경 정리', '생활기록부 입력',
];
const JOURNALS = [
  '수업 중 모둠 활동이 활발했다. 다음에도 같은 방식으로.',
  '지각한 학생과 짧게 상담함. 아침에 늦게 일어난다고 함.',
  '학부모 전화 상담. 가정에서의 학습 습관에 대해 이야기 나눔.',
  '과학 실험 준비물이 모자랐다. 다음에는 미리 확인할 것.',
];
const MEMOS = [
  '복사용지 주문하기', '출장 여비 정산', '다음 주 수업 자료 만들기', '학급 문고 정리',
  '교무실 프린터 토너 교체 요청', '체육대회 종목 정하기',
];

async function main() {
  try {
    await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
    console.log(`계정을 새로 만들었습니다: ${EMAIL}`);
  } catch {
    console.log(`이미 있는 계정으로 들어갑니다: ${EMAIL}`);
  }
  const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
  const uid = cred.user.uid;
  console.log(`uid = ${uid}`);

  const base = (col) => collection(db, 'users', uid, col);

  // ── 라벨 / 환경설정 ─────────────────────────────────────────────
  // 드라이브 자동 백업: 방금 한 것으로 둔다. 점검 계정에는 구글 토큰이 없어, 비워 두면 PC 화면마다
  // '지금 백업' 띠가 떠서 다른 점검의 화면을 밀어낸다. 띠는 tools/inspect-auto-backup.mjs가 따로 본다.
  await setDoc(doc(db, 'users', uid, 'settings', 'v4_autoBackup'), { lastAt: Date.now() }, { merge: true });
  await setDoc(doc(db, 'users', uid, 'settings', 'v4_teaching'), { ...HOMEROOM_MODE, updatedAt: Date.now() });
  await setDoc(doc(db, 'users', uid, 'settings', 'labels'), {
    eventLabels: [
      { id: 'ev_1', name: '달력', color: 'red', calendar: true, skip: false, forward: false, period: false, recur: false },
      { id: 'ev_2', name: '수업X', color: 'orange', calendar: true, skip: true, forward: false, period: false, recur: false },
      { id: 'ev_3', name: '이월', color: 'green', calendar: false, skip: false, forward: true, period: false, recur: false },
      { id: 'ev_4', name: '기간', color: 'indigo', calendar: false, skip: false, forward: false, period: true, recur: false },
      { id: 'ev_5', name: '반복', color: 'purple', calendar: false, skip: false, forward: false, period: false, recur: true },
    ],
    journalLabels: [
      { id: 'j_1', name: '학급활동', color: 'green' },
      { id: 'j_2', name: '학생상담', color: 'yellow' },
      { id: 'j_3', name: '업무전달', color: 'blue' },
      { id: 'j_4', name: '수업기록', color: 'purple' },
    ],
    memoLabels: ['긴급', '중요', '업무', '개인', '기타'],
  });

  // ── 한 학년도(3월 ~ 이듬해 2월) 일정/기록/수업 ──────────────────
  const start = new Date(2026, 2, 1);
  const end = new Date(2027, 1, 28);
  let batch = writeBatch(db);
  let queued = 0;
  let days = 0, events = 0, journals = 0, schedules = 0;

  const flush = async () => {
    if (queued === 0) return;
    await batch.commit();
    batch = writeBatch(db);
    queued = 0;
  };

  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const ds = dateStr(d);
    const dow = d.getDay();
    if (dow === 0 || dow === 6) continue; // 주말은 비워 둔다
    days++;

    // 일정: 하루 2~5건, 가끔 이월 라벨
    const eventList = [];
    const n = 2 + Math.floor(rnd() * 4);
    for (let i = 0; i < n; i++) {
      const forward = rnd() < 0.15;
      eventList.push({
        id: `ev_${ds.replace(/-/g, '')}_${i}`,
        content: pick(EVENTS),
        completed: rnd() < 0.5,
        label: forward ? '이월' : pick(['', '달력', '수업X']),
        labelIds: forward ? ['ev_3'] : [],
        linkedItems: [],
        attachments: [],
      });
    }
    batch.set(doc(base('events'), ds), {
      eventList,
      eventText: eventList
        .map((e) => `${e.completed ? '[v] ' : ''}${e.label ? `[${e.label}] ` : ''}${e.content}`)
        .join('\n'),
      updatedAt: Date.now(),
    });
    events += eventList.length;
    queued++;

    // 기록: 이틀에 한 번쯤
    if (rnd() < 0.5) {
      const entries = [];
      const m = 1 + Math.floor(rnd() * 2);
      for (let i = 0; i < m; i++) {
        entries.push({
          id: `jr_${ds.replace(/-/g, '')}_${i}`,
          content: pick(JOURNALS),
          createdAt: d.getTime() + i,
          label: pick(['학급활동', '학생상담', '업무전달', '수업기록']),
          labelIds: [],
          imageUrl: '',
          attachments: [],
          linkedItems: [],
        });
      }
      batch.set(doc(base('journals'), ds), { entries, updatedAt: Date.now() });
      journals += entries.length;
      queued++;
    }

    // 수업: 하루 6교시
    const periods = {};
    for (let p = 1; p <= 6; p++) {
      periods[p] = {
        subject: pick(SUBJECTS),
        content: rnd() < 0.4 ? `${p}단원 ${1 + Math.floor(rnd() * 9)}차시` : '',
        memo: rnd() < 0.25 ? '모둠 활동 준비' : '',
        supplies: rnd() < 0.2 ? '색연필, 풀' : '',
        linkedItems: [],
        attachments: [],
      };
    }
    batch.set(doc(base('schedules'), ds), { periods, updatedAt: Date.now() });
    schedules++;
    queued++;

    if (queued >= 400) await flush();
  }
  await flush();

  // ── 메모: 한 해에 걸쳐 흩어 놓는다 ──────────────────────────────
  batch = writeBatch(db);
  const memoCount = 120;
  for (let i = 0; i < memoCount; i++) {
    const when = new Date(start.getTime() + rnd() * (end.getTime() - start.getTime()));
    batch.set(doc(base('tasks'), `memo_${i}`), {
      text: `${pick(MEMOS)} (${i + 1})`,
      content: `${pick(MEMOS)} (${i + 1})`,
      completed: rnd() < 0.3,
      order: -when.getTime(),
      createdAt: when.getTime(),
      labels: [pick(['긴급', '중요', '업무', '개인', '기타'])],
      imageUrl: '',
      attachments: [],
      linkedItems: [],
    });
  }
  await batch.commit();

  // ── 두 번째 계정 (공유 그룹 점검용) ────────────────────────────
  try {
    await createUserWithEmailAndPassword(auth, SECOND_EMAIL, PASSWORD);
    console.log(`두 번째 계정을 만들었습니다: ${SECOND_EMAIL}`);
  } catch {
    console.log(`두 번째 계정은 이미 있습니다: ${SECOND_EMAIL}`);
  }

  {
    const cred2 = await signInWithEmailAndPassword(auth, SECOND_EMAIL, PASSWORD);
    await setDoc(doc(db, 'users', cred2.user.uid, 'settings', 'v4_teaching'), { ...HOMEROOM_MODE, updatedAt: Date.now() });
  }

  await seedSubjectTeacher();

  try {
    await createUserWithEmailAndPassword(auth, DEVELOPER_EMAIL, PASSWORD);
    console.log(`개발자 계정을 만들었습니다: ${DEVELOPER_EMAIL}`);
  } catch {
    console.log(`개발자 계정은 이미 있습니다: ${DEVELOPER_EMAIL}`);
  }

  console.log(
    `심었습니다 — 날짜 ${days}일 / 일정 ${events}건 / 기록 ${journals}건 / 수업 ${schedules}일 / 메모 ${memoCount}건`
  );
  process.exit(0);
}

// ── 교과 전담 계정 (docs/ROADMAP-SUBJECT.md S1) ─────────────────
// 5학년 네 반(반마다 학생 5명)에 과학. 2026-11-02 ~ 11-27 평일에 요일마다 같은 시간표.
// 수업 칸 글자는 '5-2 과학'(반-과목) - V3에도 그 글자로 보인다.
const SUBJECT_WEEK = {
  1: { 1: '5-1 과학', 3: '5-2 과학' },
  2: { 2: '5-3 과학', 4: '5-4 과학' },
  3: { 1: '5-2 과학', 2: '5-1 과학' },
  4: { 3: '5-4 과학', 5: '5-3 과학' },
  5: { 1: '5-1 과학', 2: '5-2 과학', 3: '5-3 과학', 4: '5-4 과학' },
};

async function seedSubjectTeacher() {
  try {
    await createUserWithEmailAndPassword(auth, SUBJECT_EMAIL, PASSWORD);
    console.log(`교과 전담 계정을 만들었습니다: ${SUBJECT_EMAIL}`);
  } catch {
    console.log(`교과 전담 계정은 이미 있습니다: ${SUBJECT_EMAIL}`);
  }
  const { user } = await signInWithEmailAndPassword(auth, SUBJECT_EMAIL, PASSWORD);
  const settings = (id) => doc(db, 'users', user.uid, 'settings', id);
  await setDoc(settings('v4_autoBackup'), { lastAt: Date.now() }, { merge: true });
  await setDoc(settings('v4_teaching'), {
    unit: 'class', hasHomeroom: false, homeroomClass: '', subjects: ['과학'], classColors: {}, updatedAt: Date.now(),
  });
  // 반마다 이름이 다르다 (5-1 가1~가5, 5-2 나1~나5 …) - 반을 잘못 고르면 바로 드러나게
  const classList = ['가', '나', '다', '라'].map((head, i) => ({
    year: 2026,
    grade: '5',
    classNum: String(i + 1),
    students: Array.from({ length: 5 }, (_, j) => ({
      num: j + 1, name: `${head}${j + 1}`, gender: j % 2 ? 'F' : 'M', isActive: true, note: '',
    })),
  }));
  await setDoc(settings('rosters'), { classList, rosters: classList, updatedAt: Date.now() });

  const b = writeBatch(db);
  let n = 0;
  for (let d = new Date(2026, 10, 2); d <= new Date(2026, 10, 27); d.setDate(d.getDate() + 1)) {
    const week = SUBJECT_WEEK[d.getDay()];
    if (!week) continue;
    const periods = {};
    for (const [p, subject] of Object.entries(week)) {
      periods[p] = { subject, content: '', memo: '', supplies: '', linkedItems: [], attachments: [] };
    }
    b.set(doc(db, 'users', user.uid, 'schedules', dateStr(d)), { periods, updatedAt: Date.now() });
    n++;
  }
  await b.commit();
  console.log(`교과 전담 계정에 심었습니다 — 5학년 4반 명렬표 / 수업 ${n}일`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
