import { useState, useEffect, useCallback } from 'react';
import {
  collection,
  query,
  where,
  onSnapshot,
  addDoc,
  doc,
  setDoc,
  getDoc,
  updateDoc,
  deleteDoc,
  arrayUnion,
  arrayRemove,
  getDocs,
  writeBatch,
} from 'firebase/firestore';
import { db, auth } from '../lib/firebase';

// 💡 예전에는 초대 코드로 참여할 때 groups 컬렉션 전체를 inviteCode로 조회했다.
// 그러려면 보안 규칙에서 groups 목록 조회를 열어야 하고, 그러면 로그인한
// 사람 누구나 모든 그룹의 이름과 초대 코드를 읽을 수 있다.
// 그래서 코드 -> 그룹 ID 매핑만 담은 문서를 따로 두고 그 한 건만 조회한다.
const INVITE_CODES = 'inviteCodes';

const inviteCodeRef = (code: string) => doc(db, INVITE_CODES, code);

// 그룹 문서 아래에 달린 하위 컬렉션들.
// 💡 Firestore는 문서를 지워도 하위 컬렉션을 함께 지우지 않는다. 예전에는
// 그룹 문서만 지워서 일정/수업/기록/메모가 접근할 방법도 지울 방법도 없이
// 영영 남아 있었다. 그룹 문서를 지우기 전에 먼저 비운다.
const GROUP_SUBCOLLECTIONS = ['events', 'schedules', 'journals', 'tasks', 'evaluations'];

async function deleteGroupSubcollections(groupId: string) {
  for (const colName of GROUP_SUBCOLLECTIONS) {
    const snap = await getDocs(collection(db, 'groups', groupId, colName));
    // 배치는 한 번에 500건까지만 처리할 수 있다
    let batch = writeBatch(db);
    let count = 0;
    for (const d of snap.docs) {
      batch.delete(d.ref);
      count++;
      if (count === 450) {
        await batch.commit();
        batch = writeBatch(db);
        count = 0;
      }
    }
    if (count > 0) await batch.commit();
  }
}

// 이미 만들어진 그룹에도 매핑 문서를 만들어 준다(그룹장 접속 시 1회).
const backfilledCodes = new Set<string>();
async function ensureInviteCodeDoc(group: GroupItem, uid: string) {
  if (!group.inviteCode || group.ownerId !== uid) return;
  if (backfilledCodes.has(group.inviteCode)) return;
  backfilledCodes.add(group.inviteCode);
  try {
    const snap = await getDoc(inviteCodeRef(group.inviteCode));
    if (!snap.exists()) {
      await setDoc(inviteCodeRef(group.inviteCode), {
        groupId: group.id,
        ownerId: group.ownerId,
        createdAt: Date.now(),
      });
    }
  } catch (e) {
    console.warn('초대 코드 매핑 생성 실패:', e);
  }
}

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
        // 기존 그룹의 초대 코드 매핑을 채운다 (실패해도 그룹 사용에는 지장 없음)
        list.forEach((g) => ensureInviteCodeDoc(g, user.uid));
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

    // 이미 쓰이는 코드면 다시 뽑는다
    let inviteCode = generateInviteCode();
    for (let i = 0; i < 5; i++) {
      const existing = await getDoc(inviteCodeRef(inviteCode));
      if (!existing.exists()) break;
      inviteCode = generateInviteCode();
    }

    const newGroupData = {
      name: name.trim(),
      ownerId: user.uid,
      ownerName: user.displayName || '선생님',
      inviteCode,
      members: [user.uid],
      createdAt: Date.now(),
    };

    // ⚠️ 그룹 문서를 만들면 곧바로 위의 onSnapshot이 깨어나 ensureInviteCodeDoc을
    //    부른다. 그 쪽도 같은 초대 코드 문서를 쓰려 하므로 둘이 맞부딪친다.
    //    규칙에 inviteCodes의 update가 없어서(create만 있다) 늦게 쓴 쪽이 거부되고,
    //    그 오류가 그대로 올라와 그룹 만들기가 실패한 것처럼 보였다.
    //    화면에는 'PERMISSION_DENIED: false for create @ L55'가 그대로 떴다.
    //    코드를 먼저 찜해 두어 저쪽이 손대지 않게 한다.
    backfilledCodes.add(inviteCode);

    const docRef = await addDoc(collection(db, 'groups'), newGroupData);

    try {
      const existing = await getDoc(inviteCodeRef(inviteCode));
      if (!existing.exists()) {
        await setDoc(inviteCodeRef(inviteCode), {
          groupId: docRef.id,
          ownerId: user.uid,
          createdAt: Date.now(),
        });
      }
    } catch (e) {
      // 매핑을 못 만들어도 그룹은 이미 만들어졌다. 그룹장이 다음에 앱을 열 때
      // ensureInviteCodeDoc이 다시 채운다. 여기서 실패로 되돌리면 안 된다.
      console.warn('초대 코드 매핑 생성 실패(그룹은 만들어짐):', e);
    }

    return { id: docRef.id, ...newGroupData };
  }, []);

  // 초대 코드로 참여
  const joinGroup = useCallback(async (code: string) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');
    const cleanCode = code.trim().toUpperCase();
    if (!cleanCode) throw new Error('초대 코드를 입력해 주세요.');

    // 코드 -> 그룹 ID 매핑 문서 한 건만 읽는다
    let groupId: string | null = null;
    const mapSnap = await getDoc(inviteCodeRef(cleanCode));
    if (mapSnap.exists()) {
      groupId = mapSnap.data().groupId || null;
    } else {
      // 매핑이 아직 없는 예전 그룹을 위한 폴백.
      // ⚠️ 이 조회는 그룹 목록을 훑는 것이라, 규칙을 조이면 권한 거부가 난다.
      //    그때 여기서 예외가 터지면 참여 자체가 막히므로 반드시 감싸 둔다.
      //    모든 그룹에 매핑이 생기면 이 경로는 지워도 된다.
      try {
        const q = query(collection(db, 'groups'), where('inviteCode', '==', cleanCode));
        const snapshot = await getDocs(q);
        if (!snapshot.empty) groupId = snapshot.docs[0].id;
      } catch (e) {
        console.warn('옛 그룹 폴백 조회 실패(매핑이 있으면 문제 없음):', e);
      }
    }

    if (!groupId) {
      throw new Error('일치하는 초대 코드의 그룹을 찾을 수 없습니다.');
    }

    // ⚠️ 참여하기 전에 그룹 문서를 읽을 수 있다고 가정하면 안 된다.
    //    규칙을 조이면 '아직 구성원이 아닌 사람'은 그룹을 읽을 수 없다.
    //    읽히면 이미 구성원인지 가려내고, 안 읽히면 그냥 참여를 시도한다.
    const groupRef = doc(db, 'groups', groupId);
    let name = '공유 그룹';
    try {
      const snap = await getDoc(groupRef);
      if (snap.exists()) {
        const data = snap.data() as GroupItem;
        name = data.name || name;
        if (data.members && data.members.includes(user.uid)) {
          throw new Error('이미 참여 중인 그룹입니다.');
        }
      }
    } catch (e: any) {
      if (e?.message === '이미 참여 중인 그룹입니다.') throw e;
      // 못 읽었다 = 아직 구성원이 아니다. 계속 진행한다.
    }

    try {
      await updateDoc(groupRef, {
        members: arrayUnion(user.uid),
        // 누가 들어왔는지 그룹장이 볼 수 있게 남긴다. V3가 쓰는 모양과 맞춘다.
        // 점이 든 키는 updateDoc에서만 '하위 필드'로 해석된다 (setDoc은 그 이름의
        // 필드를 통째로 만든다). 규칙이 바뀐 필드를 볼 때 이 차이가 갈린다.
        [`memberDetails.${user.uid}`]: {
          name: user.displayName || '이름 없음',
          joinedAt: Date.now(),
          photoURL: user.photoURL || '',
        },
      });
    } catch (e) {
      console.error('그룹 참여 실패:', e);
      throw new Error('그룹에 참여하지 못했습니다. 초대 코드를 다시 확인해 주세요.');
    }

    // 이제는 구성원이므로 이름을 읽을 수 있다
    try {
      const after = await getDoc(groupRef);
      if (after.exists()) name = (after.data() as GroupItem).name || name;
    } catch {
      /* 이름을 못 읽어도 참여는 끝났다 */
    }

    return { id: groupId, name };
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

    // 하위 데이터를 먼저 비운다. 여기서 실패하면 그룹 문서는 남겨 두어
    // 다시 시도할 수 있게 한다(그룹 문서를 먼저 지우면 접근 자체가 막힌다).
    await deleteGroupSubcollections(groupId);

    await deleteDoc(doc(db, 'groups', groupId));
    if (group.inviteCode) {
      try {
        await deleteDoc(inviteCodeRef(group.inviteCode));
      } catch (e) {
        console.warn('초대 코드 매핑 삭제 실패:', e);
      }
    }
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
