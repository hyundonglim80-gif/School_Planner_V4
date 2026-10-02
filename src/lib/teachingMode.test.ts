import { describe, it, expect } from 'vitest';
import { DEFAULT_TEACHING_MODE, presetOf, presetPatch, sanitizeTeachingMode, type TeacherPreset } from './teachingMode';

describe('sanitizeTeachingMode', () => {
  it('빈 값·이상한 값은 기본값(초등 담임)', () => {
    for (const raw of [null, undefined, 3, 'x', [], {}]) {
      expect(sanitizeTeachingMode(raw)).toEqual(DEFAULT_TEACHING_MODE);
    }
    expect(
      sanitizeTeachingMode({ unit: 'weird', hasHomeroom: 'yes', homeroomClass: 5, subjects: 'math', classColors: ['red'] })
    ).toEqual(DEFAULT_TEACHING_MODE);
  });

  it('바른 값은 그대로, 과목은 공백·빈 값·겹침을 뺀다', () => {
    expect(
      sanitizeTeachingMode({
        unit: 'class',
        hasHomeroom: false,
        homeroomClass: ' 5-2 ',
        subjects: [' 과학', '과학', '', 3, '수학'],
        classColors: { '5-1': 'red', '5-2': 7 },
        updatedAt: 10,
      })
    ).toEqual({ unit: 'class', hasHomeroom: false, homeroomClass: '5-2', subjects: ['과학', '수학'], classColors: { '5-1': 'red' }, updatedAt: 10 });
  });
});

describe('presetOf / presetPatch', () => {
  it('셋이 왕복한다', () => {
    for (const p of ['homeroom', 'subject', 'subjectHomeroom'] as TeacherPreset[]) {
      expect(presetOf(presetPatch(p))).toBe(p);
    }
  });

  it('과목 단위면 담임반이 없어도 초등 담임', () => {
    expect(presetOf({ unit: 'subject', hasHomeroom: false })).toBe('homeroom');
  });

  it('저장 값', () => {
    expect(presetPatch('homeroom')).toEqual({ unit: 'subject', hasHomeroom: true });
    expect(presetPatch('subject')).toEqual({ unit: 'class', hasHomeroom: false });
    expect(presetPatch('subjectHomeroom')).toEqual({ unit: 'class', hasHomeroom: true });
  });
});
