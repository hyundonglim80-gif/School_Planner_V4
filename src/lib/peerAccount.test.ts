import { describe, it, expect } from 'vitest';
import { accountsDiffer } from './peerAccount';

// V3와 V4는 파이어베이스 앱 이름이 달라 로그인 세션이 따로 논다.
// 그래서 한 브라우저에서 서로 다른 계정으로 들어가 있을 수 있고,
// 그러면 V4는 남의 빈 서랍을 열어 '전부 사라졌다'처럼 보인다.
describe('V3와 V4의 계정이 어긋났는지', () => {
  const v3 = { uid: 'uid_work', email: 'work@example.com' };

  it('두 앱의 계정이 다르면 어긋난 것이다', () => {
    expect(accountsDiffer('uid_personal', v3)).toBe(true);
  });

  it('같은 계정이면 아무 일도 아니다', () => {
    expect(accountsDiffer('uid_work', v3)).toBe(false);
  });

  it('V3에 로그인 기록이 없으면 비교하지 않는다', () => {
    expect(accountsDiffer('uid_personal', null)).toBe(false);
  });

  it('V4가 아직 로그인 전이면 비교하지 않는다', () => {
    expect(accountsDiffer(undefined, v3)).toBe(false);
  });
});
