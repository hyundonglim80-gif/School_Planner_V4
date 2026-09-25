import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc, writeBatch } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { moveToTrash } from '../utils/trashHelper';
import { syncReverseLinks } from '../utils/linkUtils';
import { showErrorToast } from '../utils/toast';

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
          completed: !!data.completed,
          labels: data.labels || [],
          attachments: data.attachments || [],
          linkedItems: data.linkedItems || [],
        } as Memo);
      });
      
      newMemos.sort((a, b) => b.createdAt - a.createdAt);
      setMemos(newMemos);
      setLoading(false);
    }, (error) => {
      showErrorToast('메모를 불러오지 못했습니다.', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [groupId, auth.currentUser?.uid]);

  const addMemo = async (data: { content: string; labels?: string[]; imageUrl?: string; attachments?: MemoAttachment[]; linkedItems?: any[]; keepId?: string }) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const collectionRef = groupId 
       ? collection(db, 'groups', groupId, 'tasks')
       : collection(db, 'users', user.uid, 'tasks');

    const now = Date.now();
    const newMemoData = {
      text: data.content,
      content: data.content,
      completed: false,
      order: -now,
      createdAt: now,
      labels: data.labels || [],
      imageUrl: data.imageUrl || '',
      attachments: data.attachments || [],
      linkedItems: data.linkedItems || [],
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

  const updateMemo = async (firestoreId: string, data: { content?: string; labels?: string[]; completed?: boolean; imageUrl?: string; attachments?: MemoAttachment[]; linkedItems?: any[]; keepId?: string; favorite?: boolean }) => {
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

    const previous = memos.find((m) => m.firestoreId === firestoreId);
    const result = await updateDoc(docRef, updateData);

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

    const targetMemo = memos.find(m => m.firestoreId === firestoreId);
    if (targetMemo) {
      try {
        await moveToTrash({
          id: targetMemo.firestoreId,
          type: 'memo',
          fId: groupId || 'personal',
          content: targetMemo.content || targetMemo.text || '',
          data: targetMemo,
        });
      } catch (e) {
        console.error('Failed to move memo to trash:', e);
      }
    }

    const docRef = groupId 
       ? doc(db, 'groups', groupId, 'tasks', firestoreId)
       : doc(db, 'users', user.uid, 'tasks', firestoreId);
    return await deleteDoc(docRef);
  };

  const toggleComplete = async (memo: Memo) => {
    return await updateMemo(memo.firestoreId, { completed: !memo.completed });
  };

  /** 즐겨찾기 켜고 끄기. 켠 메모는 목록 맨 위에 모인다. */
  const toggleFavorite = async (memo: Memo) => {
    return await updateMemo(memo.firestoreId, { favorite: !memo.favorite });
  };

  const deleteCompletedMemos = async (memosToDelete?: Memo[]) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const targets = memosToDelete || memos.filter(m => m.completed);
    if (targets.length === 0) return;

    await Promise.all(
      targets.map(async (targetMemo) => {
        try {
          await moveToTrash({
            id: targetMemo.firestoreId,
            type: 'memo',
            fId: groupId || 'personal',
            content: targetMemo.content || targetMemo.text || '',
            data: targetMemo,
          });
        } catch (e) {
          console.error('Failed to move memo to trash:', e);
        }
        
        const docRef = groupId 
           ? doc(db, 'groups', groupId, 'tasks', targetMemo.firestoreId)
           : doc(db, 'users', user.uid, 'tasks', targetMemo.firestoreId);
        return deleteDoc(docRef);
      })
    );
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

  return { memos, loading, addMemo, updateMemo, deleteMemo, toggleComplete, toggleFavorite, deleteCompletedMemos, labelUnlabeledMemos };
}