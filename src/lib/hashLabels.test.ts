import { describe, it, expect } from 'vitest';
import { takeTrailingHashLabels } from './hashLabels';

describe('takeTrailingHashLabels', () => {
  it('마지막 줄의 #이름 여럿 → 라벨, 줄은 지운다', () => {
    expect(takeTrailingHashLabels('회의 내용\n#111 #555')).toEqual({ text: '회의 내용', names: ['111', '555'] });
  });
  it('중복은 하나로, 끝 문장 부호는 뗀다', () => {
    expect(takeTrailingHashLabels('글\n#업무, #업무 #회의.')).toEqual({ text: '글', names: ['업무', '회의'] });
  });
  it('빈 줄 뒤에 있어도, 뒤의 빈 줄도 본다', () => {
    expect(takeTrailingHashLabels('글\n\n#업무\n\n')).toEqual({ text: '글', names: ['업무'] });
  });
  it('학생 태그는 그 줄에 남긴다', () => {
    expect(takeTrailingHashLabels('상담\n#상담 #26040305')).toEqual({ text: '상담\n#26040305', names: ['상담'] });
  });
  it('학생 태그뿐이면 그대로', () => {
    expect(takeTrailingHashLabels('상담\n#26040305')).toEqual({ text: '상담\n#26040305', names: [] });
  });
  it('줄 중간의 #은 라벨이 아니다', () => {
    expect(takeTrailingHashLabels('글\n오늘 #회의 했다')).toEqual({ text: '글\n오늘 #회의 했다', names: [] });
  });
  it("'#'만 있으면 그대로", () => {
    expect(takeTrailingHashLabels('글\n#')).toEqual({ text: '글\n#', names: [] });
    expect(takeTrailingHashLabels('글\n#a #')).toEqual({ text: '글\n#a #', names: [] });
  });
  it('글이 그 줄 하나뿐이면 그대로', () => {
    expect(takeTrailingHashLabels('#업무')).toEqual({ text: '#업무', names: [] });
  });
  it('20자까지', () => {
    const r = takeTrailingHashLabels(`글\n#${'가'.repeat(25)}`);
    expect(r.names[0]).toHaveLength(20);
  });
  it('들여쓴 줄도', () => {
    expect(takeTrailingHashLabels('글\n  #a   #b  ')).toEqual({ text: '글', names: ['a', 'b'] });
  });
  it('빈 글', () => {
    expect(takeTrailingHashLabels('')).toEqual({ text: '', names: [] });
  });
});
