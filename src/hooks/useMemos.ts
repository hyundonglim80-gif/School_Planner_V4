import { useState, useEffect } from 'react';
import type { EntryTable } from '../lib/entryTable';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, writeBatch, runTransaction } from 'firebase/firestore';
import { getDocTrustingServer } from '../lib/firestoreSubscribe';
import { db, auth } from '../lib/firebase';
import { moveToTrash } from '../utils/trashHelper';
import { showUndoToast } from '../lib/undoToast';
import { syncReverseLinks, mergeLinkEdits } from '../utils/linkUtils';
import { showToast, showErrorToast, failWithToast } from '../utils/toast';
import { toggleCheckLine as toggleCheckLineText } from '../lib/checkLines';

export interface MemoAttachment {
  name: string;
  url: string;
  type?: string;
  size?: number;
  /** 구글 드라이브 파일 id. 미리보기와 나중의 삭제에 쓴다. */
  driveId?: string;
}

export interface Memo {
  firestoreId: string;
  text?: string;
  content?: string;
  createdAt: number;
  completed?: boolean;
  order?: number;
  labels?: string[];
  imageUrl?: string;
  attachments?: MemoAttachment[];
  /** 구글 Keep에서 가져온 메모라면 그 메모를 알아보는 열쇠 (lib/keepImport) */
  keepId?: string;
  /** 즐겨찾기. 켜 두면 목록 맨 위에 모인다. */
  favorite?: boolean;
  authorId?: string;
  authorName?: string;
  groupId?: string;
  isShared?: boolean;
  linkedItems?: any[];
  /** 붙인 표 (lib/entryTable). V3는 모르는 칸이지만 updateDoc이라 지우지 않는다 */
  tables?: EntryTable[];
  /** 기록에서 날짜를 빼 메모가 되었으면 그 원래 날짜 (19번 U7, V4 전용 칸) */
  fromDate?: string;
}

/** 상대 쪽에 넣을 '이 메모' 표시. 메모는 날짜가 없어서 제목에 '메모'라고 적는다. */
const memoSourceMeta = (firestoreId: string, content: string, groupId: string | null) =>
  ({
    targetType: 'memo',
    targetId: firestoreId,
    targetDate: '',
    title: `[메모] ${(content || '').substring(0, 20)}`,
    targetFId: groupId || 'personal',
  }) as any;

/** 라벨이 하나도 없는 메모인가. 빈 이름만 들어 있는 것도 없는 것으로 본다. */
export const isUnlabeledMemo = (memo: Pick<Memo, 'labels'>) =>
  !(memo.labels || []).some((l) => typeof l === 'string' && l.trim() !== '');

/** 한 번에 보내는 쓰기 수. Firestore 한도(500)보다 넉넉히 작게 잡는다. */
const BATCH_SIZE = 400;

export function useMemos(groupId: string | null = null) {
  const [memos, setMemos] = useState<Memo[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setMemos([]);
      setLoading(false);
      return;
    }
    setLoading(true);

    const collectionRef = groupId
      ? collection(db, 'groups', groupId, 'tasks')
      : collection(db, 'users', user.uid, 'tasks');

    const unsubscribe = onSnapshot(collectionRef, (snapshot) => {
      const newMemos: Memo[] = [];
      snapshot.forEach((docSnap) => {
        const data = docSnap.data();
        const created = data.createdAt || (data.order ? Math.abs(data.order) : Date.now());
        newMemos.push({
          firestoreId: docSnap.id,
          ...data,
          content: data.text || data.content || '',
          text: data.text || data.content || '',
          createdAt: created,
          // 차례. V3와 같게 order가 작을수록 앞이다. 새 메모는 order: -만든 시각이라
          // 나중에 만든 것이 앞에 선다. 값이 없는 옛 메모도 같은 규칙으로 채운다.
          order: typeof data.order === 'number' ? data.order : -created,
          completed: !!data.completed,
          labels: data.labels || [],
          attachments: data.attachments || [],
          linkedItems: data.linkedItems || [],
        } as Memo);
      });

      // V3(viewMemo)와 같은 차례: order가 작은 것이 앞. ▲▼로 바꾼 차례가 두 앱에 같게 보인다.
      newMemos.sort((a, b) => (a.order as number) - (b.order as number) || b.createdAt - a.createdAt);
      setMemos(newMemos);
      setLoading(false);
    }, (error) => {
      showErrorToast('메모를 불러오지 못했습니다.', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [groupId, auth.currentUser?.uid]);

  const addMemo = async (data: { content: string; labels?: string[]; imageUrl?: string; attachments?: MemoAttachment[]; linkedItems?: any[]; keepId?: string; tables?: EntryTable[]; completed?: boolean; favorite?: boolean }) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const collectionRef = groupId
       ? collection(db, 'groups', groupId, 'tasks')
       : collection(db, 'users', user.uid, 'tasks');

    const now = Date.now();
    const newMemoData = {
      text: data.content,
      content: data.content,
      // 쓰는 칸 머리줄에서 미리 켠 완료·즐겨찾기 (19번 U6)
      completed: !!data.completed,
      ...(data.completed ? { completedAt: now } : {}),
      ...(data.favorite ? { favorite: true } : {}),
      order: -now,
      createdAt: now,
      labels: data.labels || [],
      imageUrl: data.imageUrl || '',
      attachments: data.attachments || [],
      linkedItems: data.linkedItems || [],
      // 표는 붙였을 때만 칸을 만든다
      ...(data.tables && data.tables.length > 0 ? { tables: data.tables } : {}),
      authorId: user.uid,
      authorName: user.displayName || '이름 없음',
      sharedGroupIds: groupId ? [groupId] : [],
      // Keep에서 가져온 메모만 붙는다. 다음에 또 가져올 때 같은 메모를 알아본다.
      ...(data.keepId ? { keepId: data.keepId } : {})
    };

    const ref = await addDoc(collectionRef, newMemoData);

    // 메모에는 역링크 처리가 아예 없었다. 링크 추가 팝업에서 고른 항목이 메모
    // 쪽에만 붙고 상대(일정·기록·수업) 쪽에서는 연결이 안 보였다.
    await syncReverseLinks([], data.linkedItems, memoSourceMeta(ref.id, data.content, groupId), groupId || 'personal');

    return ref;
  };

  const updateMemo = async (firestoreId: string, data: { content?: string; labels?: string[]; completed?: boolean; imageUrl?: string; attachments?: MemoAttachment[]; linkedItems?: any[]; linkedItemsBase?: any[]; keepId?: string; favorite?: boolean; tables?: EntryTable[] }) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const docRef = groupId
       ? doc(db, 'groups', groupId, 'tasks', firestoreId)
       : doc(db, 'users', user.uid, 'tasks', firestoreId);

    const updateData: any = {};
    if (data.content !== undefined) {
      updateData.text = data.content;
      updateData.content = data.content;
    }
    if (data.labels !== undefined) updateData.labels = data.labels;
    if (data.completed !== undefined) updateData.completed = data.completed;
    if (data.imageUrl !== undefined) updateData.imageUrl = data.imageUrl;
    if (data.attachments !== undefined) updateData.attachments = data.attachments;
    if (data.linkedItems !== undefined) updateData.linkedItems = data.linkedItems;
    if (data.keepId !== undefined) updateData.keepId = data.keepId;
    if (data.favorite !== undefined) updateData.favorite = data.favorite;
    if (data.tables !== undefined) updateData.tables = data.tables;

    const previous = memos.find((m) => m.firestoreId === firestoreId);
    let result: void;
    if (data.linkedItems !== undefined && data.linkedItemsBase !== undefined) {
      // 링크는 칸이 더하고 뺀 것만 서버의 지금 목록에 옮긴다 (칸을 연 사이 걸린 역링크를 덮지 않게)
      result = await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) throw new Error('메모를 찾지 못했습니다. 다른 곳에서 지웠을 수 있습니다.');
        tx.update(docRef, {
          ...updateData,
          linkedItems: mergeLinkEdits(snap.data().linkedItems, data.linkedItemsBase, data.linkedItems),
        });
      });
    } else {
      result = await updateDoc(docRef, updateData);
    }

    await syncReverseLinks(
      previous?.linkedItems,
      data.linkedItems,
      memoSourceMeta(firestoreId, data.content ?? previous?.content ?? '', groupId),
      groupId || 'personal'
    );

    return result;
  };

  const deleteMemo = async (firestoreId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const docRef = groupId
       ? doc(db, 'groups', groupId, 'tasks', firestoreId)
       : doc(db, 'users', user.uid, 'tasks', firestoreId);

    // 휴지통에 넣을 원본. 화면 목록에 없으면(아직 못 받았거나 링크로 연 칸) 서버에서 읽는다.
    // ⚠️ 예전에는 목록에 없으면 휴지통을 건너뛰고, 휴지통에 못 넣어도 지워서 되돌릴 길 없이 사라졌다.
    let targetMemo: Memo | undefined = memos.find(m => m.firestoreId === firestoreId);
    if (!targetMemo) {
      try {
        const { snap } = await getDocTrustingServer(docRef);
        if (snap.exists()) {
          const d = snap.data() as any;
          targetMemo = { firestoreId, ...d, content: d.text || d.content || '' } as Memo;
        }
      } catch (e) {
        console.warn('지울 메모를 서버에서 읽지 못했습니다:', e);
      }
    }
    // 휴지통 문서 id - 지운 뒤 안내의 '되돌리기'가 이것으로 되살린다
    let trashId: string | undefined;
    if (targetMemo) {
      try {
        trashId = await moveToTrash({
          id: targetMemo.firestoreId,
          type: 'memo',
          fId: groupId || 'personal',
          content: targetMemo.content || targetMemo.text || '',
          data: targetMemo,
        });
      } catch (e) {
        failWithToast('휴지통에 옮기지 못해 메모를 지우지 않았습니다. 네트워크를 확인해 주세요.', e);
      }
    }
    await deleteDoc(docRef);
    return trashId;
  };

  // 카드의 단추가 기다리지 않고 부른다. 실패하면 안내만 한다(예전엔 조용히 실패했다).
  // 완료로 옮기면 카드가 아래 '완료' 구역으로 가서, 잘못 눌렀으면 찾아 내려가야 했다 - 안내에 '되돌리기'
  const toggleComplete = async (memo: Memo) => {
    const completed = !memo.completed;
    try {
      const r = await updateMemo(memo.firestoreId, { completed });
      if (completed) {
        showUndoToast('✅ 메모를 완료로 옮겼습니다.', async () => {
          await updateMemo(memo.firestoreId, { completed: false });
          return '↩️ 메모를 진행으로 되돌렸습니다.';
        });
      }
      return r;
    } catch (e) {
      showErrorToast('메모 완료 표시를 저장하지 못했습니다.', e);
    }
  };

  /** 즐겨찾기 켜고 끄기. 켠 메모는 목록 맨 위에 모인다. */
  const toggleFavorite = async (memo: Memo) => {
    try {
      return await updateMemo(memo.firestoreId, { favorite: !memo.favorite });
    } catch (e) {
      showErrorToast('즐겨찾기를 저장하지 못했습니다.', e);
    }
  };

  /**
   * '☐ 우유' 줄을 눌러 ☑ 로 (다시 누르면 ☐). 글자만 바꾼다 (lib/checkLines).
   * 서버의 지금 글에서 그 줄만 바꾼다 - 다른 기기에서 고친 다른 줄을 덮지 않고, 그 줄이 보던 것과
   * 달라졌으면 바꾸지 않는다. 성공하면 true.
   */
  const toggleCheckLine = async (memo: Memo, lineIndex: number, shownLine: string): Promise<boolean> => {
    const user = auth.currentUser;
    if (!user) return false;
    const docRef = groupId
      ? doc(db, 'groups', groupId, 'tasks', memo.firestoreId)
      : doc(db, 'users', user.uid, 'tasks', memo.firestoreId);
    try {
      const done = await runTransaction(db, async (tx) => {
        const snap = await tx.get(docRef);
        if (!snap.exists()) throw new Error('메모를 찾지 못했습니다. 다른 곳에서 지웠을 수 있습니다.');
        const data = snap.data();
        const next = toggleCheckLineText(data.text || data.content || '', lineIndex, shownLine);
        if (next === null) return false;
        tx.update(docRef, { text: next, content: next });
        return true;
      });
      if (!done) showToast('그 사이 메모 글이 바뀌어 체크하지 않았습니다. 바뀐 글을 보고 다시 눌러 주세요.');
      return done;
    } catch (e) {
      showErrorToast('체크 표시를 저장하지 못했습니다.', e);
      return false;
    }
  };

  /** 휴지통 문서 id들을 돌려준다 (지운 뒤 안내의 '되돌리기') */
  const deleteCompletedMemos = async (memosToDelete?: Memo[]): Promise<string[]> => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const targets = memosToDelete || memos.filter(m => m.completed);
    if (targets.length === 0) return [];

    // 휴지통에 넣은 메모만 지운다. 못 넣은 것은 남기고 알린다(지우면 되돌릴 길이 없다).
    let failed = 0;
    const trashIds: string[] = [];
    await Promise.all(
      targets.map(async (targetMemo) => {
        try {
          const trashId = await moveToTrash({
            id: targetMemo.firestoreId,
            type: 'memo',
            fId: groupId || 'personal',
            content: targetMemo.content || targetMemo.text || '',
            data: targetMemo,
          });
          if (trashId) trashIds.push(trashId);
        } catch (e) {
          console.error('Failed to move memo to trash:', e);
          failed += 1;
          return;
        }

        const docRef = groupId
           ? doc(db, 'groups', groupId, 'tasks', targetMemo.firestoreId)
           : doc(db, 'users', user.uid, 'tasks', targetMemo.firestoreId);
        return deleteDoc(docRef);
      })
    );
    if (failed > 0) {
      failWithToast(`메모 ${failed}개는 휴지통에 옮기지 못해 지우지 않았습니다. 네트워크를 확인해 주세요.`);
    }
    return trashIds;
  };

  /**
   * 라벨이 없는 메모(완료된 것 포함)에 한 라벨을 붙인다. 붙인 개수를 돌려준다.
   * 라벨 밭만 고치므로 본문·링크는 건드리지 않는다. 수백 개일 수 있어
   * 하나씩 저장하지 않고 묶음으로 보낸다.
   */
  const labelUnlabeledMemos = async (label: string): Promise<number> => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const targets = memos.filter(isUnlabeledMemo);
    for (let i = 0; i < targets.length; i += BATCH_SIZE) {
      const batch = writeBatch(db);
      for (const memo of targets.slice(i, i + BATCH_SIZE)) {
        const docRef = groupId
          ? doc(db, 'groups', groupId, 'tasks', memo.firestoreId)
          : doc(db, 'users', user.uid, 'tasks', memo.firestoreId);
        batch.update(docRef, { labels: [label] });
      }
      await batch.commit();
    }
    return targets.length;
  };

  /**
   * 두 메모의 차례를 맞바꾼다 (▲▼).
   * order만 서로 바꾸므로, 거르개에 가려 안 보이는 메모의 차례는 흔들리지 않는다.
   */
  const swapMemoOrder = async (a: Memo, b: Memo) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    const ref = (id: string) => (groupId ? doc(db, 'groups', groupId, 'tasks', id) : doc(db, 'users', user.uid, 'tasks', id));
    const oa = a.order ?? -a.createdAt;
    let ob = b.order ?? -b.createdAt;
    // 같은 값이면 바꿔도 그대로다. 한 칸 벌려 둔다.
    if (oa === ob) ob = oa + (a.createdAt >= b.createdAt ? 1 : -1);
    const batch = writeBatch(db);
    batch.update(ref(a.firestoreId), { order: ob });
    batch.update(ref(b.firestoreId), { order: oa });
    try {
      await batch.commit();
    } catch (err) {
      showErrorToast('메모 차례를 바꾸지 못했습니다.', err);
    }
  };

  return { memos, loading, addMemo, updateMemo, deleteMemo, toggleComplete, toggleFavorite, toggleCheckLine, deleteCompletedMemos, labelUnlabeledMemos, swapMemoOrder };
}