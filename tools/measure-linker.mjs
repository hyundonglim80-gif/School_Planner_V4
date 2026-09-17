// 링커가 쓰던 '하루씩 차례로 읽기'와 바꾼 '범위 조회'를 같은 데이터로 재 본다.
import { initializeApp } from 'firebase/app';
import {
  getFirestore, connectFirestoreEmulator, doc, getDoc, getDocs,
  collection, query, where, documentId,
} from 'firebase/firestore';
import { getAuth, connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';

const app = initializeApp({ projectId: 'schoolplannerv3', apiKey: 'fake-api-key' }, 'ml');
const db = getFirestore(app); const auth = getAuth(app);
connectFirestoreEmulator(db, '127.0.0.1', 8080);
connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
const { user } = await signInWithEmailAndPassword(auth, 'teacher@example.com', 'test1234');
const uid = user.uid;

const p2 = (n) => String(n).padStart(2, '0');
const ds = (d) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
// 링커의 '1년' 범위와 같은 모양
const start = ds(new Date(Date.now() - 200 * 86400000));
const end = ds(new Date(Date.now() + 165 * 86400000));

const evCol = collection(db, 'users', uid, 'events');
const jrCol = collection(db, 'users', uid, 'journals');

// ── 예전 방식: 날짜마다 한 건씩, 줄 세워서 ──────────────────────────
async function oldWay() {
  const t0 = Date.now();
  let rows = 0, reads = 0;
  const cur = new Date(start + 'T00:00:00');
  const endD = new Date(end + 'T00:00:00');
  let days = 0;
  while (cur <= endD && days < 370) {
    const dStr = ds(cur);
    const ev = await getDoc(doc(evCol, dStr)); reads++;
    if (ev.exists()) rows += (ev.data().eventList || []).length;
    const jr = await getDoc(doc(jrCol, dStr)); reads++;
    if (jr.exists()) rows += (jr.data().entries || []).length;
    cur.setDate(cur.getDate() + 1); days++;
  }
  return { ms: Date.now() - t0, rows, reads };
}

// ── 바꾼 방식: 범위 조회 두 번 ──────────────────────────────────────
async function newWay() {
  const t0 = Date.now();
  const range = (col) =>
    getDocs(query(col, where(documentId(), '>=', start), where(documentId(), '<=', end)));
  const [ev, jr] = await Promise.all([range(evCol), range(jrCol)]);
  let rows = 0;
  ev.forEach((d) => { rows += (d.data().eventList || []).length; });
  jr.forEach((d) => { rows += (d.data().entries || []).length; });
  return { ms: Date.now() - t0, rows, reads: 2 };
}

const a = await oldWay();
const b = await newWay();
console.log(`\n조회 범위 ${start} ~ ${end}`);
console.log(`  예전(하루씩 차례로) : ${(a.ms / 1000).toFixed(1)}초  왕복 ${a.reads}번  항목 ${a.rows}건`);
console.log(`  지금(범위 조회)     : ${(b.ms / 1000).toFixed(1)}초  왕복 ${b.reads}번  항목 ${b.rows}건`);
console.log(`  항목 수가 같은가    : ${a.rows === b.rows ? '✔ 같다' : `✘ 다르다 (${a.rows} vs ${b.rows})`}`);
console.log(`  빨라진 정도         : ${(a.ms / Math.max(1, b.ms)).toFixed(0)}배`);
process.exit(0);
