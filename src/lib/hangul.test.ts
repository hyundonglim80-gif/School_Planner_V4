import { describe, it, expect } from 'vitest';
import { toChoseong, isChoseongQuery, matchesName, matchRange } from './hangul';

describe('toChoseong', () => {
  it('음절을 초성으로 바꾼다', () => {
    expect(toChoseong('김지우')).toBe('ㄱㅈㅇ');
    expect(toChoseong('배유나')).toBe('ㅂㅇㄴ');
    expect(toChoseong('황지후')).toBe('ㅎㅈㅎ');
  });

  it('받침이 있어도 초성만 뽑는다', () => {
    expect(toChoseong('강민준')).toBe('ㄱㅁㅈ');
    expect(toChoseong('권서연')).toBe('ㄱㅅㅇ');
  });

  it('겹자음으로 시작하는 음절도 뽑는다', () => {
    expect(toChoseong('빵')).toBe('ㅃ');
    expect(toChoseong('짱구')).toBe('ㅉㄱ');
  });

  it('한글이 아닌 글자는 그대로 둔다', () => {
    expect(toChoseong('John')).toBe('John');
    expect(toChoseong('김A우')).toBe('ㄱAㅇ');
  });
});

describe('isChoseongQuery', () => {
  it('자음만 쳤으면 참', () => {
    expect(isChoseongQuery('ㄱㅈㅇ')).toBe(true);
    expect(isChoseongQuery('ㅎ')).toBe(true);
  });

  it('완성된 음절이 섞이면 거짓', () => {
    expect(isChoseongQuery('김ㅈ')).toBe(false);
    expect(isChoseongQuery('김지우')).toBe(false);
  });

  it('모음만 친 것은 초성 검색이 아니다', () => {
    expect(isChoseongQuery('ㅏㅗ')).toBe(false);
  });

  it('빈 값은 거짓', () => {
    expect(isChoseongQuery('')).toBe(false);
    expect(isChoseongQuery('   ')).toBe(false);
  });
});

describe('matchesName', () => {
  it('초성으로 찾는다', () => {
    expect(matchesName('김지우', 'ㄱㅈ')).toBe(true);
    expect(matchesName('강지원', 'ㄱㅈ')).toBe(true);
    expect(matchesName('배유나', 'ㄱㅈ')).toBe(false);
  });

  it('초성이 이름 가운데에 있어도 찾는다', () => {
    expect(matchesName('김지우', 'ㅈㅇ')).toBe(true);
  });

  it('이름 글자로도 찾는다', () => {
    expect(matchesName('김지우', '지우')).toBe(true);
    expect(matchesName('김지우', '김')).toBe(true);
    expect(matchesName('김지우', '하늘')).toBe(false);
  });

  it('겹자음과 홑자음을 같은 것으로 본다', () => {
    expect(matchesName('짱구', 'ㅈ')).toBe(true);
    expect(matchesName('장구', 'ㅉ')).toBe(true);
  });

  it('빈 검색어는 모두 맞는 것으로 본다', () => {
    expect(matchesName('김지우', '')).toBe(true);
  });

  it('이름이 비어 있으면 (빈 검색어가 아닌 한) 맞지 않는다', () => {
    expect(matchesName('', 'ㄱ')).toBe(false);
  });

  it('사이 공백은 무시한다', () => {
    expect(matchesName('김 지 우', 'ㄱㅈㅇ')).toBe(true);
    expect(matchesName('김지우', 'ㄱ ㅈ')).toBe(true);
  });
});

describe('matchRange', () => {
  it('초성이 맞은 자리를 음절 자리로 돌려준다', () => {
    expect(matchRange('김지우', 'ㄱㅈ')).toEqual({ start: 0, end: 2 });
    expect(matchRange('김지우', 'ㅈㅇ')).toEqual({ start: 1, end: 3 });
  });

  it('글자로 찾았을 때의 자리', () => {
    expect(matchRange('김지우', '지우')).toEqual({ start: 1, end: 3 });
  });

  it('맞는 자리가 없으면 null', () => {
    expect(matchRange('김지우', 'ㅎ')).toBeNull();
    expect(matchRange('김지우', '')).toBeNull();
  });
});
