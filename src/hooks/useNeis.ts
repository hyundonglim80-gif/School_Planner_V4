// src/hooks/useNeis.ts
//
// 우리 학교(useSchool)의 나이스 급식·학사일정을 달마다 받아 온다 (lib/neis, docs/ROADMAP.md 4번).
// 학교를 고르지 않았으면 부르지 않는다. 받은 것은 lib/neis가 학교·달마다 담아 둔다.
import { useEffect, useState } from 'react';
import { loadMonthMeals, loadMonthSchedule, type NeisMeal, type NeisScheduleItem } from '../lib/neis';
import { filterScheduleByGrade } from '../lib/schoolSetting';
import { useSchool } from './useSchool';

export type SchoolEventsByDate = Record<string, NeisScheduleItem[]>;
const NONE: SchoolEventsByDate = {};

/**
 * 여러 달(YYYY-MM)의 학사일정을 날짜별로. 고른 학년으로 거른다 (공휴일·토요휴업일은 lib/neis가 뺐다).
 * 한 달을 못 받으면 그 달만 비운다 (다른 달은 보인다). 학교가 없으면 빈 표.
 */
export function useSchoolSchedule(months: string[]): { byDate: SchoolEventsByDate; hasSchool: boolean } {
  const { school } = useSchool();
  const monthsKey = [...new Set(months)].sort().join(',');
  const id = school && monthsKey ? `${school.officeCode}:${school.schoolCode}:${school.grade}:${monthsKey}` : '';
  const [got, setGot] = useState<{ id: string; byDate: SchoolEventsByDate }>({ id: '', byDate: NONE });

  useEffect(() => {
    if (!school || !monthsKey) return;
    let alive = true;
    Promise.all(
      monthsKey.split(',').map((m) =>
        loadMonthSchedule(school, m).catch((e) => {
          console.warn(`${m} 학사일정을 불러오지 못했습니다:`, e);
          return [] as NeisScheduleItem[];
        })
      )
    ).then((lists) => {
      if (!alive) return;
      const byDate: SchoolEventsByDate = {};
      for (const it of filterScheduleByGrade(lists.flat(), school.grade)) (byDate[it.date] ||= []).push(it);
      setGot({ id, byDate });
    });
    return () => {
      alive = false;
    };
    // months 배열은 그릴 때마다 새로 만들어지므로 글자(monthsKey)로 본다
  }, [school, monthsKey, id]);

  return { byDate: got.id === id && id ? got.byDate : NONE, hasSchool: !!school };
}

/** 그날 급식 (조·중·석식). 학교가 없으면 school: null */
export function useDayMeals(dateStr?: string) {
  const { school } = useSchool();
  const month = dateStr?.slice(0, 7) || '';
  const id = school && month ? `${school.officeCode}:${school.schoolCode}:${month}` : '';
  const [got, setGot] = useState<{ id: string; meals: NeisMeal[]; failed: boolean }>({ id: '', meals: [], failed: false });

  useEffect(() => {
    if (!school || !month) return;
    let alive = true;
    loadMonthMeals(school, month)
      .then((meals) => alive && setGot({ id, meals, failed: false }))
      .catch((e) => {
        console.warn('급식을 불러오지 못했습니다:', e);
        if (alive) setGot({ id, meals: [], failed: true });
      });
    return () => {
      alive = false;
    };
    // school은 설정 스냅숏이 올 때만 바뀐다 (다시 불러도 lib/neis가 담아 둔 것을 준다)
  }, [school, month, id]);

  const current = got.id === id && !!id;
  return {
    school,
    meals: current ? got.meals.filter((m) => m.date === dateStr) : [],
    loading: !!id && !current,
    failed: current && got.failed,
  };
}
