// src/lib/seatingStore.ts
//
// 자리표 저장(ROADMAP 8번). 셈은 lib/seating에 있다. V4 전용, 명렬표처럼 개인 공간에만.
//
//   users/{uid}/v4_seating/{id}         자리표 한 장 (classKey로 학급을 가리킨다)
//   users/{uid}/v4_classHub/{학급키}     학급마다 하나 - 떨어뜨릴 학생(apart), 발표자 뽑기 이번 판(draw) …
//
// 떨어뜨릴 학생은 arrayUnion/arrayRemove로 한 쌍씩 더하고 뺀다 - 다른 기기에서 더한 것을 덮지 않게.
// 뽑기도 뽑은 번호 하나씩 arrayUnion(새 판만 통째로) - 다른 기기에서 이어 뽑는다.
// 자리표의 자리(seats)는 한 장 통째로 쓴다. 자리 배치는 한 덩어리라(섞기·맞바꾸기) 칸마다 합칠 수 없고,
// 화면은 구독으로 늘 최신 자리표를 들고 있어 고친 직후의 값을 쓴다.
import {
  arrayRemove,
  arrayUnion,
  collection,
  deleteDoc,
  doc,
  getDoc,
  onSnapshot,
  query,
  setDoc,
  updateDoc,
  where,
} from 'firebase/firestore';
import { db } from './firebase';
import { moveToTrash } from '../utils/trashHelper';
import { sanitizeChart, type SeatingChart } from './seating';
import { sanitizeDraw, type DrawPick, type DrawState } from './draw';

const seatingCol = (uid: string) => collection(db, 'users', uid, 'v4_seating');
const hubDoc = (uid: string, classKey: string) => doc(db, 'users', uid, 'v4_classHub', classKey);

export function newSeatingId(): string {
  return `st_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`;
}

/** 그 학급의 자리표를 구독한다 (만든 차례). 끊으면 함수를 부른다 */
export function subscribeSeatingCharts(
  uid: string,
  classKey: string,
  onData: (charts: SeatingChart[]) => void,
  onError?: (err: unknown) => void
): () => void {
  return onSnapshot(
    query(seatingCol(uid), where('classKey', '==', classKey)),
    (snap) => {
      const charts = snap.docs.map((d) => sanitizeChart(d.id, d.data()));
      charts.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0) || a.name.localeCompare(b.name, 'ko'));
      onData(charts);
    },
    (err) => onError?.(err)
  );
}

/** 새 자리표를 쓴다. 실패하면 던진다 */
export async function createSeatingChart(uid: string, chart: Omit<SeatingChart, 'id'>, id = newSeatingId()): Promise<string> {
  const now = Date.now();
  const { createdAt, updatedAt, ...rest } = chart;
  await setDoc(doc(seatingCol(uid), id), { ...rest, createdAt: createdAt || now, updatedAt: now });
  return id;
}

type ChartFields = Partial<Omit<SeatingChart, 'id' | 'classKey' | 'createdAt' | 'updatedAt'>>;

/** 자리표의 칸 몇 개를 고친다 (주지 않은 칸은 그대로). 실패하면 던진다 */
export async function updateSeatingChart(uid: string, id: string, fields: ChartFields): Promise<void> {
  // seats는 통째로 갈아 끼운다 - updateDoc은 준 칸을 통째로 바꾸므로 빠진 자리가 남지 않는다
  await updateDoc(doc(seatingCol(uid), id), { ...fields, updatedAt: Date.now() });
}

/**
 * 휴지통에 먼저 넣고 지운다 (휴지통에 못 넣으면 지우지 않는다 - 던진다). 복원은 lib/trashRestore 'seating'.
 * 휴지통 문서 id를 돌려준다(지운 뒤 안내의 '되돌리기').
 */
export async function deleteSeatingChart(uid: string, chart: SeatingChart, className: string): Promise<string | undefined> {
  const { id, ...data } = chart;
  const trashId = await moveToTrash({
    id,
    type: 'seating',
    content: `${className} 자리표 '${chart.name}'`,
    data: { id, ...data },
  });
  if (!trashId) throw new Error('휴지통에 넣지 못해 지우지 않았습니다.');
  await deleteDoc(doc(seatingCol(uid), id));
  return trashId;
}

/** 휴지통에서 되살린다. 같은 id 문서가 이미 있으면 덮지 않고 새 id로 */
export async function restoreSeatingChart(uid: string, data: any): Promise<void> {
  const chart = sanitizeChart(String(data?.id || newSeatingId()), data);
  const taken = (await getDoc(doc(seatingCol(uid), chart.id))).exists();
  const { id, ...rest } = chart;
  await createSeatingChart(uid, rest, taken ? newSeatingId() : id);
}

// ── 학급 허브 (학급마다 하나) ───────────────────────────────────────────

export interface ClassHub {
  /** 떨어뜨릴 학생 쌍 (lib/seating.pairKey) */
  apart: string[];
  /** 발표자 뽑기 이번 판 (lib/draw) */
  draw: DrawState;
}

export function sanitizeHub(raw: any): ClassHub {
  return {
    apart: Array.isArray(raw?.apart) ? [...new Set<string>(raw.apart.filter((p: unknown) => typeof p === 'string'))] : [],
    draw: sanitizeDraw(raw?.draw),
  };
}

export function subscribeClassHub(
  uid: string,
  classKey: string,
  onData: (hub: ClassHub) => void,
  onError?: (err: unknown) => void
): () => void {
  return onSnapshot(
    hubDoc(uid, classKey),
    (snap) => onData(sanitizeHub(snap.exists() ? snap.data() : null)),
    (err) => onError?.(err)
  );
}

/** 떨어뜨릴 학생 한 쌍을 더하거나 뺀다. 문서가 없으면 만든다. 실패하면 던진다 */
export async function setApartPair(uid: string, classKey: string, pair: string, on: boolean): Promise<void> {
  await setDoc(
    hubDoc(uid, classKey),
    { classKey, apart: on ? arrayUnion(pair) : arrayRemove(pair), updatedAt: Date.now() },
    { merge: true }
  );
}

// ── 발표자 뽑기 (ROADMAP 8-3) ──
// draw는 merge로 쓴다 - 준 칸만 바뀌고 apart와 draw의 다른 칸은 그대로.

/** 뽑은 학생을 이번 판에 더한다(새 판이면 그 학생 하나로 판을 연다). 실패하면 던진다 */
export async function saveDrawPick(uid: string, classKey: string, pick: DrawPick, round: number): Promise<void> {
  const now = Date.now();
  const draw = pick.newRound
    ? { picked: [pick.num], round: round + 1, updatedAt: now }
    : { picked: arrayUnion(pick.num), updatedAt: now };
  await setDoc(hubDoc(uid, classKey), { classKey, draw, updatedAt: now }, { merge: true });
}

/** 방금 뽑은 학생을 이번 판에서 뺀다(되돌리기 - 다시 뽑힐 수 있다). 실패하면 던진다 */
export async function undoDrawPick(uid: string, classKey: string, num: number): Promise<void> {
  const now = Date.now();
  await setDoc(hubDoc(uid, classKey), { classKey, draw: { picked: arrayRemove(num), updatedAt: now }, updatedAt: now }, { merge: true });
}

/** 이번 판을 접고 새 판을 연다(아무도 안 뽑힌 채). 실패하면 던진다 */
export async function startNewDrawRound(uid: string, classKey: string, round: number): Promise<void> {
  const now = Date.now();
  await setDoc(hubDoc(uid, classKey), { classKey, draw: { picked: [], round: round + 1, updatedAt: now }, updatedAt: now }, { merge: true });
}

/** 새 판을 되돌린다 - 접기 전 판으로. 실패하면 던진다 */
export async function restoreDrawState(uid: string, classKey: string, state: DrawState): Promise<void> {
  const now = Date.now();
  await setDoc(hubDoc(uid, classKey), { classKey, draw: { ...state, updatedAt: now }, updatedAt: now }, { merge: true });
}
