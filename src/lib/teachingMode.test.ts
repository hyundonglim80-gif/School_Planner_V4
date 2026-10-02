import { describe, it, expect } from 'vitest';
import {
  DEFAULT_TEACHING_MODE,
  homeroomClassOptions,
  presetOf,
  presetPatch,
  sanitizeTeachingMode,
  type TeacherPreset,
} from './teachingMode';

describe('sanitizeTeachingMode', () => {
  it('문서가 없거나 비었으면 초등 담임 기본값', () => {
    expect(sanitizeTeachingMode(null)).toEqual(DEFAULT_TEACHING_MODE);
    expect(sanitizeTeachingMode(undefined)).toEqual(DEFAULT_TEACHING_MODE);
    expect(sanitizeTeachingMode({})).toEqual(DEFAULT_TEACHING_MODE);
    expect(sanitizeTeachingMode('이상한 값')).toEqual(DEFAULT_TEACHING_MODE);
  });

  it('모르는 값은 기본값으로, 아는 값은 그대로', () => {
    const m = sanitizeTeachingMode({
      unit: 'grade',
      hasHomeroom: 'yes',
      homeroomClass: '5반',
      subjects: '과학',
      classColors: ['red'],
    });
    expect(m).toEqual(DEFAULT_TEACHING_MODE);

    const ok = sanitizeTeachingMode({
      unit: 'class',
      hasHomeroom: false,
      homeroomClass: '5-2',
      subjects: [' 과학 ', '과학', '', 3, '영어'],
      classColors: { '5-1': 'red', 반: 'blue', '5-2': 7 },
      updatedAt: 123,
    });
    expect(ok).toEqual({
      unit: 'class',
      hasHomeroom: false,
      homeroomClass: '5-2',
      subjects: ['과학', '영어'],
      classColors: { '5-1': 'red' },
      updatedAt: 123,
    });
  });
});

describe('presetOf · presetPatch', () => {
  it('셋 모두 왕복한다', () => {
    const presets: TeacherPreset[] = ['homeroom', 'subject', 'subjectHomeroom'];
    for (const p of presets) expect(presetOf(presetPatch(p))).toBe(p);
  });

  it('저장 값', () => {
    expect(presetPatch('homeroom')).toEqual({ unit: 'subject', hasHomeroom: true });
    expect(presetPatch('subject')).toEqual({ unit: 'class', hasHomeroom: false });
    expect(presetPatch('subjectHomeroom')).toEqual({ unit: 'class', hasHomeroom: true });
  });

  it("과목 단위면 담임반이 없어도 초등 담임", () => {
    expect(presetOf({ unit: 'subject', hasHomeroom: false })).toBe('homeroom');
  });
});

describe('homeroomClassOptions', () => {
  it('그 학년도의 반만 학년·반 차례로, 겹치면 하나', () => {
    const rosters = [
      { year: 2026, grade: '5', classNum: '10', students: [] },
      { year: 2026, grade: '5', classNum: '2', students: [] },
      { year: 2025, grade: '4', classNum: '1', students: [] },
      { year: 2026, grade: '3', classNum: '1', students: [] },
      { year: 2026, grade: '5', classNum: '2', students: [] },
      { year: 2026, grade: '', classNum: '1', students: [] },
    ];
    expect(homeroomClassOptions(rosters, 2026)).toEqual(['3-1', '5-2', '5-10']);
    expect(homeroomClassOptions(rosters, 2024)).toEqual([]);
  });
});
