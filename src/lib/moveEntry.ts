// src/lib/moveEntry.ts
//
// 메모 ↔ 기록 옮기기. 일정은 옮기지 않는다(라벨 속성·기간/반복 묶음이 있어서 - 사용자와 정함,
// 일정과 잇고 싶으면 링크 창의 '새 00 만들어 연결'을 쓴다).
//
//   메모 → 기록: 고른 날짜의 기록으로. 같은 공간(개인/그룹)에 만든다.
//   기록 → 메모: 원래 날짜를 첫 줄에 남긴다 (예: "[2026-09-29 (화) 기록]").
//
// 라벨: 같은 이름이 옮겨 갈 쪽에도 있으면 그대로. 없는 것은 옮기는 창에서 고른다
//   (옮겨 갈 쪽의 다른 라벨로 / 같은 이름으로 새로 만들기 / 빼기). 여기는 고른 결과만 받는다.
//
// 차례: ① 새 항목을 만든다 → ② 링크로 이어진 상대 쪽의 역링크를 새 항목으로 갈아끼운다
//       → ③ 원본은 휴지통에 넣고('…으로 옮김') 지운다. ①이 실패하면 원본은 그대로 둔다.
//
// ⚠️ 기록은 하루치가 journals/{date} 한 배열이다. 캐시로 읽고 쓰면 그날 다른 기록이 사라질 수 있어
//    서버에서 읽고, 서버가 답하지 않으면 옮기지 않는다(v4-cold-cache-overwrites-day).
import { addDoc, collection, deleteDoc, doc, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { getDocTrustingServer } from './firestoreSubscribe';
import { autoSourceOf } from './autoJournalSync';
import { moveToTrash } from '../utils/trashHelper';
import { addReverseLink } from '../utils/linkUtils';
import { parseDateStr } from './dateUtils';
import type { JournalEntry } from '../hooks/useDayData';
import type { Memo } from '../hooks/useMemos';
import type { JournalLabel } from '../hooks/useLabels';

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

/** 옮기는 창에서 라벨마다 고른 것 */
export type LabelChoice =
  | { from: string; action: 'keep' } // 같은 이름이 옮겨 갈 쪽에 있다
  | { from: string; action: 'map'; to: string } // 옮겨 갈 쪽의 다른 라벨로
  | { from: string; action: 'create' } // 같은 이름으로 새로 만든다
  | { from: string; action: 'drop' }; // 뺀다

/** 옮겨 갈 쪽에 없는 라벨이면 처음에는 '빼기'. 같은 이름이 있으면 '그대로'. */
export function initialLabelChoices(fromLabels: string[], targetNames: string[]): LabelChoice[] {
  const seen = new Set<string>();
  const out: LabelChoice[] = [];
  for (const raw of fromLabels) {
    const from = (raw || '').trim();
    if (!from || seen.has(from)) continue;
    seen.add(from);
    out.push(targetNames.includes(from) ? { from, action: 'keep' } : { from, action: 'drop' });
  }
  return out;
}

/** 고른 대로 풀었을 때 옮겨 갈 쪽의 라벨 이름들 (겹치지 않게) */
export function resolveLabelNames(choices: LabelChoice[]): { names: string[]; toCreate: string[] } {
  const names: string[] = [];
  const toCreate: string[] = [];
  for (const c of choices) {
    const name = c.action === 'keep' || c.action === 'create' ? c.from : c.action === 'map' ? c.to : '';
    if (!name || names.includes(name)) continue;
    names.push(name);
    if (c.action === 'create') toCreate.push(name);
  }
  return { names, toCreate };
}

/** 기록 → 메모 첫 줄. 예: "[2026-09-29 (화) 기록]" */
export function journalDateLine(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return `[${dateStr} (${DAY_NAMES[d.getDay()]}) 기록]`;
}

/** 옮길 수 없는 기록인가 (알림장·출석부가 만든 자동 기록 - 옮기면 원본과의 연결이 깨진다) */
export function isMovableJournal(entry: Pick<JournalEntry, 'id'>): boolean {
  return !autoSourceOf(entry as any);
}

const uidOrThrow = () => {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  return uid;
};
const col = (uid: string, groupId: string | null, name: string) =>
  groupId ? collection(db, 'groups', groupId, name) : collection(db, 'users', uid, name);
const dayRef = (uid: string, groupId: string | null, name: string, dateStr: string) =>
  groupId ? doc(db, 'groups', groupId, name, dateStr) : doc(db, 'users', uid, name, dateStr);

/** Firestore는 undefined를 받지 않는다 */
const clean = <T>(v: T): T => JSON.parse(JSON.stringify(v));

/** 새로 만들 라벨을 라벨 목록(settings/labels)에 더한다. 라벨 관리 창과 같은 모양으로 쓴다. */
async function addLabels(kind: 'memo' | 'journal', names: string[], current: any[]): Promise<any[]> {
  const uid = uidOrThrow();
  const ref = doc(db, 'users', uid, 'settings', 'labels');
  const field = kind === 'memo' ? 'memoLabels' : 'journalLabels';
  const { snap } = await getDocTrustingServer(ref);
  const cloud = snap.exists() ? (snap.data() as any)?.[field] : null;
  // 클라우드에 목록이 없으면(V3 localStorage에서 읽은 경우) 지금 화면이 쓰는 목록을 바탕으로 한다
  const base: any[] = Array.isArray(cloud) && cloud.length > 0 ? cloud : current;
  const nameOf = (l: any) => (typeof l === 'string' ? l : l?.name);
  const next = [...base];
  const now = Date.now();
  names.forEach((name, i) => {
    if (next.some((l) => nameOf(l) === name)) return;
    if (kind === 'memo') {
      // 메모 라벨은 옛 판(V3)처럼 이름만 들고 있을 수도 있다. 있던 모양을 따른다.
      next.push(base.length > 0 && typeof base[0] === 'string' ? name : { id: `memo_${now + i}`, name, color: 'gray' });
    } else {
      next.push({ id: `j_${now + i}`, name, color: 'green' });
    }
  });
  await setDoc(ref, { [field]: next, updatedAt: Date.now() }, { merge: true });
  return next;
}

/** 링크로 이어진 상대 쪽의 '옛 항목' 역링크를 새 항목으로 갈아끼운다 */
async function retargetLinks(links: any[] | undefined, oldId: string, newMeta: any, fId: string) {
  for (const link of links || []) {
    await addReverseLink(link, newMeta, fId, { retargetFromIds: [oldId] });
  }
}

// ── 메모 → 기록 ──────────────────────────────────────────
export async function moveMemoToJournal(opts: {
  memo: Memo;
  groupId: string | null;
  dateStr: string;
  labelChoices: LabelChoice[];
  journalLabels: JournalLabel[];
}): Promise<{ newId: string }> {
  const { memo, groupId, dateStr } = opts;
  const uid = uidOrThrow();
  const { names, toCreate } = resolveLabelNames(opts.labelChoices);

  // 라벨 이름 → id (기록은 V3가 id로만 찾는다)
  let labels: any[] = opts.journalLabels;
  if (toCreate.length > 0) labels = await addLabels('journal', toCreate, opts.journalLabels);
  const labelIds = names
    .map((n) => labels.find((l: any) => (typeof l === 'string' ? l : l.name) === n)?.id)
    .filter((id): id is string => !!id);

  // ① 그날 기록 묶음을 서버에서 읽고 새 기록을 덧붙인다
  const ref = dayRef(uid, groupId, 'journals', dateStr);
  const { snap, fromServer } = await getDocTrustingServer(ref);
  if (!fromServer) throw new Error('서버에 연결되지 않아 옮기지 못했습니다. 잠시 뒤 다시 해 주세요.');
  const entries: any[] = snap.exists() ? (snap.data() as any)?.entries || [] : [];
  const newId = 'jr_' + Date.now().toString(36) + '_' + Math.random().toString(36).substring(2, 5);
  const entry: JournalEntry = clean({
    id: newId,
    content: (memo.content || memo.text || '').trim(),
    createdAt: Date.now(),
    label: names[0] || '',
    labelIds,
    imageUrl: memo.imageUrl || '',
    attachments: (memo.attachments || []) as any,
    linkedItems: memo.linkedItems || [],
  });
  await setDoc(ref, { entries: [...entries, entry], updatedAt: Date.now() }, { merge: true });

  // ② 역링크 갈아끼우기
  await retargetLinks(
    memo.linkedItems,
    memo.firestoreId,
    {
      targetType: 'journal',
      targetId: newId,
      targetDate: dateStr,
      title: `[${dateStr}] ${entry.content.substring(0, 20)}`,
      targetFId: groupId || 'personal',
    },
    groupId || 'personal'
  );

  // ③ 원본 메모는 휴지통으로 (잘못 옮겼으면 되살릴 수 있게)
  await moveToTrash({
    id: memo.firestoreId,
    type: 'memo',
    fId: groupId || 'personal',
    content: `(기록으로 옮김) ${memo.content || memo.text || ''}`,
    data: memo,
  }).catch((e) => console.warn('옮긴 메모를 휴지통에 넣지 못했습니다:', e));
  await deleteDoc(groupId ? doc(db, 'groups', groupId, 'tasks', memo.firestoreId) : doc(db, 'users', uid, 'tasks', memo.firestoreId));

  return { newId };
}

// ── 기록 → 메모 ──────────────────────────────────────────
export async function moveJournalToMemo(opts: {
  entry: JournalEntry;
  groupId: string | null;
  dateStr: string;
  labelChoices: LabelChoice[];
  memoLabels: string[];
}): Promise<{ newId: string }> {
  const { entry, groupId, dateStr } = opts;
  if (!isMovableJournal(entry)) throw new Error('알림장·출석부가 만든 기록은 옮길 수 없습니다.');
  const uid = uidOrThrow();
  const user = auth.currentUser!;
  const { names, toCreate } = resolveLabelNames(opts.labelChoices);
  if (toCreate.length > 0) await addLabels('memo', toCreate, opts.memoLabels);

  // 지울 기록 묶음을 먼저 서버에서 확인한다. 서버가 답하지 않으면 아무것도 하지 않는다.
  const ref = dayRef(uid, groupId, 'journals', dateStr);
  const { snap, fromServer } = await getDocTrustingServer(ref);
  if (!fromServer) throw new Error('서버에 연결되지 않아 옮기지 못했습니다. 잠시 뒤 다시 해 주세요.');
  const entries: any[] = snap.exists() ? (snap.data() as any)?.entries || [] : [];
  if (!entries.some((j) => String(j.id) === String(entry.id))) throw new Error('옮길 기록을 찾지 못했습니다.');

  // ① 새 메모 (원래 날짜를 첫 줄에)
  const content = `${journalDateLine(dateStr)}\n${(entry.content || '').trim()}`;
  const now = Date.now();
  const newRef = await addDoc(
    col(uid, groupId, 'tasks'),
    clean({
      text: content,
      content,
      completed: false,
      order: -now,
      createdAt: now,
      labels: names,
      imageUrl: entry.imageUrl || '',
      attachments: entry.attachments || [],
      linkedItems: entry.linkedItems || [],
      authorId: user.uid,
      authorName: user.displayName || '이름 없음',
      sharedGroupIds: groupId ? [groupId] : [],
    })
  );

  // ② 역링크 갈아끼우기
  await retargetLinks(
    entry.linkedItems,
    String(entry.id),
    {
      targetType: 'memo',
      targetId: newRef.id,
      targetDate: '',
      title: `[메모] ${content.substring(0, 20)}`,
      targetFId: groupId || 'personal',
    },
    groupId || 'personal'
  );

  // ③ 원본 기록은 휴지통으로, 그날 묶음에서 뺀다
  await moveToTrash({
    id: String(entry.id),
    type: 'journal',
    originalDateStr: dateStr,
    fId: groupId || 'personal',
    content: `(메모로 옮김) ${entry.content || ''}`,
    data: entry,
  }).catch((e) => console.warn('옮긴 기록을 휴지통에 넣지 못했습니다:', e));
  // 새 메모를 만드는 사이에 다른 기기가 그날 기록을 더했을 수 있다. 빼기 직전에 서버에서 다시 읽는다.
  const latest = await getDocTrustingServer(ref);
  if (!latest.fromServer) {
    throw new Error('메모는 만들었지만 서버에 연결되지 않아 원본 기록을 지우지 못했습니다. 원본 기록을 직접 지워 주세요.');
  }
  const latestEntries: any[] = latest.snap.exists() ? (latest.snap.data() as any)?.entries || [] : [];
  await setDoc(
    ref,
    { entries: latestEntries.filter((j) => String(j.id) !== String(entry.id)), updatedAt: Date.now() },
    { merge: true }
  );

  return { newId: newRef.id };
}
