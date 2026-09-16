// tools/check-rules.mjs
//
// 조인 보안 규칙을 에뮬레이터에 올려 놓고, 되어야 하는 일과 막혀야 하는 일을
// 하나씩 해 본다. 규칙만 눈으로 읽어서는 무엇이 깨지는지 알 수 없다.
//
//   npm run emu   (다른 창)
//   node tools/check-rules.mjs
//
// ⚠️ 이 스크립트는 에뮬레이터만 건드린다. 운영 데이터와는 아무 상관이 없다.
import { initializeApp, deleteApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator, doc, setDoc, getDoc, getDocs, updateDoc,
  deleteDoc, collection, query, where, arrayUnion, arrayRemove,
} from 'firebase/firestore';
import {
  getAuth, connectAuthEmulator, signInWithEmailAndPassword, createUserWithEmailAndPassword,
} from 'firebase/auth';

let pass = 0;
let fail = 0;

function client(name) {
  const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, name);
  const db = getFirestore(app);
  const auth = getAuth(app);
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  return { app, db, auth };
}

async function login(c, email) {
  try { await createUserWithEmailAndPassword(c.auth, email, 'test1234'); } catch { /* 이미 있음 */ }
  const cred = await signInWithEmailAndPassword(c.auth, email, 'test1234');
  return cred.user.uid;
}

/** 되어야 하는 일 */
async function must(what, fn) {
  try {
    await fn();
    console.log(`  ✔ ${what}`);
    pass++;
  } catch (e) {
    console.log(`  ✘ ${what} — 막혔다 (${e.code || e.message})`);
    fail++;
  }
}

/** 막혀야 하는 일 */
async function mustNot(what, fn) {
  try {
    await fn();
    console.log(`  ✘ ${what} — 그런데 됐다!`);
    fail++;
  } catch (e) {
    const denied = e.code === 'permission-denied';
    console.log(`  ${denied ? '✔' : '△'} ${what} — ${denied ? '막혔다' : '다른 이유로 실패: ' + (e.code || e.message)}`);
    denied ? pass++ : fail++;
  }
}

const p2 = (n) => String(n).padStart(2, '0');
const t = new Date();
const today = `${t.getFullYear()}-${p2(t.getMonth() + 1)}-${p2(t.getDate())}`;

async function run() {
  const A = client('owner');     // 그룹장
  const B = client('member');    // 초대 코드로 들어올 사람
  const X = client('outsider');  // 아무 관계 없는 사람

  const aUid = await login(A, 'teacher@example.com');
  const bUid = await login(B, 'teacher2@example.com');
  const xUid = await login(X, 'stranger@example.com');

  const gid = 'grp_rulecheck';
  const code = 'RULECHK';

  console.log('\n[그룹장 A]');
  await must('그룹 만들기', async () => {
    await setDoc(doc(A.db, 'groups', gid), {
      name: '규칙 점검용 공유방',
      ownerId: aUid,
      ownerName: '김선생',
      inviteCode: code,
      members: [aUid],
      memberDetails: { [aUid]: { name: '김선생', joinedAt: Date.now(), photoURL: '' } },
      createdAt: Date.now(),
    });
  });
  await must('초대 코드 매핑 만들기', async () => {
    await setDoc(doc(A.db, 'inviteCodes', code), { groupId: gid, ownerId: aUid, createdAt: Date.now() });
  });
  await must('같은 매핑을 다시 쓰기 (경합 때 거부되던 것)', async () => {
    await setDoc(doc(A.db, 'inviteCodes', code), { groupId: gid, ownerId: aUid, createdAt: Date.now() });
  });
  await must('내 그룹 목록 조회 (array-contains)', async () => {
    const s = await getDocs(query(collection(A.db, 'groups'), where('members', 'array-contains', aUid)));
    if (s.empty) throw new Error('내 그룹이 안 나온다');
  });
  await must('그룹 안에 기록 쓰기', async () => {
    await setDoc(doc(A.db, 'groups', gid, 'journals', today), {
      entries: [{ id: 'jr_x', content: '박OO 학생 상담 내용', createdAt: Date.now() }],
      updatedAt: Date.now(),
    });
  });

  console.log('\n[아무 관계 없는 사람 X] — 전부 막혀야 한다');
  await mustNot('그룹 목록 전체 훑기', async () => {
    const s = await getDocs(collection(X.db, 'groups'));
    if (s.size === 0) throw Object.assign(new Error('빈 목록'), { code: 'permission-denied' });
  });
  await mustNot('그룹 ID를 알 때 단건 읽기', async () => {
    const d = await getDoc(doc(X.db, 'groups', gid));
    if (!d.exists()) throw Object.assign(new Error('없음'), { code: 'permission-denied' });
  });
  await mustNot('초대 코드로 그룹 찾기 (폴백 조회)', async () => {
    const s = await getDocs(query(collection(X.db, 'groups'), where('inviteCode', '==', code)));
    if (s.empty) throw Object.assign(new Error('빈 목록'), { code: 'permission-denied' });
  });
  await mustNot('남의 그룹 상담 기록 읽기', async () => {
    const d = await getDoc(doc(X.db, 'groups', gid, 'journals', today));
    if (!d.exists()) throw Object.assign(new Error('없음'), { code: 'permission-denied' });
  });
  await mustNot('남의 그룹 기록 고쳐 쓰기', async () => {
    await setDoc(doc(X.db, 'groups', gid, 'journals', today), { entries: [], updatedAt: Date.now() });
  });
  await mustNot('남의 그룹 지우기', async () => {
    await deleteDoc(doc(X.db, 'groups', gid));
  });
  await mustNot('남을 마음대로 구성원으로 넣기', async () => {
    await updateDoc(doc(X.db, 'groups', gid), { members: arrayUnion('somebody_else') });
  });
  await mustNot('그룹 이름 바꾸기', async () => {
    await updateDoc(doc(X.db, 'groups', gid), { name: '내가 바꿈' });
  });

  console.log('\n[초대받은 B] — 참여가 되어야 한다');
  await must('코드 -> 그룹 매핑 한 건 읽기', async () => {
    const d = await getDoc(doc(B.db, 'inviteCodes', code));
    if (!d.exists() || d.data().groupId !== gid) throw new Error('매핑을 못 읽었다');
  });
  await mustNot('참여 전에는 그룹을 읽지 못한다 (앱이 이걸 가정하면 안 됨)', async () => {
    const d = await getDoc(doc(B.db, 'groups', gid));
    if (!d.exists()) throw Object.assign(new Error('없음'), { code: 'permission-denied' });
  });
  await must('자기 자신만 구성원으로 넣기 (참여) — updateDoc', async () => {
    await updateDoc(doc(B.db, 'groups', gid), {
      members: arrayUnion(bUid),
      [`memberDetails.${bUid}`]: { name: '이선생', joinedAt: Date.now(), photoURL: '' },
    });
  });
  await must('참여한 뒤에는 그룹을 읽는다', async () => {
    const d = await getDoc(doc(B.db, 'groups', gid));
    if (!d.exists()) throw new Error('못 읽었다');
  });
  await must('참여한 뒤 그룹 기록을 읽는다', async () => {
    const d = await getDoc(doc(B.db, 'groups', gid, 'journals', today));
    if (!d.exists()) throw new Error('못 읽었다');
  });
  await must('참여한 뒤 그룹 기록을 쓴다', async () => {
    await setDoc(doc(B.db, 'groups', gid, 'journals', today), {
      entries: [{ id: 'jr_b', content: 'B가 남긴 기록', createdAt: Date.now() }],
      updatedAt: Date.now(),
    });
  });
  await mustNot('구성원이어도 그룹 이름은 못 바꾼다', async () => {
    await updateDoc(doc(B.db, 'groups', gid), { name: 'B가 바꿈' });
  });
  await mustNot('구성원이어도 그룹은 못 지운다', async () => {
    await deleteDoc(doc(B.db, 'groups', gid));
  });

  console.log('\n[옛 V3 방식] — setDoc으로 점이 든 키를 쓰면 막혀야 한다');
  const C = client('legacy');
  const cUid = await login(C, 'legacy@example.com');
  await mustNot("setDoc({'memberDetails.<uid>': ...}, {merge:true}) 로 참여", async () => {
    await setDoc(doc(C.db, 'groups', gid), {
      members: arrayUnion(cUid),
      [`memberDetails.${cUid}`]: { name: '옛방식', joinedAt: Date.now(), photoURL: '' },
    }, { merge: true });
  });
  await must('updateDoc으로 고친 방식은 된다', async () => {
    await updateDoc(doc(C.db, 'groups', gid), {
      members: arrayUnion(cUid),
      [`memberDetails.${cUid}`]: { name: '새방식', joinedAt: Date.now(), photoURL: '' },
    });
  });

  console.log('\n[탈퇴]');
  await must('자기 자신만 빼기 (탈퇴)', async () => {
    await updateDoc(doc(B.db, 'groups', gid), { members: arrayRemove(bUid) });
  });
  await mustNot('탈퇴한 뒤에는 그룹 기록을 못 읽는다', async () => {
    const d = await getDoc(doc(B.db, 'groups', gid, 'journals', today));
    if (!d.exists()) throw Object.assign(new Error('없음'), { code: 'permission-denied' });
  });

  console.log('\n[그룹장 정리]');
  await must('그룹장이 하위 자료를 비운다', async () => {
    await deleteDoc(doc(A.db, 'groups', gid, 'journals', today));
  });
  await must('그룹장이 그룹을 지운다', async () => {
    await deleteDoc(doc(A.db, 'groups', gid));
  });
  await must('그룹장이 매핑을 지운다', async () => {
    await deleteDoc(doc(A.db, 'inviteCodes', code));
  });

  console.log('\n[개인 공간] — 원래도 막혀 있었다');
  await mustNot('남의 개인 공간 읽기', async () => {
    const d = await getDoc(doc(X.db, 'users', aUid, 'journals', today));
    if (!d.exists()) throw Object.assign(new Error('없음'), { code: 'permission-denied' });
  });
  await must('내 개인 공간은 읽는다', async () => {
    await getDoc(doc(A.db, 'users', aUid, 'settings', 'labels'));
  });

  console.log(`\n───────── ${pass}개 통과 / ${fail}개 실패 ─────────`);
  for (const c of [A, B, X, C]) await deleteApp(c.app).catch(() => {});
  process.exit(fail === 0 ? 0 : 1);
}

run().catch((e) => { console.error(e); process.exit(1); });
