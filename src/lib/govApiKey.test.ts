import { describe, it, expect } from 'vitest';

// 키가 소스에 남아 있으면 빌드 결과물에 그대로 실려 누구나 꺼내 쓸 수 있다.
// 실제로 govApi.ts에 개발자 키가 박혀 있었고, 그 상태로 공개 저장소에 올라가 있었다.
// 키는 Firestore의 admin/config에 두고 등록된 계정만 읽는다.
const sources = import.meta.glob('../{lib,hooks,components,features,store}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

describe('공공데이터 키를 소스에 두지 않는다', () => {
  const entries = Object.entries(sources).filter(([p]) => !p.includes('.test.'));

  it('소스 파일을 여럿 찾았다', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it('공공데이터 키처럼 생긴 긴 문자열이 박혀 있지 않다', () => {
    // 서비스 키는 URL 인코딩된 base64라 %2F %2B %3D 가 섞인 긴 문자열이 된다
    const offenders = entries
      .filter(([, src]) => /['"`][A-Za-z0-9]{40,}%[0-9A-F]{2}[^'"`]*['"`]/.test(src))
      .map(([p]) => p);

    expect(offenders).toEqual([]);
  });

  it('빌드 시점에 키를 끼워 넣는 환경변수도 쓰지 않는다', () => {
    // VITE_ 로 시작하는 값은 빌드 결과물에 그대로 들어가므로 숨기는 효과가 없다
    const offenders = entries.filter(([, src]) => src.includes('VITE_GOV_API_KEY')).map(([p]) => p);

    expect(offenders).toEqual([]);
  });

  it('사용자 화면은 data.go.kr을 직접 부르지 않는다', () => {
    const offenders = entries
      .filter(([p]) => p.includes('/features/') || p.includes('/hooks/'))
      // 주석에 적힌 설명은 넘어간다. 실제 호출 주소와 govApi를 들여오는지를 본다.
      .filter(([, src]) => src.includes('apis.data.go.kr') || src.includes("lib/govApi'"))
      .map(([p]) => p);

    expect(offenders).toEqual([]);
  });
});
