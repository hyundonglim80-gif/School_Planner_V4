// src/components/SlotOptionsList.tsx
//
// 교과 모드의 시간표·수업 칸 제안 '5-1 과학', '5-2 과학'… (docs/ROADMAP-SUBJECT.md S2).
// 그 학년도 명렬표의 반 × 환경설정 '가르치는 과목'. 과목을 안 적었으면 반만.
// 명렬표를 구독하므로 교과 모드(isClassUnit)일 때만 그린다 - 초등 담임은 아무것도 바뀌지 않는다.
import { useMemo } from 'react';
import { useRoster } from '../hooks/useRoster';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { schoolYearOf } from '../lib/schoolSetting';
import { formatDateStr } from '../lib/dateUtils';
import { classesForYear, slotSuggestions } from '../lib/teachingSlot';

export const SLOT_OPTIONS_ID = 'sp4-slot-options';

interface Props {
  /** `<input list>`이 가리킬 id. 한 화면에 둘이 함께 뜰 수 있어 곳마다 다르게 준다 */
  id?: string;
  /** 어느 학년도의 반을 볼지 (없으면 오늘) */
  dateStr?: string;
}

export default function SlotOptionsList({ id = SLOT_OPTIONS_ID, dateStr }: Props) {
  const { mode } = useTeachingMode();
  const { rosterList } = useRoster();
  const schoolYear = schoolYearOf(dateStr || formatDateStr(new Date()));
  const options = useMemo(
    () => slotSuggestions(classesForYear(rosterList, schoolYear).map((c) => c.label), mode.subjects),
    [rosterList, schoolYear, mode.subjects]
  );
  return (
    <datalist id={id}>
      {options.map((o) => (
        <option key={o} value={o} />
      ))}
    </datalist>
  );
}
