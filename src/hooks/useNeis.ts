// src/hooks/useNeis.ts
//
// 우리 학교(useSchool)의 나이스 급식·학사일정을 달마다 받아 온다 (lib/neis, docs/ROADMAP.md 4번).
// 학교를 고르지 않았으면 부르지 않는다. 받은 것은 lib/neis가 학교·달마다 담아 둔다.
import { useEffect, useState } from 'react';
import { loadMonthMeals, type NeisMeal } from '../lib/neis';
import { useSchool } from './useSchool';

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
