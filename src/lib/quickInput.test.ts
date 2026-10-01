import { describe, expect, it } from 'vitest';
import { parseQuickInput, stripMatch } from './quickInput';

// 2026-10-02는 금요일
const BASE = '2026-10-02';
const p = (text: string, labels: string[] = []) => parseQuickInput(text, BASE, labels);

describe('날짜', () => {
  it('오늘·내일·모레·글피', () => {
    expect(p('내일 교직원 회의').date?.date).toBe('2026-10-03');
    expect(p('모레 출장').date?.date).toBe('2026-10-04');
    expect(p('글피').date?.date).toBe('2026-10-05');
    expect(p('오늘 안에').date?.date).toBe('2026-10-02');
  });

  it('이번·다음·다다음 주 요일 (월요일 시작 주)', () => {
    expect(p('다음 주 화 학년 협의회').date).toEqual({ date: '2026-10-06', match: { start: 0, end: 6, text: '다음 주 화' } });
    expect(p('다음주 화요일').date?.date).toBe('2026-10-06');
    expect(p('이번 주 수').date?.date).toBe('2026-09-30');
    expect(p('다다음 주 월').date?.date).toBe('2026-10-12');
  });

  it('요일만: 오늘이나 그 뒤의 첫 그 요일, 낱말 속 글자는 아니다', () => {
    expect(p('화요일 회의').date?.date).toBe('2026-10-06');
    expect(p('금요일 회의').date?.date).toBe('2026-10-02');
    expect(p('대화요일').date).toBeUndefined();
  });

  it('10/15 · 10월 15일 · 2026-10-15, 지난 지 두 달이 넘으면 내년', () => {
    expect(p('10/15 학부모 상담').date?.date).toBe('2026-10-15');
    expect(p('10월 15일').date?.date).toBe('2026-10-15');
    expect(p('2027.3.2 개학').date?.date).toBe('2027-03-02');
    expect(p('1/5 방학식').date?.date).toBe('2027-01-05');
    expect(p('9/20 정리').date?.date).toBe('2026-09-20');
    expect(p('2/30').date).toBeUndefined();
  });

  it('(1/3) 기간 표시·분수는 날짜가 아니다', () => {
    expect(p('기말고사 (1/3)').date).toBeUndefined();
  });

  it('N일·N주 뒤', () => {
    expect(p('3일 뒤 제출').date?.date).toBe('2026-10-05');
    expect(p('2주 후 평가').date?.date).toBe('2026-10-16');
  });
});

describe('기한 (…까지)', () => {
  it('날짜 말 + 까지는 기한, 다른 날짜는 날짜로', () => {
    const r = p('내일 보고서 작성 10/15까지 제출');
    expect(r.date?.date).toBe('2026-10-03');
    expect(r.due).toEqual({ date: '2026-10-15', match: { start: 10, end: 17, text: '10/15까지' } });
    expect(p('금요일 까지').due?.date).toBe('2026-10-02');
  });
});

describe('시각', () => {
  it('15:00 · 오후 3시 · 3시 반 · 오전 9시 20분', () => {
    expect(p('회의 15:00').time).toEqual({ hhmm: '15:00', match: { start: 3, end: 8, text: '15:00' } });
    expect(p('오후 3시 회의').time?.hhmm).toBe('15:00');
    expect(p('3시 반 상담').time?.hhmm).toBe('15:30');
    expect(p('오전 9시 20분').time?.hhmm).toBe('09:20');
    expect(p('9시 등교').time?.hhmm).toBe('09:00');
  });
  it('1시간·3교시·1:1은 시각이 아니다', () => {
    expect(p('1시간 연수').time).toBeUndefined();
    expect(p('3교시 공개수업').time).toBeUndefined();
    expect(p('1:1 상담').time).toBeUndefined();
  });
});

describe('라벨', () => {
  it('있는 라벨 이름만, 긴 이름 먼저, 낱말 중간은 아니다', () => {
    const labels = ['공문', '공문 처리', '회의'];
    expect(p('#공문 처리 보고', labels).labels.map((l) => l.name)).toEqual(['공문 처리']);
    expect(p('출장 #공문 #회의', labels).labels.map((l) => l.name)).toEqual(['공문', '회의']);
    expect(p('#공문서 정리', labels).labels).toEqual([]);
    expect(p('#없는라벨', labels).labels).toEqual([]);
  });
});

describe('반복', () => {
  it('매주·격주 요일, 쉼표·붙여 쓰기', () => {
    expect(p('매주 화 학년 협의회').recur).toEqual({ days: [2], biweekly: false, match: { start: 0, end: 4, text: '매주 화' } });
    expect(p('매주 월,수 아침 독서').recur?.days).toEqual([1, 3]);
    expect(p('매주 월수금 보충').recur?.days).toEqual([1, 3, 5]);
    expect(p('격주 금요일 동아리').recur).toMatchObject({ days: [5], biweekly: true });
  });
  it('요일 글자로 시작하는 낱말은 아니다 (매주 수업), 반복 안의 요일은 날짜로 보지 않는다', () => {
    expect(p('매주 수업 준비').recur).toBeUndefined();
    expect(p('매주 화 수업').recur?.days).toEqual([2]);
    expect(p('매주 화요일 회의').date).toBeUndefined();
  });
});

describe('stripMatch', () => {
  it('알아본 말을 빼고 빈칸을 다듬는다', () => {
    const text = '다음 주 화 학년 협의회';
    const r = p(text);
    expect(stripMatch(text, r.date!.match)).toBe('학년 협의회');
    const t2 = '보고서 10/15까지 제출';
    expect(stripMatch(t2, p(t2).due!.match)).toBe('보고서 제출');
    expect(stripMatch('회의\n내일 준비물', { start: 3, end: 5, text: '내일' })).toBe('회의\n준비물');
  });
  it('글이 바뀌었으면 그대로', () => {
    expect(stripMatch('내일 회의', { start: 0, end: 2, text: '모레' })).toBe('내일 회의');
  });
});
