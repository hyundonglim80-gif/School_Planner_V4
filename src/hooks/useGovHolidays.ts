import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { fetchHolidaysFromGovApi } from '../lib/govApi';

// 연도별로 한 번만 받아온다.
//
// 예전에는 화면을 그리는 다섯 곳(월간/주간/월간 목록/년간/하루 머리말)이 각자
// 이 훅을 쓰면서, 의존 값이 currentDate(시:분:초까지 들어간 ISO 문자열)라
// 날짜를 하루 넘길 때마다 다섯 곳 × 12개월 = 60번을 다시 불렀다.
// 공휴일은 한 해 동안 바뀌지 않으므로 받아온 결과를 모듈에 남겨 같이 쓴다.
// (새로고침하면 다시 받는다. 아예 안 받으려면 Firestore에 적어두는 구조가 필요하다.)
// 키를 바꾸면 다시 받아야 하므로 키도 캐시 이름에 넣는다.
const yearCache = new Map<string, Record<string, string>>();
const inFlight = new Map<string, Promise<Record<string, string>>>();

const cacheKey = (year: number, apiKey: string) => `${year}|${apiKey}`;

function loadYear(year: number, apiKey: string): Promise<Record<string, string>> {
  const key = cacheKey(year, apiKey);
  const cached = yearCache.get(key);
  if (cached) return Promise.resolve(cached);

  const running = inFlight.get(key);
  if (running) return running;

  const task = fetchHolidaysFromGovApi(year, apiKey || undefined)
    .then((data) => {
      yearCache.set(key, data);
      return data;
    })
    .finally(() => {
      inFlight.delete(key);
    });

  inFlight.set(key, task);
  return task;
}

/** 테스트용. 캐시를 비운다. */
export function clearHolidayCache() {
  yearCache.clear();
  inFlight.clear();
}

export function useGovHolidays() {
  // 키를 넣지 않았으면 govApi가 기본 키(개발자 키)로 받아온다.
  // 사용자는 키를 발급받거나 입력할 필요가 없다.
  const govApiKey = useAppStore((s) => s.govApiKey);
  const year = useAppStore((s) => new Date(s.currentDate).getFullYear());

  const [holidays, setHolidays] = useState<Record<string, string>>(() => yearCache.get(cacheKey(year, govApiKey)) || {});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    const cached = yearCache.get(cacheKey(year, govApiKey));
    if (cached) {
      setHolidays((prev) => ({ ...prev, ...cached }));
      return;
    }

    setIsLoading(true);
    setError(null);
    loadYear(year, govApiKey)
      .then((data) => {
        if (!alive) return;
        setHolidays((prev) => ({ ...prev, ...data })); // 해가 바뀌어도 이전 해 값을 남겨둔다
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
  }, [year, govApiKey]);

  return { holidays, isLoading, error };
}
