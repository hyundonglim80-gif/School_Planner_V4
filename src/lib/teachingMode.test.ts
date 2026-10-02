import { describe, it, expect } from 'vitest';
import { DEFAULT_TEACHING_MODE, cleanSubjects, presetOf, presetPatch, sanitizeTeachingMode, type TeacherPreset } from './teachingMode';

describe('교사 유형 - 고쳐 읽기', () => {
  it('빈 값·이상한 값은 기본값(초등 담임)', () => {
    for (const raw of [undefined, null, 3, 'x', [], {}]) {
      expect(sanitizeTeachingMode(raw)).toEqual(DEFAULT_TEACHING_MODE);
    }
    expect(
      sanitizeTeachingMode({ unit: 'weird', hasHomeroom: 'yes', homeroomClass: '5반', subjects: 'x', classColors: [1] })
    ).toEqual(DEFAULT_TEACHING_MODE);
  });

  it('제대로 된 값은 그대로, 다듬을 것은 다듬는다', () => {
    expect(
      sanitizeTeachingMode({
        unit: 'class',
        hasHomeroom: false,
        homeroomClass: ' 5-2 ',
        subjects: [' 과학 ', '', '과학', 3, '실과'],
        classColors: { '5-1': 'red', 반: 'blue', '5-3': 1 },
        updatedAt: 10,
      })
    ).toEqual({ unit: 'class', hasHomeroom: false, homeroomClass: '5-2', subjects: ['과학', '실과'], classColors: { '5-1': 'red' }, updatedAt: 10 });
  });

  it('과목 다듬기', () => {
    expect(cleanSubjects(null)).toEqual([]);
    expect(cleanSubjects(['a', ' a', 'b '])).toEqual(['a', 'b']);
  });
});

describe('교사 유형 - 셋 ↔ 두 값', () => {
  it('셋 모두 왕복한다', () => {
    for (const p of ['homeroom', 'subject', 'subjectHomeroom'] as TeacherPreset[]) {
      expect(presetOf(presetPatch(p))).toBe(p);
    }
  });

  it('두 값', () => {
    expect(presetPatch('homeroom')).toEqual({ unit: 'subject', hasHomeroom: true });
    expect(presetPatch('subject')).toEqual({ unit: 'class', hasHomeroom: false });
    expect(presetPatch('subjectHomeroom')).toEqual({ unit: 'class', hasHomeroom: true });
  });

  it('과목 단위는 담임반이 없어도 초등 담임', () => {
    expect(presetOf({ unit: 'subject', hasHomeroom: false })).toBe('homeroom');
  });
});
