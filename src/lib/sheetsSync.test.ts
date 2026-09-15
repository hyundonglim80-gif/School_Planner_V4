import { describe, it, expect } from 'vitest';
import {
  formatItemLine,
  parseItemLine,
  formatPeriodCell,
  parsePeriodCell,
  buildScheduleRows,
  parseScheduleRows,
  buildMemoRows,
  parseMemoRows,
} from './sheetsSync';

const include = { event: true, class: true, journal: true, memo: true };
const periodNames = ['1교시', '2교시', '3교시'];
const eventLabels = [{ id: 'l1', name: '회의' }];
const journalLabels = [{ id: 'j1', name: '상담' }];

describe('한 줄 모양 - V3와 같아야 한다', () => {
  it('완료는 [v]로, 라벨은 [묶음]으로 적는다', () => {
    expect(formatItemLine('학년 협의회', ['회의'], true, '일정')).toBe('[v] [회의] 학년 협의회');
    expect(formatItemLine('학년 협의회', [], false, '일정')).toBe('[일정] 학년 협의회');
    expect(formatItemLine('학년 협의회', ['회의', '공문'], false, '일정')).toBe('[회의, 공문] 학년 협의회');
  });

  it('적은 대로 되읽는다', () => {
    expect(parseItemLine('[v] [회의, 공문] 학년 협의회')).toEqual({
      content: '학년 협의회',
      labels: ['회의', '공문'],
      completed: true,
    });
  });

  it('라벨이 없는 줄도 받는다', () => {
    expect(parseItemLine('그냥 적은 줄')).toEqual({ content: '그냥 적은 줄', labels: [], completed: false });
  });

  it('빈 줄은 버린다', () => {
    expect(parseItemLine('   ')).toBeNull();
  });
});

describe('교시 한 칸 - [과목] 메모 [준비물]', () => {
  it('세 가지를 한 칸에 담는다', () => {
    expect(formatPeriodCell({ subject: '국어', memo: '단원평가', supplies: '학습지' })).toBe(
      '[국어] 단원평가 [학습지]'
    );
  });

  it('없는 것은 빼고 담는다', () => {
    expect(formatPeriodCell({ subject: '국어' })).toBe('[국어]');
    expect(formatPeriodCell({ memo: '자습' })).toBe('자습');
    expect(formatPeriodCell(null)).toBe('');
  });

  it('되읽으면 셋으로 나뉜다', () => {
    expect(parsePeriodCell('[국어] 단원평가 [학습지]')).toEqual({
      subject: '국어',
      memo: '단원평가',
      supplies: '학습지',
    });
  });

  it('묶음이 하나면 과목으로 본다 (준비물이 아니다)', () => {
    expect(parsePeriodCell('[국어]')).toEqual({ subject: '국어', memo: '', supplies: '' });
  });

  it('묶음이 없으면 메모로 본다', () => {
    expect(parsePeriodCell('자습')).toEqual({ subject: '', memo: '자습', supplies: '' });
  });

  it('빈 칸도 받는다', () => {
    expect(parsePeriodCell('')).toEqual({ subject: '', memo: '', supplies: '' });
  });
});

describe('일정기록 시트', () => {
  const rows = buildScheduleRows({
    dates: ['2026-09-15'],
    events: { '2026-09-15': { eventList: [{ id: 'ev1', content: '학년 협의회', labelIds: ['l1'], completed: true }] } },
    schedules: { '2026-09-15': { periods: { 1: { subject: '국어', memo: '단원평가' } } } },
    journals: { '2026-09-15': { entries: [{ id: 'jr1', content: '상담 기록', label: '상담' }] } },
    include,
    periodNames,
    eventLabels,
    journalLabels,
  });

  it('머리말이 V3와 같은 차례다', () => {
    expect(rows[0]).toEqual([
      '날짜',
      '일정',
      '1교시',
      '2교시',
      '3교시',
      '기록',
      '일정 메타데이터 (수정금지)',
      '기록 메타데이터 (수정금지)',
    ]);
  });

  it('한 날짜가 한 줄이 된다', () => {
    expect(rows).toHaveLength(2);
    expect(rows[1][0]).toBe('2026-09-15');
    expect(rows[1][1]).toBe('[v] [회의] 학년 협의회');
    expect(rows[1][2]).toBe('[국어] 단원평가');
    expect(rows[1][5]).toBe('[상담] 상담 기록');
  });

  it('메타데이터에 id를 담는다 (되읽을 때 같은 항목으로 알아보려면 필요하다)', () => {
    expect(JSON.parse(rows[1][6])[0].id).toBe('ev1');
    expect(JSON.parse(rows[1][7])[0].id).toBe('jr1');
  });

  it('내보낸 것을 그대로 되읽으면 원래 값이 나온다', () => {
    const back = parseScheduleRows(rows, include);

    expect(back.events['2026-09-15']).toHaveLength(1);
    expect(back.events['2026-09-15'][0]).toMatchObject({
      id: 'ev1', // 메타데이터에서 되찾는다
      content: '학년 협의회',
      completed: true,
      labels: ['회의'],
    });
    expect(back.schedules['2026-09-15'][1]).toEqual({ subject: '국어', memo: '단원평가', supplies: '' });
    expect(back.journals['2026-09-15'][0]).toMatchObject({ id: 'jr1', content: '상담 기록', labels: ['상담'] });
  });

  it('사람이 시트에 손으로 적어 넣은 줄도 받는다 (메타데이터가 없다)', () => {
    const handWritten = [
      ['날짜', '일정', '1교시', '2교시', '3교시', '기록', '일정 메타데이터 (수정금지)', '기록 메타데이터 (수정금지)'],
      ['2026-09-16', '[회의] 손으로 적은 일정', '', '', '', '', '', ''],
    ];
    const back = parseScheduleRows(handWritten, include);

    expect(back.events['2026-09-16']).toHaveLength(1);
    expect(back.events['2026-09-16'][0].content).toBe('손으로 적은 일정');
    // id가 없으면 새로 만들어 준다
    expect(back.events['2026-09-16'][0].id).toMatch(/^ev_/);
  });

  it('날짜가 아닌 줄은 건너뛴다', () => {
    const messy = [
      ['날짜', '일정', '일정 메타데이터 (수정금지)'],
      ['메모: 아무거나 적어 둔 줄', '', ''],
      ['2026-09-16', '[회의] 진짜 일정', ''],
    ];
    const back = parseScheduleRows(messy, { ...include, class: false, journal: false });

    expect(Object.keys(back.events)).toEqual(['2026-09-16']);
  });

  it('머리말만 있으면 빈 값이다', () => {
    expect(parseScheduleRows([['날짜', '일정']], include)).toEqual({ events: {}, schedules: {}, journals: {} });
  });

  it('고르지 않은 종류는 칸을 만들지 않는다', () => {
    const onlyEvents = buildScheduleRows({
      dates: ['2026-09-15'],
      events: {},
      schedules: {},
      journals: {},
      include: { event: true, class: false, journal: false, memo: false },
      periodNames,
      eventLabels,
      journalLabels,
    });
    expect(onlyEvents[0]).toEqual(['날짜', '일정', '일정 메타데이터 (수정금지)']);
  });
});

describe('메모 시트', () => {
  const tasks = [
    { id: 'm1', data: { content: '준비물 확인', completed: true, labels: ['업무'], createdAt: 1789130791044 } },
  ];
  const rows = buildMemoRows(tasks);

  it('머리말이 V3와 같다', () => {
    expect(rows[0]).toEqual([
      '데이터분류',
      'ID',
      '내용/이름',
      '완료여부(O/X)',
      '라벨',
      '주소/URL',
      '생성일자(타임스탬프)',
    ]);
  });

  it('완료는 O, 미완료는 X로 적는다', () => {
    expect(rows[1][3]).toBe('O');
    expect(buildMemoRows([{ id: 'm2', data: { content: '할 일' } }])[1][3]).toBe('X');
  });

  it('내보낸 것을 그대로 되읽는다', () => {
    expect(parseMemoRows(rows)[0]).toMatchObject({
      id: 'm1',
      content: '준비물 확인',
      completed: true,
      labels: ['업무'],
      createdAt: 1789130791044,
    });
  });

  it('V3가 같은 시트에 넣는 링크(LINK) 줄은 건너뛴다', () => {
    const withLinks = [
      rows[0],
      ['LINK', 'LINK_0', '교육청', '', '', 'https://example.kr', ''],
      ...rows.slice(1),
    ];
    const back = parseMemoRows(withLinks);

    expect(back).toHaveLength(1);
    expect(back[0].id).toBe('m1');
  });

  it('내용이 빈 줄은 건너뛴다', () => {
    expect(parseMemoRows([rows[0], ['MEMO', 'm9', '  ', 'X', '', '', '']])).toEqual([]);
  });
});
