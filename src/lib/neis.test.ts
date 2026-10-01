import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { getDoc } from 'firebase/firestore';
import {
  clearNeisCache,
  isSkippedScheduleRow,
  loadMonthMeals,
  loadMonthSchedule,
  parseDish,
  parseMealRow,
  parseScheduleRow,
  searchSchools,
} from './neis';

// 나이스 급식·학사일정 (docs/ROADMAP.md 4-1)

const SCHOOL = { officeCode: 'B10', schoolCode: '7091375' };
const ALL_GRADES = {
  ONE_GRADE_EVENT_YN: 'Y',
  TW_GRADE_EVENT_YN: 'Y',
  THREE_GRADE_EVENT_YN: 'Y',
  FR_GRADE_EVENT_YN: 'Y',
  FIV_GRADE_EVENT_YN: 'Y',
  SIX_GRADE_EVENT_YN: 'Y',
};
const sched = (ymd: string, name: string, extra: Record<string, unknown> = {}) => ({
  AA_YMD: ymd,
  EVENT_NM: name,
  EVENT_CNTNT: '',
  SBTR_DD_SC_NM: '해당없음',
  ...ALL_GRADES,
  ...extra,
});
const meal = (ymd: string, kind = '중식', dishes = '현미밥 <br/>된장국 (5.6)') => ({
  MLSV_YMD: ymd,
  MMEAL_SC_NM: kind,
  DDISH_NM: dishes,
  CAL_INFO: '700.1 Kcal',
});

/** 나이스 흉내: 기간으로 거르고, 키가 없으면 늘 앞의 5건만 (pIndex를 바꿔도 같은 5건) */
function fakeNeis(data: { SchoolSchedule?: any[]; mealServiceDietInfo?: any[]; schoolInfo?: any[] }, error?: any) {
  const calls: URL[] = [];
  const fetchMock = vi.fn(async (input: any) => {
    const url = new URL(String(input));
    calls.push(url);
    const service = url.pathname.split('/').pop() as keyof typeof data;
    if (error) return new Response(JSON.stringify(error));
    const p = url.searchParams;
    const key = p.get('KEY');
    const [fromP, toP, dateF] =
      service === 'SchoolSchedule'
        ? ['AA_FROM_YMD', 'AA_TO_YMD', 'AA_YMD']
        : ['MLSV_FROM_YMD', 'MLSV_TO_YMD', 'MLSV_YMD'];
    let rows = (data[service] || []).filter((r) => {
      if (service === 'schoolInfo') return String(r.SCHUL_NM).includes(p.get('SCHUL_NM') || '');
      return r[dateF] >= (p.get(fromP) || '') && r[dateF] <= (p.get(toP) || '');
    });
    const total = rows.length;
    if (!total) return new Response(JSON.stringify({ RESULT: { CODE: 'INFO-200', MESSAGE: '해당하는 데이터가 없습니다.' } }));
    const size = key ? Number(p.get('pSize')) : 5;
    const index = key ? Number(p.get('pIndex')) : 1;
    rows = rows.slice((index - 1) * size, index * size);
    return new Response(
      JSON.stringify({
        [service]: [{ head: [{ list_total_count: total }, { RESULT: { CODE: 'INFO-000', MESSAGE: '정상 처리되었습니다.' } }] }, { row: rows }],
      })
    );
  });
  vi.stubGlobal('fetch', fetchMock);
  return calls;
}

const withKey = (key: string) =>
  vi.mocked(getDoc).mockResolvedValue({ exists: () => true, data: () => ({ key }) } as any);

beforeEach(() => {
  clearNeisCache();
  vi.mocked(getDoc).mockResolvedValue({ exists: () => false, data: () => ({}) } as any);
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('급식 읽기', () => {
  it('음식 이름과 알레르기 번호를 나눈다', () => {
    expect(parseDish('꽃게된장국 (5.6.8)')).toEqual({ name: '꽃게된장국', allergies: [5, 6, 8] });
    expect(parseDish('무말랭이무침(완제) (5.6.9.18)')).toEqual({ name: '무말랭이무침(완제)', allergies: [5, 6, 9, 18] });
    expect(parseDish('현미찹쌀밥 ')).toEqual({ name: '현미찹쌀밥', allergies: [] });
    expect(parseDish('우유(2.)')).toEqual({ name: '우유', allergies: [2] });
    expect(parseDish('  ')).toBeNull();
  });

  it('한 끼: <br/>로 나뉜 음식, 날짜, 열량', () => {
    expect(parseMealRow(meal('20260929', '중식', '현미밥 <br/>된장국 (5.6)<br/>급식우유 (2)'))).toEqual({
      date: '2026-09-29',
      kind: '중식',
      dishes: [
        { name: '현미밥', allergies: [] },
        { name: '된장국', allergies: [5, 6] },
        { name: '급식우유', allergies: [2] },
      ],
      calories: '700.1 Kcal',
    });
  });
});

describe('학사일정 읽기', () => {
  it('공휴일·토요휴업일은 뺀다 (재량휴업일은 남긴다)', () => {
    expect(isSkippedScheduleRow(sched('20261003', '개천절', { SBTR_DD_SC_NM: '공휴일' }))).toBe(true);
    expect(isSkippedScheduleRow(sched('20261010', '토요휴업일', { SBTR_DD_SC_NM: '휴업일' }))).toBe(true);
    expect(isSkippedScheduleRow(sched('20261012', '재량휴업일', { SBTR_DD_SC_NM: '휴업일' }))).toBe(false);
    expect(isSkippedScheduleRow(sched('20261014', '2학기 중간고사'))).toBe(false);
  });

  it('학년: 전 학년이면 비우고, 일부면 그 학년만', () => {
    expect(parseScheduleRow(sched('20261014', '중간고사')).grades).toEqual([]);
    const only3 = { ...ALL_GRADES, ONE_GRADE_EVENT_YN: 'N', TW_GRADE_EVENT_YN: 'N', FR_GRADE_EVENT_YN: 'N', FIV_GRADE_EVENT_YN: 'N', SIX_GRADE_EVENT_YN: 'N' };
    expect(parseScheduleRow(sched('20261020', '3학년 수학여행', only3))).toMatchObject({ date: '2026-10-20', grades: [3] });
    // 중·고등학교는 4~6학년 칸이 비어 있다 - 1·2·3학년 모두면 전 학년으로 본다
    const middle = { ONE_GRADE_EVENT_YN: 'Y', TW_GRADE_EVENT_YN: 'Y', THREE_GRADE_EVENT_YN: 'Y', FR_GRADE_EVENT_YN: null, FIV_GRADE_EVENT_YN: null, SIX_GRADE_EVENT_YN: null };
    expect(parseScheduleRow(sched('20261021', '체육대회', middle)).grades).toEqual([1, 2, 3]);
  });
});

describe('키 없이 부르기 - 5건씩이라 나눠 받는다', () => {
  const october = Array.from({ length: 12 }, (_, i) => sched(`202610${String(i * 2 + 2).padStart(2, '0')}`, `행사 ${i + 1}`));

  it('한 달 12건을 빠짐없이 받는다 (여러 번 나눠 부른다)', async () => {
    const calls = fakeNeis({ SchoolSchedule: october });
    const items = await loadMonthSchedule(SCHOOL, '2026-10');
    expect(items.map((it) => it.name)).toEqual(october.map((r) => r.EVENT_NM));
    expect(calls.length).toBeGreaterThan(1);
    expect(calls.every((u) => !u.searchParams.has('KEY'))).toBe(true);
    expect(calls[0].searchParams.get('AA_FROM_YMD')).toBe('20261001');
    expect(calls[0].searchParams.get('AA_TO_YMD')).toBe('20261031');
  });

  it('하루에 5건이 넘으면 받은 만큼만 (끝없이 나누지 않는다)', async () => {
    const busy = Array.from({ length: 7 }, (_, i) => meal('20261015', `${i}식`));
    const calls = fakeNeis({ mealServiceDietInfo: busy });
    const meals = await loadMonthMeals(SCHOOL, '2026-10');
    expect(meals).toHaveLength(5);
    expect(calls.length).toBeLessThanOrEqual(11); // 31일을 반씩 5단계: 2×5+1
  });

  it('공휴일·토요휴업일을 빼고, 같은 날 같은 이름은 하나만', async () => {
    fakeNeis({
      SchoolSchedule: [
        sched('20261003', '개천절', { SBTR_DD_SC_NM: '공휴일' }),
        sched('20261010', '토요휴업일'),
        sched('20261014', '중간고사'),
        sched('20261014', '중간고사'),
      ],
    });
    expect((await loadMonthSchedule(SCHOOL, '2026-10')).map((it) => it.name)).toEqual(['중간고사']);
  });

  it('자료가 없으면(INFO-200) 빈 목록', async () => {
    fakeNeis({});
    expect(await loadMonthMeals(SCHOOL, '2026-08')).toEqual([]);
  });

  it('키를 못 읽어도(규칙 배포 전) 키 없이 부른다', async () => {
    vi.mocked(getDoc).mockRejectedValue(Object.assign(new Error('denied'), { code: 'permission-denied' }));
    const calls = fakeNeis({ mealServiceDietInfo: [meal('20261001')] });
    expect(await loadMonthMeals(SCHOOL, '2026-10')).toHaveLength(1);
    expect(calls[0].searchParams.has('KEY')).toBe(false);
  });
});

describe('키가 있으면', () => {
  it('한 번에 받는다 (KEY·pSize 1000)', async () => {
    withKey('DEV-KEY');
    const rows = Array.from({ length: 12 }, (_, i) => sched(`202610${String(i + 10)}`, `행사 ${i}`));
    const calls = fakeNeis({ SchoolSchedule: rows });
    expect(await loadMonthSchedule(SCHOOL, '2026-10')).toHaveLength(12);
    expect(calls).toHaveLength(1);
    expect(calls[0].searchParams.get('KEY')).toBe('DEV-KEY');
    expect(calls[0].searchParams.get('pSize')).toBe('1000');
  });
});

describe('키가 막히면 키 없이', () => {
  it('틀린 키(ERROR-290)면 키 없이 다시 부르고, 이 탭에서는 키를 더 쓰지 않는다', async () => {
    withKey('EXPIRED');
    const rows = [meal('20261001')];
    const calls: URL[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: any) => {
        const url = new URL(String(input));
        calls.push(url);
        if (url.searchParams.has('KEY')) {
          return new Response(JSON.stringify({ RESULT: { CODE: 'ERROR-290', MESSAGE: '인증키가 유효하지 않습니다.' } }));
        }
        return new Response(
          JSON.stringify({ mealServiceDietInfo: [{ head: [{ list_total_count: 1 }, { RESULT: { CODE: 'INFO-000' } }] }, { row: rows }] })
        );
      })
    );
    expect(await loadMonthMeals(SCHOOL, '2026-10')).toHaveLength(1);
    expect(calls.map((u) => u.searchParams.has('KEY'))).toEqual([true, false]);
    await loadMonthMeals(SCHOOL, '2026-11');
    expect(calls[2].searchParams.has('KEY')).toBe(false);
  });

  it('키와 상관없는 오류는 그대로 던진다', async () => {
    withKey('DEV-KEY');
    fakeNeis({}, { RESULT: { CODE: 'ERROR-500', MESSAGE: '서버 오류입니다.' } });
    await expect(loadMonthMeals(SCHOOL, '2026-10')).rejects.toThrow('서버 오류');
  });
});

describe('담아 두기와 오류', () => {
  it('같은 달을 다시 부르지 않는다', async () => {
    const calls = fakeNeis({ mealServiceDietInfo: [meal('20261001')] });
    await loadMonthMeals(SCHOOL, '2026-10');
    await loadMonthMeals(SCHOOL, '2026-10');
    expect(calls).toHaveLength(1);
  });

  it('오류는 던지고 담아 두지 않는다 (다음에 다시 부른다)', async () => {
    fakeNeis({}, { RESULT: { CODE: 'ERROR-290', MESSAGE: '인증키가 유효하지 않습니다.' } });
    await expect(loadMonthMeals(SCHOOL, '2026-10')).rejects.toThrow('인증키가 유효하지 않습니다');
    const calls = fakeNeis({ mealServiceDietInfo: [meal('20261001')] });
    expect(await loadMonthMeals(SCHOOL, '2026-10')).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });
});

describe('학교 찾기', () => {
  const school = (name: string) => ({
    ATPT_OFCDC_SC_CODE: 'B10',
    ATPT_OFCDC_SC_NM: '서울특별시교육청',
    SD_SCHUL_CODE: '7091375',
    SCHUL_NM: name,
    SCHUL_KND_SC_NM: '초등학교',
    ORG_RDNMA: '서울특별시 강남구 선릉로 209 ',
  });

  it('이름·교육청·학교 코드·주소를 읽는다', async () => {
    fakeNeis({ schoolInfo: [school('서울대도초등학교')] });
    expect(await searchSchools('서울대도')).toEqual({
      schools: [
        {
          officeCode: 'B10',
          officeName: '서울특별시교육청',
          schoolCode: '7091375',
          name: '서울대도초등학교',
          kind: '초등학교',
          address: '서울특별시 강남구 선릉로 209',
        },
      ],
      more: false,
    });
  });

  it('결과가 다 오지 않으면 more (이름을 더 적게)', async () => {
    fakeNeis({ schoolInfo: Array.from({ length: 8 }, (_, i) => school(`서울${i}초등학교`)) });
    const r = await searchSchools('서울');
    expect(r.schools).toHaveLength(5);
    expect(r.more).toBe(true);
  });

  it('빈 이름은 부르지 않는다', async () => {
    const calls = fakeNeis({});
    expect(await searchSchools('  ')).toEqual({ schools: [], more: false });
    expect(calls).toHaveLength(0);
  });
});
