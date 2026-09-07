import { useState, useEffect } from 'react';
import { collection, onSnapshot, doc, addDoc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { moveToTrash } from '../utils/trashHelper';

export interface MemoAttachment {
  name: string;
  url: string;
  type?: string;
  size?: number;
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
  authorId?: string;
  authorName?: string;
  groupId?: string;
  isShared?: boolean;
}

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

    // V3의 모든 구버전/신버전 문서를 누락 없이 구독
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
        } as Memo);
      });

      // 최신순 정렬
      newMemos.sort((a, b) => b.createdAt - a.createdAt);
      setMemos(newMemos);
      setLoading(false);
    }, (error) => {
      console.error('메모 로드 오류:', error);
      setLoading(false);
    });

    return () => unsubscribe();
  }, [groupId, auth.currentUser?.uid]);

  const addMemo = async (data: { content: string; labels?: string[]; imageUrl?: string; attachments?: MemoAttachment[] }) => {
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
      authorId: user.uid,
      authorName: user.displayName || '선생님',
      sharedGroupIds: groupId ? [groupId] : []
    };

    return await addDoc(collectionRef, newMemoData);
  };

  const updateMemo = async (firestoreId: string, data: { content?: string; labels?: string[]; completed?: boolean; imageUrl?: string; attachments?: MemoAttachment[] }) => {
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

    return await updateDoc(docRef, updateData);
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

  return { memos, loading, addMemo, updateMemo, deleteMemo, toggleComplete, deleteCompletedMemos };
}
