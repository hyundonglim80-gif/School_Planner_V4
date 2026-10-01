import { describe, it, expect } from 'vitest';
import {
  parseDateQuery,
  relativeDayText,
  matchCommands,
  chosungOf,
  buildPaletteItems,
  PALETTE_COMMANDS,
} from './commandPalette';
import { SHORTCUT_ACTIONS } from './shortcuts';

// 2026-10-01은 목요일
const TODAY = '2026-10-01';
const date = (q: string, today = TODAY) => parseDateQuery(q, today)?.dateStr ?? null;

describe('parseDateQuery - 날짜로 알아듣기', () => {
  it('오늘·내일·모레·어제', () => {
    expect(date('오늘')).toBe('2026-10-01');
    expect(date('내일')).toBe('2026-10-02');
    expect(date('모레')).toBe('2026-10-03');
    expect(date('글피')).toBe('2026-10-04');
    expect(date('어제')).toBe('2026-09-30');
    expect(date('그저께')).toBe('2026-09-29');
  });

  it('며칠·몇 주·몇 달 뒤와 전', () => {
    expect(date('3일 뒤')).toBe('2026-10-04');
    expect(date('3일후')).toBe('2026-10-04');
    expect(date('2주 뒤')).toBe('2026-10-15');
    expect(date('10일 전')).toBe('2026-09-21');
    expect(date('1달 뒤')).toBe('2026-11-01');
    expect(date('2개월 전')).toBe('2026-08-01');
    // 31일의 한 달 뒤는 그 달 말일
    expect(date('1달 뒤', '2027-01-31')).toBe('2027-02-28');
  });

  it('요일만 적으면 가장 가까운 그 요일 (오늘이 그 요일이면 오늘)', () => {
    expect(date('목')).toBe('2026-10-01');
    expect(date('금요일')).toBe('2026-10-02');
    expect(date('월')).toBe('2026-10-05');
    expect(date('수')).toBe('2026-10-07');
    expect(date('일')).toBe('2026-10-04');
  });

  it('이번 주·다음 주·지난주의 요일 (주는 월요일부터)', () => {
    expect(date('이번 주 월')).toBe('2026-09-28');
    expect(date('이번주 금')).toBe('2026-10-02');
    expect(date('다음 주 목')).toBe('2026-10-08');
    expect(date('다음주 목요일')).toBe('2026-10-08');
    expect(date('담주 화')).toBe('2026-10-06');
    expect(date('다다음 주 월')).toBe('2026-10-12');
    expect(date('지난주 수')).toBe('2026-09-23');
    expect(date('저번 주 일')).toBe('2026-09-27');
    // 일요일에서 본 '다음 주'도 월요일부터 센다
    expect(date('다음 주 월', '2026-10-04')).toBe('2026-10-05');
  });

  it("'다음 주'는 그 주 월요일(주), '다음 달'은 1일(달)", () => {
    expect(parseDateQuery('다음 주', TODAY)).toEqual({ dateStr: '2026-10-05', unit: 'week' });
    expect(parseDateQuery('지난주', TODAY)).toEqual({ dateStr: '2026-09-21', unit: 'week' });
    expect(parseDateQuery('다음 달', TODAY)).toEqual({ dateStr: '2026-11-01', unit: 'month' });
    expect(parseDateQuery('지난달', '2027-01-15')).toEqual({ dateStr: '2026-12-01', unit: 'month' });
  });

  it('연도까지 적은 날짜', () => {
    expect(date('2026-10-15')).toBe('2026-10-15');
    expect(date('2026.10.15.')).toBe('2026-10-15');
    expect(date('2026. 10. 15.')).toBe('2026-10-15');
    expect(date('2027/3/2')).toBe('2027-03-02');
    expect(date('2026년 10월 15일')).toBe('2026-10-15');
    expect(date('20261015')).toBe('2026-10-15');
  });

  it('달·날만 적으면 오늘이 든 학년도(3월~이듬해 2월)', () => {
    expect(date('10/15')).toBe('2026-10-15');
    expect(date('10.15')).toBe('2026-10-15');
    expect(date('10월 15일')).toBe('2026-10-15');
    expect(date('3/2')).toBe('2026-03-02');
    expect(date('2/15')).toBe('2027-02-15');
    // 2월에 보면 3월은 지난해 3월이다 (같은 학년도)
    expect(date('3/2', '2027-02-10')).toBe('2026-03-02');
    expect(parseDateQuery('12월', TODAY)).toEqual({ dateStr: '2026-12-01', unit: 'month' });
    expect(parseDateQuery('1월', TODAY)).toEqual({ dateStr: '2027-01-01', unit: 'month' });
  });

  it("'15일'은 이번 달", () => {
    expect(date('15일')).toBe('2026-10-15');
    expect(date('31일', '2026-11-05')).toBeNull();
  });

  it('없는 날짜와 날짜가 아닌 글은 알아듣지 않는다', () => {
    expect(date('2/30')).toBeNull();
    expect(date('13/1')).toBeNull();
    expect(date('2026-02-29')).toBeNull();
    expect(date('15')).toBeNull();
    expect(date('출석')).toBeNull();
    expect(date('목공')).toBeNull();
    expect(date('')).toBeNull();
    expect(date('   ')).toBeNull();
  });
});

describe('relativeDayText', () => {
  it('오늘에서 며칠인지', () => {
    expect(relativeDayText('2026-10-01', TODAY)).toBe('오늘');
    expect(relativeDayText('2026-10-02', TODAY)).toBe('내일');
    expect(relativeDayText('2026-10-03', TODAY)).toBe('모레');
    expect(relativeDayText('2026-09-30', TODAY)).toBe('어제');
    expect(relativeDayText('2026-10-15', TODAY)).toBe('14일 뒤');
    expect(relativeDayText('2026-09-21', TODAY)).toBe('10일 전');
  });
});

describe('matchCommands - 기능 찾기', () => {
  const ids = (q: string) => matchCommands(q).map((c) => c.id);

  it('비어 있으면 모든 기능, 명령 창 자신은 빼고', () => {
    expect(ids('')).toHaveLength(SHORTCUT_ACTIONS.length - 1);
    expect(ids('')).not.toContain('commandPalette');
  });

  it('찾을 말로 찾는다', () => {
    expect(ids('출석')[0]).toBe('attendance');
    expect(ids('출결')[0]).toBe('attendance');
    expect(ids('진도')[0]).toBe('progress');
    expect(ids('백업')[0]).toBe('backup');
    expect(ids('휴지통')[0]).toBe('trash');
    expect(ids('구글')[0]).toBe('calendar');
  });

  it('띄어쓰기·대소문자를 가리지 않는다', () => {
    expect(ids('라벨관리')).toContain('labels');
    expect(ids('통합 라벨')).toContain('labels');
    expect(ids('D-DAY')).toContain('dday');
  });

  it('여러 기능에 맞으면 모두, 잘 맞는 것이 먼저', () => {
    const r = ids('학생');
    expect(r).toContain('roster');
    expect(r).toContain('studentRecord');
    // '일정'으로 시작하는 것(일정 보이기)이 '…일정…'이 든 것보다 먼저
    const ev = ids('일정');
    expect(ev[0]).toBe('toggleEvents');
    expect(ev).toContain('recurring');
    expect(ev).toContain('forwarding');
  });

  it('한글 첫소리로도 찾는다', () => {
    expect(chosungOf('출석부')).toBe('ㅊㅅㅂ');
    expect(chosungOf('D-Day 관리')).toBe('D-Day ㄱㄹ');
    expect(ids('ㅊㅅ')).toContain('attendance');
    expect(ids('ㅎㄱㅅㅈ')).toContain('settings');
  });

  it('첫소리는 처음부터 맞는 것이 가운데 맞는 것보다 먼저', () => {
    // '반복 일정 등록'의 …ㅇㅈㄷㄹ 에도 들어 있지만 '진도'가 먼저
    expect(ids('ㅈㄷ')[0]).toBe('progress');
    expect(ids('ㅈㄷ')).toContain('recurring');
    expect(ids('ㅊㅅ')[0]).toBe('attendance');
  });

  it('맞는 것이 없으면 빈 목록', () => {
    expect(ids('아무것도없는말')).toEqual([]);
  });

  it('모든 기능에 그림과 이름이 있다', () => {
    for (const c of PALETTE_COMMANDS) {
      expect(c.icon, c.id).toBeTruthy();
      expect(c.title, c.id).toBeTruthy();
    }
  });
});

describe('buildPaletteItems - 명령 창의 줄', () => {
  const kinds = (q: string, scope: 'day' | 'week' | 'month' | 'year' | 'memo' = 'day') =>
    buildPaletteItems(q, TODAY, scope).map((i) =>
      i.kind === 'date' ? `date:${i.dateStr}:${i.scope}` : i.kind === 'command' ? `cmd:${i.command.id}` : `search:${i.text}`
    );

  it('비어 있으면 기능만 (검색 줄 없음)', () => {
    const k = kinds('');
    expect(k.every((x) => x.startsWith('cmd:'))).toBe(true);
  });

  it('날짜가 맨 위, 맨 아래는 늘 통합 검색', () => {
    expect(kinds('10/15')).toEqual(['date:2026-10-15:day', 'search:10/15']);
    expect(kinds('출석')).toEqual(['cmd:attendance', 'search:출석']);
    expect(kinds('현장체험')).toEqual(['search:현장체험']);
  });

  it('주간·월간·년간을 보고 있으면 그 화면에서 가는 줄이 하나 더', () => {
    expect(kinds('10/15', 'week')).toEqual(['date:2026-10-15:day', 'date:2026-10-15:week', 'search:10/15']);
    expect(kinds('10/15', 'year')).toEqual(['date:2026-10-15:day', 'date:2026-10-15:year', 'search:10/15']);
    expect(kinds('10/15', 'memo')).toEqual(['date:2026-10-15:day', 'search:10/15']);
  });

  it("'다음 주'는 주간 화면이 먼저, '다음 달'은 월간 화면만", () => {
    expect(kinds('다음 주').slice(0, 2)).toEqual(['date:2026-10-05:week', 'date:2026-10-05:day']);
    expect(kinds('다음 달')[0]).toBe('date:2026-11-01:month');
    expect(kinds('다음 달')[1]).not.toMatch(/^date:/);
  });

  it("'오늘'은 날짜 줄과 '오늘 날짜로' 기능이 함께", () => {
    const k = kinds('오늘');
    expect(k[0]).toBe('date:2026-10-01:day');
    expect(k).toContain('cmd:dateToday');
  });

  it('앞뒤 공백은 검색어에서 뺀다', () => {
    expect(kinds('  공문  ').at(-1)).toBe('search:공문');
  });
});
