import { useState, useEffect, useCallback } from 'react';
import { doc, onSnapshot, setDoc, getDocs, query, where, documentId, writeBatch, collection } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { formatDate } from '../lib/dateUtils';

export type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
export type WeekTimetable = Record<WeekDayKey, Record<number, string>>;

export interface TimetableTemplateItem {
  names: string[];
  data: WeekTimetable;
}

export interface SemesterConfig {
  sem1Start: string;
  sem1End: string;
  sem2Start: string;
  sem2End: string;
}

const DEFAULT_NAMES = ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'];

const DEFAULT_DATA: WeekTimetable = {
  mon: {},
  tue: {},
  wed: {},
  thu: {},
  fri: {},
};

const DEFAULT_SEMESTER_CONFIG: SemesterConfig = {
  sem1Start: `${new Date().getFullYear()}-03-02`,
  sem1End: `${new Date().getFullYear()}-07-20`,
  sem2Start: `${new Date().getFullYear()}-08-20`,
  sem2End: `${new Date().getFullYear() + 1}-02-28`,
};

export function useTimetableTemplate() {
  const [templates, setTemplates] = useState<Record<string, TimetableTemplateItem>>({
    '1학기 시간표': { names: DEFAULT_NAMES, data: DEFAULT_DATA },
    '2학기 시간표': { names: DEFAULT_NAMES, data: DEFAULT_DATA },
  });
  const [currentTemplateName, setCurrentTemplateName] = useState<string>('1학기 시간표');
  const [semesterConfig, setSemesterConfig] = useState<SemesterConfig>(DEFAULT_SEMESTER_CONFIG);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) {
      setLoading(false);
      return;
    }

    setLoading(true);
    const docRef = doc(db, 'users', user.uid, 'settings', 'timetable_v5');

    const unsubscribe = onSnapshot(docRef, (snap) => {
      if (snap.exists()) {
        const data = snap.data();
        if (data.templates && typeof data.templates === 'object' && Object.keys(data.templates).length > 0) {
          setTemplates(data.templates);
          if (!data.templates[currentTemplateName]) {
            setCurrentTemplateName(Object.keys(data.templates)[0]);
          }
        }
        if (data.semesterConfig) {
          setSemesterConfig(data.semesterConfig);
        }
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, [auth.currentUser?.uid]);

  // 클라우드 동기화 저장
  const syncToCloud = useCallback(async (
    newTemplates: Record<string, TimetableTemplateItem>,
    newSemesterConfig?: SemesterConfig
  ) => {
    const user = auth.currentUser;
    if (!user) return;
    const docRef = doc(db, 'users', user.uid, 'settings', 'timetable_v5');

    const cur = newTemplates[currentTemplateName] || Object.values(newTemplates)[0];

    await setDoc(docRef, {
      templates: newTemplates,
      semesterConfig: newSemesterConfig || semesterConfig,
      currentNames: cur ? cur.names : DEFAULT_NAMES,
      updatedAt: Date.now(),
    }, { merge: true });
  }, [currentTemplateName, semesterConfig]);

  // 시간표 캘린더 일괄 덮어쓰기 (applyTimetableToCalendar)
  const applyTimetableToCalendar = useCallback(async (
    startDateStr: string,
    endDateStr: string,
    targetData: WeekTimetable,
    periodNames: string[]
  ) => {
    const user = auth.currentUser;
    if (!user) throw new Error('로그인이 필요합니다.');

    const startObj = new Date(startDateStr + 'T00:00:00');
    const endObj = new Date(endDateStr + 'T23:59:59');

    // 해당 기간의 events & schedules 가져오기
    const eventsCol = collection(db, 'users', user.uid, 'events');
    const schedulesCol = collection(db, 'users', user.uid, 'schedules');

    const [eventsSnap, schedulesSnap] = await Promise.all([
      getDocs(query(eventsCol, where(documentId(), '>=', startDateStr), where(documentId(), '<=', endDateStr))),
      getDocs(query(schedulesCol, where(documentId(), '>=', startDateStr), where(documentId(), '<=', endDateStr))),
    ]);

    const eventMap: Record<string, any> = {};
    eventsSnap.forEach((docSnap) => {
      eventMap[docSnap.id] = docSnap.data();
    });

    const scheduleMap: Record<string, any> = {};
    schedulesSnap.forEach((docSnap) => {
      scheduleMap[docSnap.id] = docSnap.data().periods || {};
    });

    let batch = writeBatch(db);
    let opCount = 0;
    const batchPromises: Promise<void>[] = [];
    let appliedCount = 0;
    let skippedCount = 0;

    const cur = new Date(startObj);
    const days: WeekDayKey[] = ['mon', 'tue', 'wed', 'thu', 'fri'];
    const periodCount = periodNames.length;

    while (cur <= endObj) {
      const dayIdx = cur.getDay(); // 0: 일, 1: 월, ..., 5: 금, 6: 토
      if (dayIdx >= 1 && dayIdx <= 5) {
        const dateStr = formatDate(cur);
        const dayName = days[dayIdx - 1];

        // 공휴일 or 행사 중 'skip' 속성 체크
        let isSkip = false;
        const eData = eventMap[dateStr];
        if (eData) {
          const list = eData.eventList || [];
          if (list.some((item: any) => item.skip || (item.text && item.text.includes('휴업')))) {
            isSkip = true;
          }
        }

        const existingPeriods = scheduleMap[dateStr] || {};
        const newPeriods: Record<number, any> = {};

        for (let p = 1; p <= periodCount; p++) {
          newPeriods[p] = {
            subject: isSkip ? '' : ((targetData[dayName] || {})[p] || ''),
            memo: existingPeriods[p]?.memo || '',
            supplies: existingPeriods[p]?.supplies || '',
          };
        }

        const docRef = doc(schedulesCol, dateStr);
        batch.set(docRef, { periods: newPeriods, updatedAt: Date.now() }, { merge: true });

        if (isSkip) skippedCount++;
        else appliedCount++;

        opCount++;
        if (opCount >= 400) {
          batchPromises.push(batch.commit());
          batch = writeBatch(db);
          opCount = 0;
        }
      }
      cur.setDate(cur.getDate() + 1);
    }

    if (opCount > 0) {
      batchPromises.push(batch.commit());
    }

    await Promise.all(batchPromises);
    return { appliedCount, skippedCount };
  }, []);

  // 특정 요일의 템플릿 반환 (DaySchedule에서 빠른 채우기용)
  const getDayTemplate = useCallback((dayIdx: number): Record<number, string> => {
    const map: Record<number, WeekDayKey> = {
      1: 'mon',
      2: 'tue',
      3: 'wed',
      4: 'thu',
      5: 'fri',
    };
    const key = map[dayIdx];
    const cur = templates[currentTemplateName] || Object.values(templates)[0];
    return key && cur ? (cur.data[key] || {}) : {};
  }, [templates, currentTemplateName]);

  return {
    templates,
    currentTemplateName,
    setCurrentTemplateName,
    semesterConfig,
    setSemesterConfig,
    loading,
    syncToCloud,
    applyTimetableToCalendar,
    getDayTemplate,
  };
}
