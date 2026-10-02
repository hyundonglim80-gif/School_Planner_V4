// src/hooks/useTeachingMode.ts
//
// 교사 유형 (lib/teachingMode, docs/ROADMAP-SUBJECT.md S1). 모드는 이것 하나로만 읽는다 -
// 컴포넌트가 문서를 따로 구독하지 않는다. 구독은 App이 로그인 뒤 한 번(useTeachingModeSync).
import { useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { DEFAULT_TEACHING_MODE, presetOf, subscribeTeachingMode, type TeacherPreset, type TeachingMode } from '../lib/teachingMode';

export interface TeachingModeView {
  mode: TeachingMode;
  /** 서버 답을 받았나 */
  loaded: boolean;
  /** 계정에 교사 유형 문서가 있나 (없으면 처음 안내 띠) */
  exists: boolean;
  preset: TeacherPreset;
  /** 반+과목 단위 (교과 전담·교과+담임) - 새 동작은 이것이 참일 때만 켠다 */
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

/** 로그인한 동안 교사 유형 문서를 구독해 store에 넣는다 (App에서 한 번) */
export function useTeachingModeSync(uid: string | null | undefined) {
  useEffect(() => {
    if (!uid) {
      useAppStore.setState({ teachingMode: DEFAULT_TEACHING_MODE, teachingModeLoaded: false, teachingModeExists: false });
      return;
    }
    return subscribeTeachingMode(uid, (teachingMode, exists) =>
      useAppStore.setState({ teachingMode, teachingModeLoaded: true, teachingModeExists: exists })
    );
  }, [uid]);
}
