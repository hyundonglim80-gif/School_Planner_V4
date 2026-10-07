import { describe, expect, it } from 'vitest';
import {
  cleanLessons,
  draftTarget,
  emptyLesson,
  insertRowAfter,
  newCourseDraft,
  newDraft,
  sameAsSaved,
  toDraft,
  withKey,
  type Draft,
} from './progressDraft';
import { sanitizePlan, type ProgressPlan } from './progress';

// 진도 관리 창의 고치는 모양 (19번 U2)

const lesson = (content: string, page = '') => ({ unit: '', no: '', content, page, supplies: '' });
const plan = (extra: Partial<ProgressPlan>): ProgressPlan => ({
  id: 'p1',
  key: '',
  startDate: '2026-09-01',
  lessons: [lesson('가'), lesson('나', '12~13')],
  bumps: [],
  ...extra,
});

describe('행 가운데 넣기', () => {
  it('그 행 바로 아래에 빈 행 (번호는 뒤가 하나씩 밀린다)', () => {
    const rows = ['가', '나', '다', '라'].map((c) => withKey(lesson(c)));
    const { lessons, at } = insertRowAfter(rows, 2);
    expect(at).toBe(3);
    expect(lessons.map((l) => l.content)).toEqual(['가', '나', '다', '', '라']);
    // 다른 행의 key는 그대로 - React가 입력 중인 칸을 새로 만들지 않는다
    expect(lessons.filter((l) => l.content).map((l) => l._k)).toEqual(rows.map((l) => l._k));
    expect(new Set(lessons.map((l) => l._k)).size).toBe(5);
  });

  it('커서가 없었으면(-1 = 맨 아래 앞 행이 없음) 맨 위, 범위를 넘으면 맨 아래', () => {
    expect(insertRowAfter([], -1).at).toBe(0);
    const rows = [withKey(lesson('가'))];
    expect(insertRowAfter(rows, 0).at).toBe(1);
    expect(insertRowAfter(rows, 9).at).toBe(1);
  });

  it('저장할 모양에는 _k가 없고 빈 행·앞뒤 빈칸은 빠진다', () => {
    const rows = [withKey(lesson(' 가 ', ' 8~9 ')), emptyLesson()];
    expect(cleanLessons(rows)).toEqual([{ unit: '', no: '', content: '가', page: '8~9', supplies: '' }]);
  });
});

describe('저장할 모양 (draftTarget)', () => {
  it('초등 담임: 과목 하나 (앞뒤 빈칸만 뗀다)', () => {
    expect(draftTarget({ ...newDraft(), key: ' 국어 ' })).toEqual({ key: '국어' });
    const d = toDraft(plan({ key: '국어' }), false);
    expect(d.classes).toBeNull();
    expect(draftTarget(d)).toEqual({ key: '국어' });
  });

  it('교과 모드 새 진도: 반이 하나여도 과정 모양 (subject·classes)', () => {
    const d: Draft = { ...newCourseDraft('과학'), classes: ['5-2'] };
    expect(draftTarget(d)).toEqual({ key: '', subject: '과학', classes: ['5-2'] });
    expect(draftTarget({ ...d, classes: ['5-1', '5-2'] })).toMatchObject({ classes: ['5-1', '5-2'] });
  });

  it("교과 모드 새 진도에 반이 없으면 반 없이 과목만 적힌 칸 ('창체')", () => {
    expect(draftTarget(newCourseDraft(' 창체 '))).toEqual({ key: '창체' });
  });

  it("교과 모드에서 연 옛 칸 글자 진도 - 과목 + 반 하나로 보이고, 그대로 두면 글자도 그대로 ('5-2과학')", () => {
    const old = plan({ key: '5-2과학' });
    const d = toDraft(old, true);
    expect(d).toMatchObject({ subject: '과학', classes: ['5-2'], legacyKey: '5-2과학' });
    expect(draftTarget(d)).toEqual({ key: '5-2과학' });
    expect(sameAsSaved(d, old)).toBe(true);
  });

  it('옛 진도의 반·과목을 바꾸면 옛 모양 새 글자, 반을 둘 이상 고르면 과정', () => {
    const d = toDraft(plan({ key: '5-2 과학' }), true);
    expect(draftTarget({ ...d, classes: ['5-3'] })).toEqual({ key: '5-3 과학' });
    expect(draftTarget({ ...d, subject: '실과' })).toEqual({ key: '5-2 실과' });
    expect(draftTarget({ ...d, classes: ['5-2', '5-3'] })).toEqual({ key: '', subject: '과학', classes: ['5-2', '5-3'] });
  });

  it("반이 없는 옛 진도 ('창체') - 과목만, 그대로 두면 그대로", () => {
    const old = plan({ key: '창체' });
    const d = toDraft(old, true);
    expect(d).toMatchObject({ subject: '창체', classes: [], legacyKey: '창체' });
    expect(sameAsSaved(d, old)).toBe(true);
  });

  it('과정은 어느 모드에서 열어도 과정', () => {
    const course = sanitizePlan('c', { subject: '과학', classes: ['5-1', '5-2'], startDate: '2026-09-01', lessons: [] });
    for (const unit of [true, false]) {
      const d = toDraft(course, unit);
      expect(d).toMatchObject({ subject: '과학', classes: ['5-1', '5-2'], legacyKey: null });
      expect(sameAsSaved(d, course)).toBe(true);
    }
  });

  it('교과서 쪽을 고치면 저장한 것과 다르다', () => {
    const old = plan({ key: '국어' });
    const d = toDraft(old, false);
    expect(sameAsSaved(d, old)).toBe(true);
    d.lessons[0] = { ...d.lessons[0], page: '30' };
    expect(sameAsSaved(d, old)).toBe(false);
  });
});

describe('저장된 교과서 쪽 읽기', () => {
  it('page를 읽고, 옛 문서(page 없음)는 빈 글자', () => {
    const p = sanitizePlan('x', { key: '국어', lessons: [{ content: '가', page: '12~15' }, { content: '나' }] });
    expect(p.lessons.map((l) => l.page)).toEqual(['12~15', '']);
  });
});
