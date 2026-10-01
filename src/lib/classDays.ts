// src/lib/classDays.ts
//
// 그날 수업이 없는가 - 시간표 적용과 진도 세기(lib/progress)가 같은 규칙을 쓴다.
//
// 수업이 없는 날: 방학(시간표 설정의 방학 기간), 공휴일, 수업X 일정이 있는 날, 내용에 '휴업'이 든 일정이 있는 날.
// 주말은 여기서 보지 않는다 - 시간표 적용은 평일만 돌고, 진도는 수업 문서에 실제로 적힌 과목을 센다(토요 보강도 수업이다).
//
// 예전에 시간표 적용은 방학·일정만 보고 공휴일을 보지 않았다(설명서와 확인 창은 '공휴일 제외'라고 했다).
// 공휴일이 events 문서의 일정으로 들어 있던 V3 시절에는 맞았지만, 공휴일이 holidays/{연도}로 옮겨 간 뒤로는
// 공휴일에도 과목이 채워졌다. V3는 공휴일과 수업X 라벨(labelIds)을 본다(js/core/utils.js isRedDay).
import { readEventList } from './eventText';
import { isHolidayEvent } from './holiday';
import { isVacationDay, type SemesterConfig } from './semester';

export type ClassOffReason = 'vacation' | 'holiday' | 'skip';

/** 라벨의 수업X 속성만 본다 (useLabels의 EventLabel과 같은 모양) */
export interface SkipLabel {
  id: string;
  name: string;
  skip?: boolean;
}

export interface ClassDayRules {
  semesterConfig?: SemesterConfig | null;
  /** '2026-10-03' → '개천절' */
  holidays?: Record<string, string>;
  /** 일정 라벨 - V3 일정은 수업X를 라벨(labelIds)로만 들고 있다 */
  eventLabels?: SkipLabel[];
}

/**
 * 이 일정이 그날 수업을 비우는가.
 * 일정에 skip이 적혀 있으면 그것을 따른다(V4가 일정마다 켜고 끈 것). 없으면 라벨의 수업X 속성.
 * 내용에 '휴업'이 들어 있어도 비운다(예전부터의 규칙, 설명서 '속성 5가지').
 */
export function eventSkipsClass(item: any, eventLabels: SkipLabel[] = []): boolean {
  if (!item || typeof item !== 'object') return false;
  if (String(item.content || item.text || '').includes('휴업')) return true;
  if (typeof item.skip === 'boolean') return item.skip;
  if (typeof item.isSkip === 'boolean') return item.isSkip;

  const ids: string[] = Array.isArray(item.labelIds) ? item.labelIds.map(String) : [];
  const names: string[] = String(item.label || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  return eventLabels.some((l) => l.skip && (ids.includes(l.id) || names.includes(l.name)));
}

/**
 * 그날 수업이 없는 까닭. 수업하는 날이면 null.
 * eventsDoc은 그날 events 문서의 데이터(없으면 null) - V3 옛 글(eventText)만 있는 날도 읽는다.
 */
export function classOffReason(dateStr: string, eventsDoc: any, rules: ClassDayRules): ClassOffReason | null {
  if (rules.semesterConfig && isVacationDay(dateStr, rules.semesterConfig)) return 'vacation';
  if (rules.holidays?.[dateStr]) return 'holiday';
  if (eventsDoc) {
    const list = readEventList(eventsDoc);
    // V3 시절의 공휴일 일정(라벨 '공휴일')도 공휴일이다
    if (list.some((it: any) => isHolidayEvent(it))) return 'holiday';
    if (list.some((it: any) => eventSkipsClass(it, rules.eventLabels))) return 'skip';
  }
  return null;
}
