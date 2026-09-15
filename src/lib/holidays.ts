// src/lib/holidays.ts
//
// 공휴일을 어디서 읽어오는가.
//
// 예전에는 사용자 브라우저가 저마다 data.go.kr을 직접 불렀다. 그래서 키가
// 브라우저에 있어야 했고, 키를 소스에 박아둘 수밖에 없었다(=빌드 결과물에 남았다).
//
// 이제는 이렇게 나눈다.
//   개발자  : 1년에 한 번 data.go.kr에서 받아 holidays/{연도}에 적어둔다. 키는 이때만 쓴다.
//   사용자  : holidays/{연도}를 읽기만 한다. 키가 필요 없고, 있을 이유도 없다.
//
// V3 호환: V3는 공휴일을 users/{uid}/settings/holidays 의 map에 모아둔다.
// V3를 쓰던 선생님은 이미 받아둔 값이 있으므로 그것도 같이 읽어 합친다.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';

export interface HolidayDoc {
  year: number;
  /** '2026-01-01' -> '1월1일' */
  days: Record<string, string>;
  updatedAt: number;
  updatedBy?: string;
}

const sharedRef = (year: number) => doc(db, 'holidays', String(year));

/** 모두가 같이 보는 연도별 공휴일. 없으면 null. */
export async function loadSharedHolidays(year: number): Promise<HolidayDoc | null> {
  try {
    const snap = await getDoc(sharedRef(year));
    if (!snap.exists()) return null;
    const data = snap.data() as Partial<HolidayDoc>;
    return {
      year,
      days: data.days || {},
      updatedAt: data.updatedAt || 0,
      updatedBy: data.updatedBy,
    };
  } catch (e) {
    // 규칙이 아직 배포되지 않았거나 오프라인일 수 있다. 공휴일 없이도 앱은 돌아간다.
    console.warn(`holidays/${year} 를 읽지 못했습니다.`, e);
    return null;
  }
}

/** 개발자만 쓴다. 규칙(firestore.rules)에서 등록된 계정만 통과한다. */
export async function saveSharedHolidays(year: number, days: Record<string, string>): Promise<void> {
  await setDoc(sharedRef(year), {
    year,
    days,
    updatedAt: Date.now(),
    updatedBy: auth.currentUser?.email || '',
  });
}

/** V3가 users/{uid}/settings/holidays 에 모아둔 값 (연도 구분 없이 한 map에 들어 있다) */
export async function loadPersonalHolidays(): Promise<Record<string, string>> {
  const uid = auth.currentUser?.uid;
  if (!uid) return {};
  try {
    const snap = await getDoc(doc(db, 'users', uid, 'settings', 'holidays'));
    if (!snap.exists()) return {};
    return (snap.data().map as Record<string, string>) || {};
  } catch (e) {
    console.warn('개인 공휴일(V3 호환)을 읽지 못했습니다.', e);
    return {};
  }
}

/** 그 해에 해당하는 날짜만 남긴다 */
export function pickYear(map: Record<string, string>, year: number): Record<string, string> {
  const prefix = `${year}-`;
  const out: Record<string, string> = {};
  for (const [dateStr, name] of Object.entries(map)) {
    if (dateStr.startsWith(prefix)) out[dateStr] = name;
  }
  return out;
}

/**
 * 한 해치 공휴일. 공유본을 먼저 깔고 개인(V3) 값을 위에 덮는다.
 * 개인이 직접 손본 값이 있다면 그쪽을 존중한다는 뜻이다.
 */
export async function loadHolidaysForYear(year: number): Promise<Record<string, string>> {
  const [shared, personal] = await Promise.all([loadSharedHolidays(year), loadPersonalHolidays()]);
  return { ...(shared?.days || {}), ...pickYear(personal, year) };
}
