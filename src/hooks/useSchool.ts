// src/hooks/useSchool.ts
//
// 환경설정 '우리 학교' (lib/schoolSetting, docs/ROADMAP.md 4-2). 학교를 고르지 않았으면 school은 null.
import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
import { sanitizeSchool, schoolSettingRef, type SchoolSetting } from '../lib/schoolSetting';

export function useSchool(): { school: SchoolSetting | null; loaded: boolean } {
  const [state, setState] = useState<{ school: SchoolSetting | null; loaded: boolean }>({ school: null, loaded: false });
  const uid = auth.currentUser?.uid;
  useEffect(() => {
    if (!uid) return;
    return subscribeDocWithServerFallback(
      schoolSettingRef(uid),
      (data) => setState({ school: sanitizeSchool(data), loaded: true }),
      (err) => console.warn('우리 학교 설정을 불러오지 못했습니다:', err)
    );
  }, [uid]);
  return state;
}
