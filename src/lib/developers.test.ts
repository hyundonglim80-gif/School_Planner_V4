import { describe, it, expect } from 'vitest';
import { DEVELOPER_EMAILS, isDeveloper } from './developers';

describe('isDeveloper', () => {
  it('등록된 세 계정만 개발자다', () => {
    expect(DEVELOPER_EMAILS).toHaveLength(3);
    for (const email of DEVELOPER_EMAILS) expect(isDeveloper(email)).toBe(true);
  });

  it('대소문자와 앞뒤 공백은 무시한다 (구글 로그인 표기가 흔들려도 같게 본다)', () => {
    expect(isDeveloper('  HyunDongLim80@Gmail.com ')).toBe(true);
  });

  it('그 외 계정은 개발자가 아니다', () => {
    expect(isDeveloper('teacher@school.kr')).toBe(false);
    expect(isDeveloper('hyundonglim80@gmail.com.evil.kr')).toBe(false);
    expect(isDeveloper('')).toBe(false);
    expect(isDeveloper(null)).toBe(false);
    expect(isDeveloper(undefined)).toBe(false);
  });
});
