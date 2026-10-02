import { describe, it, expect } from 'vitest';
import {
  parseSlot,
  formatSlot,
  normalizeSlotText,
  classLabelOf,
  classesForYear,
  slotSuggestions,
  rosterForSlot,
  classColor,
  CLASS_COLORS, previousSlotOf } from './teachingSlot';
import type { ClassRoster } from '../hooks/useRoster';

const roster = (year: number, grade: string, classNum: string): ClassRoster => ({ year, grade, classNum, students: [] });

describe('parseSlot - 여러 모양을 한 반으로 읽는다', () => {
  it.each([
    ['5-2 과학', '5-2', '과학'],
    ['5-2과학', '5-2', '과학'],
    ['5 - 2 과학', '5-2', '과학'],
    ['5–2 과학', '5-2', '과학'], // 긴 줄표
    ['５-２ 과학', '5-2', '과학'], // 전각 숫자
    ['5－2 과학', '5-2', '과학'], // 전각 줄표
    ['5학년 2반 과학', '5-2', '과학'],
    ['5학년2반', '5-2', ''],
    ['05-02 과학', '5-2', '과학'],
    ['5-2반 과학', '5-2', '과학'],
    ['  5-10   과학  ', '5-10', '과학'],
    ['5-2 창의적   체험 활동', '5-2', '창의적 체험 활동'], // 과목 여러 단어, 가운데 공백 하나로
  ])('%s → %s / %s', (text, cls, subject) => {
    const p = parseSlot(text);
    expect(p.cls).toBe(cls);
    expect(p.subject).toBe(subject);
    expect(`${p.grade}-${p.classNum}`).toBe(cls);
  });

  it.each(['5-', '-2', '과학', '창체', '', '   ', '5-123 과학', '0-1 과학', '123-4 과학'])('%s → 반 없음', (text) => {
    const p = parseSlot(text);
    expect(p.cls).toBe('');
    expect(p.grade).toBe('');
  });

  it('반이 없으면 과목은 글 전체를 정리한 것', () => {
    expect(parseSlot('  과학   실험 ').subject).toBe('과학 실험');
  });

  it('1-2차시처럼 숫자 뒤에 글자가 붙어도 반으로 읽는다 (시간표 칸에는 차시를 쓰지 않는다)', () => {
    expect(parseSlot('1-2차시')).toMatchObject({ cls: '1-2', subject: '차시' });
  });
});

describe('formatSlot · normalizeSlotText', () => {
  it('반과 과목을 한 칸 띄어 붙인다', () => {
    expect(formatSlot('5-2', '과학')).toBe('5-2 과학');
    expect(formatSlot('5-2', '')).toBe('5-2');
    expect(formatSlot('', ' 과학 ')).toBe('과학');
  });

  it('반을 찾으면 한 모양으로, 못 찾으면 trim만', () => {
    expect(normalizeSlotText('5학년 2반 과학')).toBe('5-2 과학');
    expect(normalizeSlotText('5 - 3 과학')).toBe('5-3 과학');
    expect(normalizeSlotText('5학년4반 과학')).toBe('5-4 과학');
    expect(normalizeSlotText('5-1과학')).toBe('5-1 과학');
    expect(normalizeSlotText('  창체  ')).toBe('창체');
    expect(normalizeSlotText('과학  실험')).toBe('과학  실험'); // 반이 없으면 가운데는 손대지 않는다
    expect(normalizeSlotText('')).toBe('');
  });

  it('이미 정규화된 글은 그대로', () => {
    expect(normalizeSlotText('5-2 과학')).toBe('5-2 과학');
  });
});

describe('classLabelOf · classesForYear', () => {
  it('학년·반을 숫자로 맞춘다', () => {
    expect(classLabelOf({ grade: '05', classNum: ' 2 ' })).toBe('5-2');
    expect(classLabelOf({ grade: 5, classNum: 10 })).toBe('5-10');
  });

  it('그 학년도만, 학년·반 숫자 차례로 (5-10은 5-9 뒤)', () => {
    const list = [
      roster(2026, '5', '10'),
      roster(2026, '5', '9'),
      roster(2025, '5', '1'), // 다른 학년도
      roster(2026, '6', '1'),
      roster(2026, '5', '2'),
      roster(2026, '', ''), // 학년·반이 비었다
    ];
    expect(classesForYear(list, 2026).map((c) => c.label)).toEqual(['5-2', '5-9', '5-10', '6-1']);
  });

  it('같은 반이 둘이면 앞의 것 하나', () => {
    const a = roster(2026, '5', '2');
    const b = roster(2026, '05', '02');
    const out = classesForYear([a, b], 2026);
    expect(out).toHaveLength(1);
    expect(out[0].roster).toBe(a);
  });
});

describe('slotSuggestions', () => {
  it('반 × 과목', () => {
    expect(slotSuggestions(['5-1', '5-2'], ['과학', '실과'])).toEqual(['5-1 과학', '5-1 실과', '5-2 과학', '5-2 실과']);
  });

  it('과목이 없으면 반만', () => {
    expect(slotSuggestions(['5-1', '5-2'], [])).toEqual(['5-1', '5-2']);
    expect(slotSuggestions(['5-1'], ['  ', ''])).toEqual(['5-1']);
  });
});

describe('rosterForSlot', () => {
  const list = [roster(2026, '5', '1'), roster(2026, '5', '2'), roster(2025, '5', '3')];

  it('칸 글자의 반에 맞는 명렬표', () => {
    expect(rosterForSlot(list, '5학년 2반 과학', 2026)).toBe(list[1]);
  });

  it('반이 없거나, 명렬표에 없거나, 다른 학년도면 null', () => {
    expect(rosterForSlot(list, '과학', 2026)).toBeNull();
    expect(rosterForSlot(list, '5-4 과학', 2026)).toBeNull();
    expect(rosterForSlot(list, '5-3 과학', 2026)).toBeNull();
  });
});

describe('classColor (S3)', () => {
  const labels = ['5-1', '5-2', '5-3', '5-4', '5-5', '5-6', '5-7', '5-8', '5-9'];

  it('정한 색이 없으면 반 차례로 8색을 돌려쓴다', () => {
    expect(classColor('5-1', {}, labels).name).toBe('sky');
    expect(classColor('5-2', {}, labels).name).toBe('emerald');
    expect(classColor('5-8', {}, labels).name).toBe('indigo');
    expect(classColor('5-9', {}, labels).name).toBe('sky');
  });

  it('정한 색이 차례 색보다 앞선다', () => {
    expect(classColor('5-1', { '5-1': 'rose' }, labels).name).toBe('rose');
    expect(classColor('5-2', { '5-1': 'rose' }, labels).name).toBe('emerald');
  });

  it('모르는 색 이름은 정하지 않은 것으로 본다', () => {
    expect(classColor('5-2', { '5-2': '#ff0000' }, labels).name).toBe('emerald');
  });

  it('명렬표에 없는 반도 늘 같은 색', () => {
    const a = classColor('6-3', {}, labels);
    expect(CLASS_COLORS).toContain(a);
    expect(classColor('6-3', {}, labels)).toBe(a);
  });

  it('클래스는 통째로 적혀 있다 (Tailwind가 만들게)', () => {
    for (const c of CLASS_COLORS) {
      expect(c.bar).toBe(`border-l-${c.name}-500`);
      expect(c.chip).toBe(`bg-${c.name}-100 text-${c.name}-800`);
      expect(c.dot).toBe(`bg-${c.name}-500`);
    }
  });
});

describe('지난 시간 (S5)', () => {
  const subjects = {
    '2026-11-02': { '1': '5-1 과학', '3': '5-2과학' },
    '2026-11-04': { '1': '5학년 2반 과학', '2': '5-1 과학', '4': '5-2 과학' },
    '2026-11-06': { '1': '5-1 과학', '2': '5-2 과학' },
    '2026-11-09': { '3': '5-2 과학' },
  };

  it('같은 날 앞 교시도 본다, 칸 글자는 정규화해 견준다', () => {
    expect(previousSlotOf(subjects, '5-2 과학', '2026-11-04', 4)).toEqual({ date: '2026-11-04', period: '1' });
    expect(previousSlotOf(subjects, '5-2 과학', '2026-11-04', 1)).toEqual({ date: '2026-11-02', period: '3' });
  });

  it('주말을 건너 앞 주 금요일, 처음이면 null', () => {
    expect(previousSlotOf(subjects, '5-2 과학', '2026-11-09', 3)).toEqual({ date: '2026-11-06', period: '2' });
    expect(previousSlotOf(subjects, '5-1 과학', '2026-11-02', 1)).toBeNull();
    expect(previousSlotOf(subjects, '', '2026-11-09', 3)).toBeNull();
  });

  it('수업이 없는 날은 건너뛴다', () => {
    expect(previousSlotOf(subjects, '5-2 과학', '2026-11-09', 3, (d) => d === '2026-11-06')).toEqual({
      date: '2026-11-04',
      period: '4',
    });
  });
});
