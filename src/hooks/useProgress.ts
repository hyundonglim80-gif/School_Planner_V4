// src/hooks/useProgress.ts
//
// 진도 관리(lib/progress, docs/ROADMAP.md 5번)를 화면에 잇는다.
// - useProgressPlans: users/{uid}/v4_progress 목록 (V4 전용)
// - useProgressInputs: 진도를 세는 데 필요한 수업·일정 문서(읽기만)와 '수업이 없는 날' 판정
import { useEffect, useMemo, useState } from 'react';
import { auth } from '../lib/firebase';
import {
  offDayChecker,
  subscribeProgressInputs,
  subscribeProgressPlans,
  type ProgressInputs,
  type ProgressPlan,
} from '../lib/progress';
import type { SemesterConfig } from '../lib/semester';
import { useLabels } from './useLabels';
import { loadHolidayYears } from './useGovHolidays';

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
