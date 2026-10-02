// src/hooks/useTeachingMode.ts
//
// 교사 유형 (lib/teachingMode, docs/ROADMAP-SUBJECT.md). 화면은 모드를 이것 하나로만 읽는다.
// 문서는 App이 로그인 뒤 한 번 구독해 store에 넣는다 (useTeachingModeSync).
import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { presetOf, subscribeTeachingMode, type TeacherPreset, type TeachingMode } from '../lib/teachingMode';

export interface TeachingModeView {
  mode: TeachingMode;
  loaded: boolean;
  /** 계정에 문서가 있었나 */
  exists: boolean;
  preset: TeacherPreset;
  /** 반+과목 단위로 수업하나 (교과 전담·교과+담임) - 새 동작은 이것이 참일 때만 */
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

/** App에서 한 번만 건다 - 계정의 교사 유형 문서를 store에 맞춘다 */
export function useTeachingModeSync(uid: string | null | undefined) {
  useEffect(() => {
    if (!uid) return;
    return subscribeTeachingMode(uid, (m, exists) => useAppStore.getState().setTeachingModeState(m, exists));
  }, [uid]);
}
