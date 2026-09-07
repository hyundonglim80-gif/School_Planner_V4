import { useState, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { fetchHolidaysFromGovApi } from '../lib/govApi';

export function useGovHolidays() {
  const { govApiKey, currentDate } = useAppStore();
  const [holidays, setHolidays] = useState<Record<string, string>>({});
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!govApiKey) {
      setHolidays({});
      return;
    }

    const year = new Date(currentDate).getFullYear();

    const fetchHolidays = async () => {
      setIsLoading(true);
      setError(null);
      try {
        const data = await fetchHolidaysFromGovApi(year, govApiKey);
        setHolidays((prev) => ({ ...prev, ...data })); // Merge with previous years if needed
      } catch (err: any) {
        setError(err.message || '공휴일 정보를 가져오는 데 실패했습니다.');
      } finally {
        setIsLoading(false);
      }
    };

    fetchHolidays();
  }, [govApiKey, currentDate]);

  return { holidays, isLoading, error };
}
