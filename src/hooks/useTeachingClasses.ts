// src/hooks/useTeachingClasses.ts
//
// 교과 모드에서 가르치는 반과 수업 칸 제안 (19번 U1, lib/teachingSlot teachingClasses).
// 시간표 템플릿 + 명렬표 + 환경설정 '가르치는 반'을 합친다. 명렬표는 교과 모드일 때만 구독한다 - 초등 담임은 읽기가 늘지 않는다.
import { useMemo } from 'react';
import { useRoster } from './useRoster';
import { useTeachingMode } from './useTeachingMode';
import { useTimetableTemplate } from './useTimetableTemplate';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';
import { slotSuggestions, teachingClasses } from '../lib/teachingSlot';

/** dateStr의 학년도에 가르치는 반 (없으면 오늘). subjectsByDate가 있으면 수업 칸에 적힌 반도 */
export function useTeachingClasses(dateStr?: string, subjectsByDate?: Record<string, Record<string, string>>): string[] {
  const { mode, isClassUnit } = useTeachingMode();
  const { rosterList } = useRoster(isClassUnit);
  const { templates } = useTimetableTemplate();
  const schoolYear = schoolYearOf(dateStr || formatDateStr(new Date()));
  return useMemo(
    () =>
      isClassUnit
        ? teachingClasses({ rosters: rosterList, templates, subjectsByDate, settingClasses: mode.classes, schoolYear })
        : [],
    [isClassUnit, rosterList, templates, subjectsByDate, mode.classes, schoolYear]
  );
}

/** 수업 칸 ▼ 목록: 가르치는 반 × 가르치는 과목 ('5-1 과학', '5-2 과학'…). 과목이 없으면 반만 */
export function useSlotOptions(dateStr?: string): string[] {
  const { mode } = useTeachingMode();
  const classes = useTeachingClasses(dateStr);
  return useMemo(() => slotSuggestions(classes, mode.subjects), [classes, mode.subjects]);
}
