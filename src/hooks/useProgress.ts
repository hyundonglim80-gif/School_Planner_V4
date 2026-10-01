// src/hooks/useProgress.ts
//
// 진도 관리(lib/progress, docs/ROADMAP.md 5번)를 화면에 잇는다.
// - useProgressPlans: users/{uid}/v4_progress 목록 (V4 전용)
// - useProgressInputs: 진도를 세는 데 필요한 수업·일정 문서(읽기만)와 '수업이 없는 날' 판정
// - useProgressMarks: 하루·주간 수업 칸에 겹쳐 보일 교시별 진도
import { useEffect, useMemo, useState } from 'react';
import { auth } from '../lib/firebase';
import {
  offDayChecker,
  progressMarks,
  schoolYearEnd,
  subscribeProgressInputs,
  subscribeProgressPlans,
  type ProgressInputs,
  type ProgressMark,
  type ProgressPlan,
} from '../lib/progress';
import type { SemesterConfig } from '../lib/semester';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from './useLabels';
import { loadHolidayYears } from './useGovHolidays';
import { useTimetableTemplate } from './useTimetableTemplate';

const isDay = (s: string) => /^(20\d\d)-\d\d-\d\d$/.test(s);

/** 진도 목록. loaded는 서버에서 한 번이라도 답을 받았는가 */
export function useProgressPlans(): { plans: ProgressPlan[]; loaded: boolean } {
  const uid = auth.currentUser?.uid;
  const [state, setState] = useState<{ plans: ProgressPlan[]; loaded: boolean }>({ plans: [], loaded: false });
  useEffect(() => {
    if (!uid) return;
    return subscribeProgressPlans(
      uid,
      (plans) => setState({ plans, loaded: true }),
      (err) => console.warn('진도 목록을 불러오지 못했습니다:', err)
    );
  }, [uid]);
  return state;
}

/**
 * from~to의 수업·일정 문서(개인 공간)와, 그날 수업이 없는지 가리는 함수.
 * inputs는 두 문서 묶음이 모두 답하기 전에는 null이다.
 */
export function useProgressInputs(
  from: string,
  to: string,
  semesterConfig?: SemesterConfig | null
): { inputs: ProgressInputs | null; isOffDay: (date: string) => boolean } {
  const uid = auth.currentUser?.uid;
  const { eventLabels } = useLabels();
  const [inputs, setInputs] = useState<ProgressInputs | null>(null);
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const valid = !!uid && isDay(from) && isDay(to) && from <= to;

  useEffect(() => {
    setInputs(null);
    if (!valid) return;
    return subscribeProgressInputs(uid!, from, to, setInputs, (err) =>
      console.warn('진도를 세는 수업·일정 문서를 불러오지 못했습니다:', err)
    );
  }, [uid, from, to, valid]);

  useEffect(() => {
    if (!valid) return;
    let alive = true;
    const years: number[] = [];
    for (let y = Number(from.slice(0, 4)); y <= Number(to.slice(0, 4)); y++) years.push(y);
    loadHolidayYears(years).then((h) => {
      if (alive) setHolidays(h);
    });
    return () => {
      alive = false;
    };
  }, [from, to, valid]);

  const isOffDay = useMemo(
    () => offDayChecker(inputs?.eventsByDate || {}, { semesterConfig, holidays, eventLabels }),
    [inputs, semesterConfig, holidays, eventLabels]
  );
  return { inputs, isOffDay };
}

const NO_MARKS: Record<string, ProgressMark> = {};

/**
 * 하루·주간 수업 칸에 겹쳐 보일 진도 (slotId → 진도). viewDate는 화면에 보이는 마지막 날.
 * - 개인 공간에서만 (진도는 개인 공간의 수업으로 센다. 그룹 공간의 수업 칸에는 겹치지 않는다).
 * - 진도가 하나도 없으면 수업·일정 문서를 읽지 않는다.
 * - 읽는 범위는 가장 이른 진도 시작일 ~ 보는 날이 든 학년도 끝. 날짜를 넘길 때마다 다시 읽지 않게 학년도 끝으로 묶는다
 *   (하루·주간이 같은 범위를 구독하면 Firestore가 한 구독으로 나눠 쓴다).
 */
export function useProgressMarks(viewDate: string): { marks: Record<string, ProgressMark>; plans: ProgressPlan[] } {
  const inGroup = useAppStore((s) => !!s.selectedGroupId);
  const { plans } = useProgressPlans();
  const { semesterConfig } = useTimetableTemplate();
  const active = useMemo(
    () => (inGroup ? [] : plans.filter((p) => p.key && isDay(p.startDate) && p.lessons.length > 0)),
    [plans, inGroup]
  );
  const from = active.reduce((min, p) => (!min || p.startDate < min ? p.startDate : min), '');
  const to = isDay(viewDate) ? schoolYearEnd(viewDate) : '';
  const on = !!from && !!to && from <= to;
  const { inputs, isOffDay } = useProgressInputs(on ? from : '', on ? to : '', semesterConfig);
  const marks = useMemo(
    () => (on && inputs ? progressMarks(active, inputs.subjectsByDate, isOffDay) : NO_MARKS),
    [on, inputs, active, isOffDay]
  );
  return { marks, plans };
}
