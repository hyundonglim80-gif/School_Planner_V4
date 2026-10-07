// src/lib/entryLabelSync.ts
//
// 메모·기록 라벨 한 목록(19번 U5)의 '저장할 일이 생길 때 다른 배열에도 채우기'.
// 화면은 settings/labels의 memoLabels·journalLabels를 이름으로 합쳐 보인다(lib/entryLabels). 메모에만 있던 라벨을 기록에 붙이면
// V3는 기록 라벨을 id로만 찾으므로, 그 기록을 저장하기 전에 journalLabels에 그 라벨(id = entryJournalId)을 채운다.
// 기록에만 있던 라벨을 메모에 붙일 때도 memoLabels에 채운다(V3 메모 라벨 목록에 보이게). 읽기만으로는 쓰지 않는다.
import { doc, runTransaction } from 'firebase/firestore';
import { auth, db } from './firebase';
import { fillEntryLabels, missingEntryLabels, type RawJournalLabel } from './entryLabels';

/** useLabels가 마지막으로 받은 클라우드 배열 (없으면 null - V3 localStorage·기본값으로 보이는 중) */
let cloud: { memo: unknown[] | null; journal: RawJournalLabel[] | null } = { memo: null, journal: null };
/** 화면이 보이는 두 배열 (클라우드가 비었으면 V3 localStorage·기본값) - 새 라벨을 처음 만들 때 바탕으로 */
let shown: { memo: unknown[]; journal: RawJournalLabel[] } = { memo: [], journal: [] };

export function setEntryLabelCloud(
  memo: unknown[] | null,
  journal: RawJournalLabel[] | null,
  shownMemo: unknown[] = [],
  shownJournal: RawJournalLabel[] = []
) {
  cloud = { memo, journal };
  shown = { memo: shownMemo, journal: shownJournal };
}

/**
 * 이 라벨 이름들로 메모·기록을 저장하기 전에 부른다. 두 배열 가운데 빠진 쪽에 채운다(트랜잭션 - 서버의 지금 목록에, V3가
 * 그사이 고친 라벨을 덮지 않게). 이미 다 있으면 읽지도 않는다. 클라우드에 아직 배열이 없는 쪽은 보이던 목록에도 없는 이름일 때만
 * 보이던 목록 + 새 이름으로 쓴다.
 * 실패해도 항목 저장은 막지 않는다(V4 화면은 합쳐 보이므로) - 부르는 쪽이 경고만 남긴다.
 */
export async function ensureEntryLabels(names: string[]): Promise<void> {
  const want = names.map((n) => n.trim()).filter(Boolean);
  const uid = auth.currentUser?.uid;
  if (want.length === 0 || !uid) return;
  if (cloud.memo && cloud.journal) {
    const miss = missingEntryLabels(want, cloud.memo, cloud.journal);
    if (miss.memo.length === 0 && miss.journal.length === 0) return;
  }
  const ref = doc(db, 'users', uid, 'settings', 'labels');
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    const data: any = snap.exists() ? snap.data() : {};
    const cloudMemo = Array.isArray(data.memoLabels) ? data.memoLabels : [];
    const cloudJournal = Array.isArray(data.journalLabels) ? data.journalLabels : [];
    // 클라우드에 아직 배열이 없으면 화면이 보이던 목록(V3 localStorage·기본값)을 바탕으로 - 새 라벨 하나만 써 두면 나머지가 사라진다.
    // 보이던 목록에 있는 이름만 쓸 때는 바뀌지 않는다(fillEntryLabels가 빠진 것이 있을 때만 쓴다) - '#새라벨'(19번 U10)처럼 처음 보는 이름일 때만 쓴다.
    const memo = cloudMemo.length > 0 ? cloudMemo : shown.memo;
    const journal = cloudJournal.length > 0 ? cloudJournal : shown.journal;
    const fill = fillEntryLabels(want, memo, journal);
    if (!fill.memoLabels && !fill.journalLabels) return;
    tx.set(ref, { ...fill, updatedAt: Date.now() }, { merge: true });
  });
}

/** ensureEntryLabels를 부르되 실패하면 경고만 (항목 저장은 이어서 한다) */
export async function ensureEntryLabelsQuietly(names: string[]): Promise<void> {
  try {
    await ensureEntryLabels(names);
  } catch (e) {
    console.warn('메모·기록 라벨을 두 목록에 맞추지 못했습니다 (V3에서 라벨이 안 보일 수 있습니다):', e);
  }
}
