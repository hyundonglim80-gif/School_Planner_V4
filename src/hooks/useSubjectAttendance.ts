// src/hooks/useSubjectAttendance.ts
//
// 교과 출결(lib/subjectAttendance, ROADMAP-SUBJECT S6)을 화면에 잇는다.
// 하루 수업 칸이 그날 모든 반의 교과 출결을 한 쿼리로 구독해 교시 카드에 '결과 2' 표를 붙인다.
// 교과 모드에서만 구독한다(초등 담임은 읽기가 늘지 않는다).
import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { subscribeSubjectAttendanceDate } from '../lib/subjectAttendanceStore';
import type { SubjectAttendanceDay } from '../lib/subjectAttendance';

const EMPTY: Record<string, SubjectAttendanceDay> = {};

/** 그날 classKey → 교과 출결. enabled가 아니거나 날짜가 없으면 빈 것 */
export function useSubjectAttendanceDate(dateStr: string, enabled: boolean): Record<string, SubjectAttendanceDay> {
  const uid = auth.currentUser?.uid;
  const [byClass, setByClass] = useState<Record<string, SubjectAttendanceDay>>(EMPTY);
  useEffect(() => {
    setByClass(EMPTY);
    if (!uid || !enabled || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return;
    return subscribeSubjectAttendanceDate(dateStr, setByClass, (err) =>
      console.warn('교과 출결을 불러오지 못했습니다:', err)
    );
  }, [uid, enabled, dateStr]);
  return byClass;
}
