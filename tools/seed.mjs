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

  console.log(
    `심었습니다 — 날짜 ${days}일 / 일정 ${events}건 / 기록 ${journals}건 / 수업 ${schedules}일 / 메모 ${memoCount}건`
  );
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
