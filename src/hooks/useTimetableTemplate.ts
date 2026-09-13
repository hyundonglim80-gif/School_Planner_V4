import { useState, useEffect, useCallback } from 'react';
import { doc, setDoc, getDocs, query, where, documentId, writeBatch, collection } from 'firebase/firestore';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
import { db, auth } from '../lib/firebase';
import { formatDate } from '../lib/dateUtils';
import {
  DEFAULT_SEMESTER_CONFIG,
  getSemesterRanges,
  isVacationDay,
  shiftDate,
  type SemesterConfig,
} from '../lib/semester';
import { moveToTrash } from '../utils/trashHelper';

export type WeekDayKey = 'mon' | 'tue' | 'wed' | 'thu' | 'fri';
export type WeekTimetable = Record<WeekDayKey, Record<number, string>>;

export interface TimetableTemplateItem {
  names: string[];
  data: WeekTimetable;
}

const DEFAULT_NAMES = ['1교시', '2교시', '3교시', '4교시', '5교시', '6교시'];

const DEFAULT_DATA: WeekTimetable = {
  mon: {},
  tue: {},
  wed: {},
  thu: {},
  fri: {},
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

    const unsubscribe = subscribeDocWithServerFallback(docRef, (data) => {
      if (data) {
        if (data.templates && typeof data.templates === 'object' && Object.keys(data.templates).length > 0) {
          setTemplates(data.templates);
          if (!data.templates[currentTemplateName]) {
            setCurrentTemplateName(Object.keys(data.templates)[0]);
          }
        }
        if (data.semesterConfig) {
          // 예전 문서에는 방학 필드가 없다. 기존 값은 그대로 두고 빈 칸만 기본값으로 채운다.
          const conf = data.semesterConfig as SemesterConfig;
          setSemesterConfig({
            ...conf,
            summerStart: conf.summerStart || DEFAULT_SEMESTER_CONFIG.summerStart,
            summerEnd: conf.summerEnd || DEFAULT_SEMESTER_CONFIG.summerEnd,
            winterStart: conf.winterStart || DEFAULT_SEMESTER_CONFIG.winterStart,
            winterEnd: conf.winterEnd || DEFAULT_SEMESTER_CONFIG.winterEnd,
          });
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

    // 저장 직전 상태(templates)와 비교해 사라진 템플릿을 휴지통으로 보낸다.
    for (const name of Object.keys(templates)) {
      if (!(name in newTemplates)) {
        try {
          await moveToTrash({
            id: `template_${name}_${Date.now()}`,
            type: 'template',
            content: name,
            data: { name, template: templates[name] },
          });
        } catch (err) {
          console.error('시간표 템플릿 휴지통 이동 실패:', err);
        }
      }
    }

    const cur = newTemplates[currentTemplateName] || Object.values(newTemplates)[0];

    await setDoc(docRef, {
      templates: newTemplates,
      semesterConfig: newSemesterConfig || semesterConfig,
      currentNames: cur ? cur.names : DEFAULT_NAMES,
      updatedAt: Date.now(),
    }, { merge: true });
  }, [templates, currentTemplateName, semesterConfig]);

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

        // 방학이면 수업을 채우지 않는다
        let isSkip = isVacationDay(dateStr, semesterConfig);

        // 공휴일 or 행사 중 'skip' 속성 체크
        const eData = eventMap[dateStr];
        if (!isSkip && eData) {
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
  }, [semesterConfig]);

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

// 다른 모듈이 기존 경로로 계속 가져다 쓸 수 있게 재수출한다
export { getSemesterRanges, isVacationDay, shiftDate, DEFAULT_SEMESTER_CONFIG };
export type { SemesterConfig };
