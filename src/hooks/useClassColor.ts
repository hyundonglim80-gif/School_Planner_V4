// src/hooks/useClassColor.ts
//
// 교과 모드의 반 색 (docs/ROADMAP-SUBJECT.md S3). 하루·주간 수업 칸이 같은 반을 같은 색으로 그리게 한 곳에서 고른다.
// 명렬표는 교과 모드일 때만 구독한다 - 초등 담임은 읽기가 늘지 않는다.
import { useCallback, useMemo } from 'react';
import { useRoster } from './useRoster';
import { useTeachingMode } from './useTeachingMode';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';
import { classColor, classesForYear, type ClassColorClasses } from '../lib/teachingSlot';

/** 반 '5-2' → 색 클래스. dateStr의 학년도 반 차례로 돌려쓴다 (없으면 오늘) */
export function useClassColorOf(dateStr?: string): (label: string) => ClassColorClasses {
  const { mode, isClassUnit } = useTeachingMode();
  const { rosterList } = useRoster(isClassUnit);
  const schoolYear = schoolYearOf(dateStr || formatDateStr(new Date()));
  const labels = useMemo(() => classesForYear(rosterList, schoolYear).map((c) => c.label), [rosterList, schoolYear]);
  return useCallback((label: string) => classColor(label, mode.classColors, labels), [mode.classColors, labels]);
}
