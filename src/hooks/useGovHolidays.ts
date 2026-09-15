import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { loadHolidaysForYear } from '../lib/holidays';

// 연도별로 한 번만 읽는다.
//
// 두 가지를 같이 고쳤다.
//
// 1) 사용자 브라우저가 data.go.kr을 직접 부르던 것을 그만뒀다.
//    이제 Firestore의 holidays/{연도}를 읽는다. 사용자는 API 키가 필요 없고,
//    키가 브라우저(=빌드 결과물)에 실릴 이유도 없어졌다.
//
// 2) 예전에는 의존 값이 currentDate(시:분:초가 든 ISO 문자열)라, 날짜를 하루
//    넘길 때마다 이 훅을 쓰는 다섯 곳이 각각 12개월치를 다시 불렀다.
//    공휴일은 한 해 동안 바뀌지 않으므로 받아온 결과를 모듈에 남겨 같이 쓴다.
const yearCache = new Map<number, Record<string, string>>();
const inFlight = new Map<number, Promise<Record<string, string>>>();

function loadYear(year: number): Promise<Record<string, string>> {
  const cached = yearCache.get(year);
  if (cached) return Promise.resolve(cached);

  const running = inFlight.get(year);
  if (running) return running;

  const task = loadHolidaysForYear(year)
    .then((days) => {
      yearCache.set(year, days);
      return days;
    })
    .finally(() => {
      inFlight.delete(year);
    });

  inFlight.set(year, task);
  return task;
}

/** 개발자가 그 해 공휴일을 새로 저장했을 때, 다시 읽도록 캐시를 비운다. */
export function clearHolidayCache(year?: number) {
  if (year === undefined) {
    yearCache.clear();
    inFlight.clear();
    return;
  }
  yearCache.delete(year);
  inFlight.delete(year);
}

export function useGovHolidays() {
  const year = useAppStore((s) => new Date(s.currentDate).getFullYear());

  const [holidays, setHolidays] = useState<Record<string, string>>(() => yearCache.get(year) || {});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const cached = yearCache.get(year);
    if (cached) {
      setHolidays((prev) => ({ ...prev, ...cached }));
      return;
    }

    setIsLoading(true);
    setError(null);
    loadYear(year)
      .then((days) => {
        if (!alive) return;
        setHolidays((prev) => ({ ...prev, ...days })); // 해가 바뀌어도 이전 해 값을 남겨둔다
      })
      .catch((err: any) => {
        if (!alive) return;
        setError(err?.message || '공휴일 정보를 가져오는 데 실패했습니다.');
      })
      .finally(() => {
        if (alive) setIsLoading(false);
      });

    return () => {
      alive = false;
    };
  }, [year]);

  return { holidays, isLoading, error };
}
