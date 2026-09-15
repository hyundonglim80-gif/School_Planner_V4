import { describe, it, expect } from 'vitest';
import {
  APP_TAG,
  nextDayStr,
  dateRange,
  invisiblePrefix,
  bareSummary,
  labelNamesOf,
  isInternalId,
  summaryCore,
  buildPayloads,
  isSameItem,
  needsUpdate,
} from './calendarSync';

const labels = [{ id: 'l1', name: '회의' }];
const journalLabels = [{ id: 'j1', name: '상담' }];
const periodNames = ['1교시', '2교시', '3교시'];

const build = (over: Partial<Parameters<typeof buildPayloads>[0]> = {}) =>
  buildPayloads({
    dateStr: '2026-09-15',
    eventLabels: labels,
    journalLabels,
    periodNames,
    ...over,
  });

describe('nextDayStr - 종일 일정의 끝 날짜', () => {
  it('하루 뒤를 준다', () => {
    // 구글은 end.date를 포함하지 않는다. 같은 날을 넣으면 달력에 뜨지 않는다.
    expect(nextDayStr('2026-09-15')).toBe('2026-09-16');
  });

  it('달과 해를 넘어간다', () => {
    expect(nextDayStr('2026-09-30')).toBe('2026-10-01');
    expect(nextDayStr('2026-12-31')).toBe('2027-01-01');
  });

  it('윤년 2월을 안다', () => {
    expect(nextDayStr('2028-02-28')).toBe('2028-02-29');
  });
});

describe('dateRange', () => {
  it('시작일과 종료일을 모두 포함한다', () => {
    expect(dateRange('2026-09-14', '2026-09-16')).toEqual(['2026-09-14', '2026-09-15', '2026-09-16']);
  });

  it('하루짜리도 된다', () => {
    expect(dateRange('2026-09-15', '2026-09-15')).toEqual(['2026-09-15']);
  });

  it('시작이 끝보다 늦으면 빈 목록이다', () => {
    expect(dateRange('2026-09-20', '2026-09-15')).toEqual([]);
  });
});

describe('제목 앞의 보이지 않는 글자', () => {
  it('순서마다 다른 값이 나온다', () => {
    expect(invisiblePrefix(1)).not.toBe(invisiblePrefix(2));
  });

  it('눈에 보이는 글자는 없다', () => {
    expect(invisiblePrefix(3).replace(/[‌‍]/g, '')).toBe('');
  });

  it('떼어내면 원래 제목만 남는다', () => {
    expect(bareSummary(`${invisiblePrefix(2)}✅ 학년 협의회 [회의]`)).toBe('학년 협의회 [회의]');
  });
});

describe('labelNamesOf - 라벨이 담긴 자리가 제각각이다', () => {
  it('labelIds는 이름으로 바꾼다', () => {
    expect(labelNamesOf({ labelIds: ['l1'] }, labels)).toEqual(['회의']);
  });

  it('이름을 못 찾은 식별자는 버린다', () => {
    // 예전에는 이런 제목이 구글 캘린더에 올라갔다.
    //   [lbl_ev_mtitpq5d_2Ou1v] 아침 빙고
    expect(labelNamesOf({ labelIds: ['lbl_ev_mtitpq5d_2Ou1v'] }, labels)).toEqual([]);
    expect(labelNamesOf({ labels: ['ev_recovered_1789130791044_7'] }, labels)).toEqual([]);
  });

  it('사람이 읽을 수 있는 것은 못 찾아도 남긴다 (설정에서 지운 라벨)', () => {
    expect(labelNamesOf({ labelIds: ['공문'] }, labels)).toEqual(['공문']);
  });

  it('여러 자리에 나뉘어 담겨 있어도 모두 모으고 중복은 뺀다', () => {
    expect(labelNamesOf({ labelIds: ['l1'], label: '회의,공문' }, labels)).toEqual(['회의', '공문']);
  });

  it('labels 배열과 label 하나도 받는다', () => {
    expect(labelNamesOf({ labels: ['수업'] }, labels)).toEqual(['수업']);
    expect(labelNamesOf({ label: '기타' }, labels)).toEqual(['기타']);
  });

  it('아무것도 없으면 빈 목록이다', () => {
    expect(labelNamesOf({}, labels)).toEqual([]);
  });
});

describe('summaryCore - 라벨 자리가 바뀌어도 같은 것으로 본다', () => {
  it('라벨을 앞에 두던 옛 제목과 뒤에 두는 새 제목이 같게 나온다', () => {
    // 형식을 바꾸면서 짝을 못 찾으면 같은 일정이 두 벌이 된다
    expect(summaryCore('[회의] 학년 협의회')).toBe(summaryCore('학년 협의회 [회의]'));
  });

  it('보이지 않는 글자와 완료 표시도 함께 뗀다', () => {
    expect(summaryCore(`${invisiblePrefix(3)}✅ 학년 협의회 [회의]`)).toBe('학년 협의회');
  });

  it('앞뒤에 모두 붙어 있어도 알맹이만 남긴다', () => {
    // V3가 본문에 [공문] 을 적어 둔 항목이 있다
    expect(summaryCore('[일정] [공문] 2026년 조사')).toBe('2026년 조사');
    expect(summaryCore('[공문] 2026년 조사 [일정]')).toBe('2026년 조사');
  });

  it('내용이 통째로 [묶음]이면 비우지 않는다', () => {
    expect(summaryCore('[전달사항]')).toBe('[전달사항]');
  });

  it('내용이 다르면 다르게 나온다', () => {
    expect(summaryCore('학년 협의회 [회의]')).not.toBe(summaryCore('교직원 회의 [회의]'));
  });
});

describe('isInternalId - 사람이 읽을 수 없는 식별자', () => {
  it('내부 식별자를 알아본다', () => {
    for (const key of ['lbl_ev_mtitpq5d_2Ou1v', 'lbl_jr_mtcgvgos_3cxjq', 'ev_recovered_1789130791044_7', 'j_1']) {
      expect(isInternalId(key), key).toBe(true);
    }
  });

  it('사람이 붙인 이름은 건드리지 않는다', () => {
    for (const key of ['회의', '공문', '학급활동', 'ToDo', '수업X', 'Meeting 2026']) {
      expect(isInternalId(key), key).toBe(false);
    }
  });
});

describe('buildPayloads - 보낼 내용 만들기', () => {
  it('일정에 라벨과 완료 표시를 담는다', () => {
    const out = build({
      eventData: { eventList: [{ id: 'ev1', content: '학년 협의회', labelIds: ['l1'], completed: true }] },
    });

    expect(out.event).toHaveLength(1);
    // 라벨은 뒤에 붙인다. 앞에 두면 좋은 칸에서 라벨만 보이고 내용이 잘렸다.
    expect(bareSummary(out.event[0].summary)).toBe('학년 협의회 [회의]');
    expect(out.event[0].start.date).toBe('2026-09-15');
    expect(out.event[0].end.date).toBe('2026-09-16');
    expect(out.event[0].extendedProperties.private).toMatchObject({
      app: APP_TAG,
      type: 'event',
      sp_id: 'ev1',
      completed: 'true',
    });
  });

  it('V3가 쓰던 표시를 그대로 단다', () => {
    // 표시가 다르면 V3가 올려둔 일정을 못 알아보고 같은 것을 또 만든다
    expect(APP_TAG).toBe('SchoolPlannerV3');
  });

  it('구글에서 가져온 일정과 공휴일은 도로 올리지 않는다', () => {
    const out = build({
      eventData: {
        eventList: [
          { id: 'a', content: '구글 일정', source: 'google_primary' },
          { id: 'b', content: '추석', source: 'holiday' },
          { id: 'c', content: '내가 쓴 일정' },
        ],
      },
    });

    expect(out.event).toHaveLength(1);
    expect(bareSummary(out.event[0].summary)).toContain('내가 쓴 일정');
  });

  it('이름을 모르는 라벨 때문에 제목에 식별자가 찍히지 않는다', () => {
    const out = build({
      eventData: { eventList: [{ id: 'ev1', content: '아침 빙고', labelIds: ['lbl_ev_mtitpq5d_2Ou1v'] }] },
    });

    expect(bareSummary(out.event[0].summary)).toBe('아침 빙고 [일정]');
    expect(out.event[0].summary).not.toContain('lbl_');
  });

  it('식별자는 제목에서 빠져도 extendedProperties에는 그대로 남는다', () => {
    // 같은 항목인지 알아보려면 이 값이 필요하다. 여기 있는 것은 화면에 보이지 않는다.
    const out = build({ eventData: { eventList: [{ id: 'ev1', content: '아침 빙고' }] } });
    expect(out.event[0].extendedProperties.private.sp_id).toBe('ev1');
  });

  it('빈 내용은 건너뛴다', () => {
    const out = build({ eventData: { eventList: [{ id: 'a', content: '   ' }] } });
    expect(out.event).toHaveLength(0);
  });

  it('수업은 교시 이름을 쓰고 X는 건너뛴다', () => {
    const out = build({
      scheduleData: { periods: { 1: { subject: '국어' }, 2: { subject: 'X' }, 3: { subject: '' } } },
    });

    expect(out.class).toHaveLength(1);
    expect(bareSummary(out.class[0].summary)).toBe('국어 [1교시]');
    expect(out.class[0].extendedProperties.private.period).toBe('1');
  });

  it('교시 수는 시간표에 등록된 만큼만 본다', () => {
    const out = build({
      scheduleData: { periods: { 1: { subject: '국어' }, 7: { subject: '있으면 안 됨' } } },
    });
    expect(out.class).toHaveLength(1);
  });

  it('기록은 긴 내용을 제목에서 줄이고 설명에 전부 담는다', () => {
    const long = '가'.repeat(40);
    const out = build({ journalData: { entries: [{ id: 'j1', content: long, label: '상담' }] } });

    expect(out.journal).toHaveLength(1);
    expect(bareSummary(out.journal[0].summary)).toContain('...');
    expect(out.journal[0].description).toContain(long);
  });

  it('한 날짜 안에서 순서가 섞이지 않게 앞글자가 서로 다르다', () => {
    const out = build({
      eventData: { eventList: [{ id: 'a', content: '첫째' }, { id: 'b', content: '둘째' }] },
    });
    expect(out.event[0].summary).not.toBe(out.event[1].summary.replace('둘째', '첫째'));
  });
});

describe('isSameItem - 같은 것을 두 번 넣지 않기', () => {
  const payload = build({
    eventData: { eventList: [{ id: 'ev1', content: '학년 협의회' }] },
  }).event[0];

  it('우리가 붙인 id가 같으면 같은 것이다', () => {
    const existing = {
      summary: '전혀 다른 제목',
      extendedProperties: { private: { app: APP_TAG, type: 'event', dateStr: '2026-09-15', sp_id: 'ev1' } },
    };
    expect(isSameItem(existing, payload)).toBe(true);
  });

  it('id가 없던 옛 일정은 제목으로 맞춘다 (라벨 자리가 달라도)', () => {
    const existing = {
      summary: `${invisiblePrefix(9)}✅ [일정] 학년 협의회`, // 라벨을 앞에 두던 시절에 올라간 제목
      extendedProperties: { private: { app: APP_TAG, type: 'event', dateStr: '2026-09-15' } },
    };
    expect(isSameItem(existing, payload)).toBe(true);
  });

  it('날짜가 다르면 다른 것이다', () => {
    const existing = {
      summary: '[일정] 학년 협의회',
      extendedProperties: { private: { app: APP_TAG, type: 'event', dateStr: '2026-09-16', sp_id: 'ev1' } },
    };
    expect(isSameItem(existing, payload)).toBe(false);
  });

  it('우리 표시가 없는 일정(사용자가 직접 만든 것)은 건드리지 않는다', () => {
    expect(isSameItem({ summary: '[일정] 학년 협의회' }, payload)).toBe(false);
  });

  it('수업은 교시로 맞춘다 (과목이 바뀌어도 같은 자리다)', () => {
    const classPayload = build({ scheduleData: { periods: { 1: { subject: '수학' } } } }).class[0];
    const existing = {
      summary: '[1교시] 국어',
      extendedProperties: { private: { app: APP_TAG, type: 'class', dateStr: '2026-09-15', period: '1' } },
    };
    expect(isSameItem(existing, classPayload)).toBe(true);
    expect(needsUpdate(existing, classPayload)).toBe(true);
  });

  it('달라진 것이 없으면 고치지 않는다', () => {
    const same = {
      summary: payload.summary,
      description: payload.description,
      extendedProperties: { private: { ...payload.extendedProperties.private } },
    };
    expect(needsUpdate(same, payload)).toBe(false);
  });
});
