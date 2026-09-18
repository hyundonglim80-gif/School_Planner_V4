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
  buildEvalRows,
  parseEvalRows,
  applyEvalUpdates,
  evalSheetNameOf,
  groupEvalsBySheet,
} from './sheetsSync';

const include = { event: true, class: true, journal: true, evaluation: false, memo: true };
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
    evaluations: {},
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
    expect(parseScheduleRows([['날짜', '일정']], include)).toEqual({
      events: {},
      schedules: {},
      journals: {},
      evaluations: {},
    });
  });

  it('고르지 않은 종류는 칸을 만들지 않는다', () => {
    const onlyEvents = buildScheduleRows({
      dates: ['2026-09-15'],
      events: {},
      schedules: {},
      journals: {},
      evaluations: {},
      include: { event: true, class: false, journal: false, evaluation: false, memo: false },
      periodNames,
      eventLabels,
      journalLabels,
    });
    expect(onlyEvents[0]).toEqual(['날짜', '일정', '일정 메타데이터 (수정금지)']);
  });

  it('조사표 칸은 기록 다음, 메타데이터 앞에 온다 (V3와 같은 자리)', () => {
    const withEval = buildScheduleRows({
      dates: ['2026-09-15'],
      events: {},
      schedules: {},
      journals: {},
      evaluations: { '2026-09-15': { list: [{ id: 'el1', title: '1단원 평가', type: 'eval' }] } },
      include: { ...include, evaluation: true },
      periodNames,
      eventLabels,
      journalLabels,
    });

    expect(withEval[0]).toEqual([
      '날짜',
      '일정',
      '1교시',
      '2교시',
      '3교시',
      '기록',
      '조사표',
      '일정 메타데이터 (수정금지)',
      '기록 메타데이터 (수정금지)',
    ]);
    expect(JSON.parse(withEval[1][6])[0].title).toBe('1단원 평가');
  });

  it('조사표 칸을 교시로 잘못 세지 않는다', () => {
    const rowsWithEval = buildScheduleRows({
      dates: ['2026-09-15'],
      events: {},
      schedules: { '2026-09-15': { periods: { 1: { subject: '국어' }, 2: { subject: '수학' } } } },
      journals: {},
      evaluations: {},
      include: { ...include, evaluation: true },
      periodNames,
      eventLabels,
      journalLabels,
    });
    const back = parseScheduleRows(rowsWithEval, { ...include, evaluation: true });

    // 조사표 칸을 교시로 세면 교시가 네 개가 되고 과목이 한 칸씩 밀린다
    expect(Object.keys(back.schedules['2026-09-15'])).toHaveLength(3);
    expect(back.schedules['2026-09-15'][1].subject).toBe('국어');
    expect(back.schedules['2026-09-15'][2].subject).toBe('수학');
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

describe('조사표 학급별 시트 - V3와 같은 모양이어야 한다', () => {
  const students = [
    { num: 1, name: '김하나', gender: 'F' },
    { num: 2, name: '이두리', gender: 'M' },
  ];

  const evalItem = {
    id: 'el1',
    title: '1단원 평가',
    type: 'eval',
    subject: '국어',
    dateStr: '2026-09-15',
    periodStr: 2,
    methodObj: { indiv: true, group: false },
    rosterMeta: { year: 2026, grade: '4', classNum: '1' },
    studentsSnapshot: students,
    records: {
      1: { indivScore: '우수' },
      2: { indivScore: '보통', reason: '결석' },
    },
  };

  const checkItem = {
    id: 'el2',
    title: '준비물 체크',
    type: 'check',
    dateStr: '2026-09-15',
    periodStr: '',
    rosterMeta: { year: 2026, grade: '4', classNum: '1' },
    studentsSnapshot: students,
    records: { 1: { checked: true }, 2: { checked: false, reason: '깜빡함' } },
  };

  it('학급마다 탭 하나로 모은다', () => {
    expect(evalSheetNameOf({ year: 2026, grade: '4', classNum: '1' })).toBe('조사표_2026-4-1');
    expect(evalSheetNameOf(undefined)).toBe('조사표_기타');
  });

  it('학급을 모르는 조사표는 기타로 간다', () => {
    const bySheet = groupEvalsBySheet({
      '2026-09-15': { list: [evalItem, { ...checkItem, rosterMeta: {} }] },
    });
    expect(Object.keys(bySheet).sort()).toEqual(['조사표_2026-4-1', '조사표_기타']);
  });

  it('머리말 여덟 줄과 학생 줄로 이루어진다', () => {
    const rows = buildEvalRows([evalItem]);

    expect(rows[0].slice(0, 4)).toEqual(['상위 항목(조사표 제목)', '', '', '1단원 평가']);
    expect(rows[1].slice(0, 4)).toEqual(['조사표 ID (수정금지)', '', '', 'el1']);
    expect(rows[3][3]).toBe('2교시');
    expect(rows[4][3]).toBe('평가');
    expect(rows[6][3]).toBe('개인');
    expect(rows[7]).toEqual(['번호', '이름', '성별', '개별결과', '미평가사유(메모)']);
    expect(rows[8]).toEqual(['1', '김하나', 'F', '우수', '']);
    expect(rows[9]).toEqual(['2', '이두리', 'M', '보통', '결석']);
  });

  it('조사표 하나가 칸을 여럿 차지하면 제목은 첫 칸에만 적는다', () => {
    const groupEval = { ...evalItem, methodObj: { indiv: true, group: true } };
    const rows = buildEvalRows([groupEval]);

    expect(rows[7].slice(3)).toEqual(['조이름', '조별결과', '개별결과', '미평가사유(메모)']);
    // 제목은 첫 칸에만, 나머지 세 칸은 비운다
    expect(rows[0].slice(3)).toEqual(['1단원 평가', '', '', '']);
    expect(rows[6][3]).toBe('개인, 조별');
  });

  it('체크는 O/X로 적고 메모는 한 칸이다', () => {
    const rows = buildEvalRows([checkItem]);

    expect(rows[7].slice(3)).toEqual(['체크결과', '미평가사유(메모)']);
    expect(rows[8].slice(3)).toEqual(['O', '']);
    expect(rows[9].slice(3)).toEqual(['X', '깜빡함']);
  });

  it('내보낸 표를 그대로 되읽으면 원래 값이 나온다', () => {
    const rows = buildEvalRows([evalItem, checkItem]);
    const updates = parseEvalRows(rows);

    // 조사표가 무엇인지는 일정기록 시트에서 오고, 결과만 얹는다
    const evaluations = {
      '2026-09-15': [
        { ...evalItem, records: {} },
        { ...checkItem, records: {} },
      ],
    };
    applyEvalUpdates(evaluations, updates);

    expect(evaluations['2026-09-15'][0].records).toEqual({
      1: { indivScore: '우수', score: '우수', reason: '' },
      2: { indivScore: '보통', score: '보통', reason: '결석' },
    });
    expect(evaluations['2026-09-15'][1].records).toEqual({
      1: { checked: true, reason: '' },
      2: { checked: false, reason: '깜빡함' },
    });
  });

  it('사람이 시트에서 점수를 고치면 그 값이 들어온다', () => {
    const rows = buildEvalRows([evalItem]);
    rows[8][3] = '노력요함'; // 1번 학생의 개별결과를 손으로 고쳤다

    const evaluations = { '2026-09-15': [{ ...evalItem, records: {} as Record<number, any> }] };
    applyEvalUpdates(evaluations, parseEvalRows(rows));

    expect(evaluations['2026-09-15'][0].records[1].indivScore).toBe('노력요함');
  });

  it('시트에만 있고 앱에 없는 조사표는 되살리지 않는다', () => {
    const rows = buildEvalRows([evalItem]);
    const evaluations = { '2026-09-15': [{ ...checkItem, records: {} }] };

    expect(applyEvalUpdates(evaluations, parseEvalRows(rows))).toBe(0);
    expect(evaluations['2026-09-15'][0].records).toEqual({});
  });

  it('머리말을 알아보지 못하면 아무것도 읽지 않는다', () => {
    expect(parseEvalRows([['아무거나'], ['적어', '둔', '표']])).toEqual([]);
    expect(parseEvalRows([])).toEqual([]);
  });

  describe('전출·전입으로 번호를 이어받았을 때', () => {
    // 9월에 5번이던 홍길동이 전출하고, 10월에 들어온 김새벽이 5번을 이어받았다.
    // 두 조사표가 같은 학급 탭에 들어간다.
    const before = {
      id: 'el9',
      title: '9월 평가',
      type: 'eval',
      dateStr: '2026-09-15',
      periodStr: 1,
      methodObj: { indiv: true, group: false },
      rosterMeta: { year: 2026, grade: '4', classNum: '1' },
      studentsSnapshot: [{ num: 5, name: '홍길동', gender: 'M' }],
      records: { 5: { indivScore: '우수' } },
    };

    const after = {
      ...before,
      id: 'el10',
      title: '10월 평가',
      dateStr: '2026-10-15',
      studentsSnapshot: [{ num: 5, name: '김새벽', gender: 'F' }],
      records: { 5: { indivScore: '노력요함' } },
    };

    it('같은 번호라도 학생마다 한 줄씩 만든다', () => {
      const rows = buildEvalRows([before, after]);
      const studentRows = rows.slice(8);

      expect(studentRows).toHaveLength(2);
      expect(studentRows.map((r) => [r[0], r[1]])).toEqual([
        ['5', '김새벽'],
        ['5', '홍길동'],
      ]);
    });

    it('전출한 학생의 점수가 전입한 학생에게 옮겨 붙지 않는다', () => {
      const rows = buildEvalRows([before, after]);
      const evaluations = {
        '2026-09-15': [{ ...before, records: {} as Record<number, any> }],
        '2026-10-15': [{ ...after, records: {} as Record<number, any> }],
      };
      applyEvalUpdates(evaluations, parseEvalRows(rows));

      expect(evaluations['2026-09-15'][0].records[5].indivScore).toBe('우수');
      expect(evaluations['2026-10-15'][0].records[5].indivScore).toBe('노력요함');
    });

    it('시트에서 이름을 고쳐도 그 번호를 쓰는 줄이 하나뿐이면 받아들인다', () => {
      const rows = buildEvalRows([before]);
      rows[8][1] = '홍길똥'; // 이름을 잘못 적어 두었다
      rows[8][3] = '보통';

      const evaluations = { '2026-09-15': [{ ...before, records: {} as Record<number, any> }] };
      applyEvalUpdates(evaluations, parseEvalRows(rows));

      expect(evaluations['2026-09-15'][0].records[5].indivScore).toBe('보통');
    });
  });
});
