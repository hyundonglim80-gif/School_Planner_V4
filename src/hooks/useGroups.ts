import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  doc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  getDocs,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

export interface GroupItem {
  id: string;
  name: string;
  ownerId: string;
  ownerName: string;
  inviteCode: string;
  members: string[];
  createdAt: number;
}

export function useGroups() {
  const [groups, setGroups] = useState<GroupItem[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setGroups([]);
      setLoading(false);
      return;
    }

    setLoading(true);

    const q = query(
      collection(db, 'groups'),
      where('members', 'array-contains', user.uid)
    );

    const unsubscribe = onSnapshot(
      q,
      (snapshot) => {
        const list: GroupItem[] = [];
        snapshot.forEach((d) => {
          list.push({ id: d.id, ...d.data() } as GroupItem);
        });
        setGroups(list);
        setLoading(false);
      },
      (error) => {
        console.error('그룹 로드 실패:', error);
        setLoading(false);
      }
    );

    return () => unsubscribe();
  }, [auth.currentUser]);

  // 랜덤 6자리 초대 코드 생성
  const generateInviteCode = () => {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = '';
    for (let i = 0; i < 6; i++) {
      code += chars.charAt(Math.floor(Math.random() * chars.length));
    }
    return code;
  };

  // 새 그룹 생성
  const createGroup = useCallback(async (name: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    if (!name.trim()) throw new Error('그룹 이름을 입력해 주세요.');

    const inviteCode = generateInviteCode();
    const newGroupData = {
      name: name.trim(),
      ownerId: user.uid,
      ownerName: user.displayName || '선생님',
      inviteCode,
      members: [user.uid],
      createdAt: Date.now(),
    };

    const docRef = await addDoc(collection(db, 'groups'), newGroupData);
    return { id: docRef.id, ...newGroupData };
  }, []);

  // 초대 코드로 참여
  const joinGroup = useCallback(async (code: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) throw new Error('초대 코드를 입력해 주세요.');

    const q = query(collection(db, 'groups'), where('inviteCode', '==', cleanCode));
    const snapshot = await getDocs(q);

    if (snapshot.empty) {
      throw new Error('일치하는 초대 코드의 그룹을 찾을 수 없습니다.');
    }

    const groupDoc = snapshot.docs[0];
    const data = groupDoc.data() as GroupItem;

    if (data.members && data.members.includes(user.uid)) {
      throw new Error('이미 참여 중인 그룹입니다.');
    }

    await updateDoc(doc(db, 'groups', groupDoc.id), {
      members: arrayUnion(user.uid),
    });

    return { id: groupDoc.id, name: data.name };
  }, []);

  // 그룹 탈퇴
  const leaveGroup = useCallback(async (groupId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const group = groups.find((g) => g.id === groupId);
    if (group && group.ownerId === user.uid) {
      throw new Error('그룹장은 탈퇴할 수 없습니다. 그룹 삭제를 이용해 주세요.');
    }

    await updateDoc(doc(db, 'groups', groupId), {
      members: arrayRemove(user.uid),
    });
  }, [groups]);

  // 그룹 삭제 (그룹장 전용)
  const deleteGroup = useCallback(async (groupId: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const group = groups.find((g) => g.id === groupId);
    if (!group || group.ownerId !== user.uid) {
      throw new Error('그룹 삭제 권한이 없습니다.');
    }

    await deleteDoc(doc(db, 'groups', groupId));
  }, [groups]);

  return {
    groups,
    loading,
    createGroup,
    joinGroup,
    leaveGroup,
    deleteGroup,
  };
}
