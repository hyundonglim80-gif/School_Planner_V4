// src/hooks/useTeachingMode.ts
//
// 교사 유형 (lib/teachingMode, docs/ROADMAP-SUBJECT.md). 모드는 이것 하나로만 읽는다 -
// 컴포넌트가 v4_teaching 문서를 따로 구독하지 않는다(App이 store에 넣는다).
// 새 동작은 늘 isClassUnit일 때만 켠다. 문서가 없으면 초등 담임 = 지금까지의 V4.
import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_TEACHING_MODE, presetOf, saveTeachingMode, subscribeTeachingMode, type TeacherPreset, type TeachingMode } from '../lib/teachingMode';
import { auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';

export interface TeachingModeView {
  mode: TeachingMode;
  loaded: boolean;
  /** 문서가 있었나 (없으면 처음 안내 띠) */
  exists: boolean;
  preset: TeacherPreset;
  /** 반+과목 단위 (교과 전담·교과+담임) */
  isClassUnit: boolean;
  /** 알림장·출석부 같은 담임 도구를 보이나 (교과 전담만 숨긴다) */
  showHomeroomTools: boolean;
}

export function useTeachingMode(): TeachingModeView {
  const mode = useAppStore((s) => s.teachingMode);
  const loaded = useAppStore((s) => s.teachingModeLoaded);
  const exists = useAppStore((s) => s.teachingModeExists);
  const preset = presetOf(mode);
  return { mode, loaded, exists, preset, isClassUnit: mode.unit === 'class', showHomeroomTools: preset !== 'subject' };
}

/** App에서 로그인 뒤 한 번 - 계정의 교사 유형을 store에 넣는다 */
export function useTeachingModeSync(uid: string | undefined) {
  useEffect(() => {
    if (!uid) return;
    // 계정이 바뀌면 앞 계정의 값을 쓰지 않게 처음으로
    useAppStore.setState({ teachingMode: DEFAULT_TEACHING_MODE, teachingModeLoaded: false, teachingModeExists: false });
    return subscribeTeachingMode(uid, (m, exists) => useAppStore.getState().setTeachingMode(m, exists));
  }, [uid]);
}

/** 바뀐 칸만 저장하고 안내한다. 실패하면 안내만 (설정 칸이라 다시 고르면 된다) */
export async function saveTeachingPatch(patch: Partial<TeachingMode>, done = '교사 유형을 저장했습니다.') {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  try {
    await saveTeachingMode(uid, patch);
    showToast(`🧑‍🏫 ${done}`);
  } catch (e) {
    showErrorToast('저장하지 못했습니다. 잠시 뒤 다시 골라 주세요.', e);
  }
}
