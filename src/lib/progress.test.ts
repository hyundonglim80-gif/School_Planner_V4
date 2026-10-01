import { describe, it, expect } from 'vitest';
import {
  computeProgress,
  lessonAt,
  offDayChecker,
  parseLessonTable,
  progressMarks,
  progressUntil,
  sanitizePlan,
  scheduleSubjects,
  schoolYearEnd,
  slotId,
  toggleBump,
  type ProgressLesson,
} from './progress';

// 진도 관리 (docs/ROADMAP.md 5-1)

const tsv = (...rows: string[][]) => rows.map((r) => r.join('\t')).join('\r\n') + '\r\n';
const L = (content: string, extra: Partial<ProgressLesson> = {}): ProgressLesson => ({
  unit: '',
  no: '',
  content,
  supplies: '',
  ...extra,
});

describe('차시 표 붙여넣기', () => {
  it('머리줄은 건너뛰고, 빈 줄은 빼고, 합친 단원 칸은 아래로 잇는다', () => {
    const text = tsv(
      ['단원', '차시', '내용', '준비물'],
      ['1. 비유하는 표현', '1', '비유 표현 찾기', '교과서'],
      ['', '2', '비유 표현 만들기', ''],
      ['', '', '', ''],
      ['2. 이야기 속 세상', '3', '인물 말 읽기', '활동지']
    );
    expect(parseLessonTable(text)).toEqual([
      { unit: '1. 비유하는 표현', no: '1', content: '비유 표현 찾기', supplies: '교과서' },
      { unit: '1. 비유하는 표현', no: '2', content: '비유 표현 만들기', supplies: '' },
      { unit: '2. 이야기 속 세상', no: '3', content: '인물 말 읽기', supplies: '활동지' },
    ]);
  });

  it('머리줄 이름으로 칸을 맞춘다 (차례가 달라도, 모르는 칸은 버린다)', () => {
    const text = tsv(['차시', '학습 내용', '비고', '준비물'], ['1', '자기소개', '모둠', '이름표']);
    expect(parseLessonTable(text)).toEqual([{ unit: '', no: '1', content: '자기소개', supplies: '이름표' }]);
  });

  it('단원 칸만 있는 줄은 단원 제목 - 아래 차시들에 붙는다', () => {
    const text = tsv(['1단원 수와 연산', '', '', ''], ['', '1', '큰 수 읽기', ''], ['', '2', '큰 수 쓰기', '']);
    expect(parseLessonTable(text).map((l) => [l.unit, l.no, l.content])).toEqual([
      ['1단원 수와 연산', '1', '큰 수 읽기'],
      ['1단원 수와 연산', '2', '큰 수 쓰기'],
    ]);
  });

  it('머리줄이 없으면 단원 | 차시 | 내용 | 준비물 차례', () => {
    expect(parseLessonTable(tsv(['1단원', '1', '큰 수 읽기', '공책']))).toEqual([
      { unit: '1단원', no: '1', content: '큰 수 읽기', supplies: '공책' },
    ]);
    // 내용 칸에 머리줄 이름 같은 글자가 하나 있어도 머리줄로 보지 않는다
    expect(parseLessonTable(tsv(['1단원', '1', '활동', '공책']))).toHaveLength(1);
  });

  it('내용 칸 이름을 모르면 이름을 모르는 첫 칸이 내용', () => {
    expect(parseLessonTable(tsv(['차시', '오늘 배울 것', '준비물'], ['1', '자기소개', '이름표']))).toEqual([
      { unit: '', no: '1', content: '자기소개', supplies: '이름표' },
    ]);
  });

  it('머리줄이 없어도 차시(숫자) 칸을 찾아 맞춘다', () => {
    // 차시 | 내용 | 준비물
    expect(parseLessonTable(tsv(['1', '자기소개', '이름표'], ['2~3', '규칙 정하기', '']))).toEqual([
      { unit: '', no: '1', content: '자기소개', supplies: '이름표' },
      { unit: '', no: '2~3', content: '규칙 정하기', supplies: '' },
    ]);
    // 단원 번호도 숫자일 때 - 듬성듬성한 단원 칸이 아니라 차시 칸을 고른다
    const parsed = parseLessonTable(tsv(['1', '1', '가'], ['', '2', '나'], ['2', '3', '다']));
    expect(parsed.map((l) => [l.unit, l.no, l.content])).toEqual([
      ['1', '1', '가'],
      ['1', '2', '나'],
      ['2', '3', '다'],
    ]);
  });

  it('한 칸짜리는 내용으로 (머리줄 한 칸도 건너뛴다)', () => {
    expect(parseLessonTable('학습 내용\n자기소개\n')).toEqual([L('자기소개')]);
    expect(parseLessonTable('자기소개\n규칙 정하기\n\n')).toEqual([L('자기소개'), L('규칙 정하기')]);
  });

  it('비었거나 머리줄뿐이면 빈 목록', () => {
    expect(parseLessonTable('')).toEqual([]);
    expect(parseLessonTable(tsv(['단원', '차시', '내용', '준비물']))).toEqual([]);
  });
});

describe('수업 문서에서 과목 글자 읽기', () => {
  it('옛 자료(문자열)·새 자료(객체) 모두, 빈 교시와 교시가 아닌 칸은 뺀다', () => {
    expect(
      scheduleSubjects({ '1': ' 국어 ', '2': { subject: '수학', memo: 'x' }, '3': { subject: '' }, '4': '', note: '국어' })
    ).toEqual({ '1': '국어', '2': '수학' });
    expect(scheduleSubjects(undefined)).toEqual({});
  });
});

describe('진도 세기', () => {
  const lessons = [L('1차시'), L('2차시'), L('3차시'), L('4차시')];
  const plan = { key: '국어', startDate: '2026-10-05', lessons, bumps: [] as string[] };
  const subjects = {
    '2026-10-02': { '1': '국어' }, // 시작일 전 - 세지 않는다
    '2026-10-05': { '1': '국어', '2': '수학', '10': '국어', '3': ' 국어 ' }, // 같은 날 세 교시 - 교시 차례(3 다음 10)
    '2026-10-06': { '1': '수학' },
    '2026-10-07': { '2': '국어' },
    '2026-10-08': { '4': '국어' },
  };

  it('시작일부터 그 글자의 교시를 차례로 세어 k번째 교시 = k번째 차시', () => {
    const t = computeProgress(plan, subjects);
    expect(t.slots.map((s) => [s.date, s.period, s.lesson])).toEqual([
      ['2026-10-05', '1', 0],
      ['2026-10-05', '3', 1],
      ['2026-10-05', '10', 2],
      ['2026-10-07', '2', 3],
      ['2026-10-08', '4', 4], // 목록 밖
    ]);
    expect(t.last).toMatchObject({ date: '2026-10-07', period: '2' });
    expect(lessonAt(plan, t, '2026-10-07', 2)?.lesson.content).toBe('4차시');
    expect(lessonAt(plan, t, '2026-10-08', '4')).toBeNull(); // 목록이 끝났다
    expect(lessonAt(plan, t, '2026-10-06', '1')).toBeNull(); // 다른 과목
  });

  it("글자가 다르면 따로 센다 ('3-2 국어'와 '3-3 국어')", () => {
    const s = { '2026-10-05': { '1': '3-2 국어', '2': '3-3 국어', '3': '3-2 국어' } };
    const t = computeProgress({ ...plan, key: ' 3-2 국어' }, s);
    expect(t.slots.map((x) => [x.period, x.lesson])).toEqual([
      ['1', 0],
      ['3', 1],
    ]);
  });

  it('수업이 없는 날(방학·공휴일·수업X)은 건너뛴다', () => {
    const t = computeProgress(plan, subjects, (d) => d === '2026-10-05');
    expect(t.slots.map((s) => [s.date, s.lesson])).toEqual([
      ['2026-10-07', 0],
      ['2026-10-08', 1],
    ]);
    expect(t.last).toBeNull(); // 범위 안에서 목록이 끝나지 않는다
  });

  it('민 교시는 차시를 받지 않고 뒤가 한 칸씩 밀린다, 되돌리면 다시 당겨진다', () => {
    const bumps = toggleBump([], '2026-10-05', '3');
    expect(bumps).toEqual([slotId('2026-10-05', '3')]);
    const t = computeProgress({ ...plan, bumps }, subjects);
    expect(t.slots.map((s) => [s.date, s.period, s.lesson, s.bumped])).toEqual([
      ['2026-10-05', '1', 0, false],
      ['2026-10-05', '3', null, true],
      ['2026-10-05', '10', 1, false],
      ['2026-10-07', '2', 2, false],
      ['2026-10-08', '4', 3, false],
    ]);
    expect(t.last).toMatchObject({ date: '2026-10-08', period: '4' });
    expect(lessonAt({ lessons }, t, '2026-10-05', '3')).toBeNull();

    const undone = toggleBump(bumps, '2026-10-05', 3);
    expect(undone).toEqual([]);
    expect(computeProgress({ ...plan, bumps: undone }, subjects).slots[1].lesson).toBe(1);
  });

  it('과목이 바뀌어 맞지 않게 된 밀기는 아무것도 밀지 않는다', () => {
    const t = computeProgress({ ...plan, bumps: [slotId('2026-10-06', '1')] }, subjects);
    expect(t.slots.every((s) => !s.bumped)).toBe(true);
    expect(t.slots[3].lesson).toBe(3);
  });

  it('같은 칸 글자의 다음 진도가 그 시작일부터 이어받는다', () => {
    const plans = [
      { id: 'a', key: '국어', startDate: '2026-03-02' },
      { id: 'b', key: '국어 ', startDate: '2026-10-07' },
      { id: 'c', key: '국어', startDate: '2026-12-01' },
      { id: 'd', key: '수학', startDate: '2026-09-01' },
    ];
    expect(progressUntil(plans[0], plans)).toBe('2026-10-07');
    expect(progressUntil(plans[1], plans)).toBe('2026-12-01');
    expect(progressUntil(plans[2], plans)).toBeUndefined();
    const t = computeProgress(plan, subjects, undefined, '2026-10-07');
    expect(t.slots.map((s) => s.date)).toEqual(['2026-10-05', '2026-10-05', '2026-10-05']);
  });

  it('칸 글자나 시작일이 없으면 세지 않는다', () => {
    expect(computeProgress({ ...plan, key: '  ' }, subjects).slots).toEqual([]);
    expect(computeProgress({ ...plan, startDate: '' }, subjects).slots).toEqual([]);
  });

  it('수업 없는 날 가리기는 lib/classDays 규칙 (방학·공휴일·수업X)', () => {
    const isOff = offDayChecker(
      { '2026-10-07': { eventList: [{ id: 'a', content: '운동회', skip: true }] } },
      { holidays: { '2026-10-09': '한글날' } }
    );
    expect(['2026-10-06', '2026-10-07', '2026-10-09'].map(isOff)).toEqual([false, true, true]);
  });
});

describe('수업 칸에 겹쳐 보기', () => {
  const base = { bumps: [] as string[], updatedAt: 1 };
  const plans = [
    { ...base, id: 'k1', key: '국어', startDate: '2026-10-05', lessons: [L('가', { supplies: '공책' }), L('나')] },
    { ...base, id: 'm1', key: '수학', startDate: '2026-10-05', lessons: [L('하나')], bumps: ['2026-10-05#2'] },
    { ...base, id: 'k2', key: '국어', startDate: '2026-10-07', lessons: [L('2학기 첫 차시')] },
    { ...base, id: 'e', key: '과학', startDate: '2026-10-05', lessons: [] },
  ];
  const subjects = {
    '2026-10-05': { '1': '국어', '2': '수학', '3': '과학' },
    '2026-10-06': { '1': '국어', '2': '수학', '3': '국어' },
    '2026-10-07': { '1': '국어' },
  };

  it('교시마다 그 진도의 차시, 민 교시, 목록이 끝난 뒤는 빈칸, 다음 진도가 이어받음', () => {
    const m = progressMarks(plans, subjects);
    expect(m['2026-10-05#1']).toMatchObject({ planId: 'k1', index: 0, total: 2, bumped: false });
    expect(m['2026-10-05#1'].lesson?.supplies).toBe('공책');
    expect(m['2026-10-06#1']).toMatchObject({ planId: 'k1', index: 1 });
    expect(m['2026-10-06#3']).toBeUndefined(); // 국어 목록(2차시)이 끝났다
    expect(m['2026-10-05#2']).toMatchObject({ planId: 'm1', index: null, bumped: true, lesson: null });
    expect(m['2026-10-06#2']).toMatchObject({ planId: 'm1', index: 0 });
    expect(m['2026-10-07#1']).toMatchObject({ planId: 'k2', index: 0, total: 1 }); // 10/7부터 다음 국어 진도
    expect(m['2026-10-05#3']).toBeUndefined(); // 차시가 없는 진도
  });
});

describe('저장된 모양 읽기', () => {
  it('모르는 모양은 고쳐 읽는다', () => {
    expect(
      sanitizePlan('pg_1', { key: ' 국어 ', startDate: '2026/10/05', lessons: [{ content: 3 }, null], bumps: ['a', 1] })
    ).toEqual({
      id: 'pg_1',
      key: '국어',
      startDate: '',
      lessons: [{ unit: '', no: '', content: '3', supplies: '' }],
      bumps: ['a'],
      updatedAt: undefined,
    });
  });

  it('학년도 끝 (3월~이듬해 2월)', () => {
    expect(schoolYearEnd('2026-10-01')).toBe('2027-02-28');
    expect(schoolYearEnd('2027-02-10')).toBe('2027-02-28');
    expect(schoolYearEnd('2026-03-02')).toBe('2027-02-28');
    expect(schoolYearEnd('2027-05-01')).toBe('2028-02-29');
  });
});
