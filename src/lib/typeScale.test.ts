import { describe, it, expect } from 'vitest';
import { BODY_TEXT, META_TEXT, SECTION_TITLE } from './typeScale';

// index.css의 @theme이 이름 있는 글자 크기를 전부 150%로 키운다. px를 직접 쓰면 그 값만
// 150%가 안 걸려서, 옆의 text-xs(18px)와 나란히 두면 글자 크기가 튄다.
// 실제로 하루(21px)와 월간(11px)의 일정 글자가 두 배 가까이 벌어져 있었다.
const sources = import.meta.glob('../{components,features}/**/*.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const entries = Object.entries(sources)
  .filter(([path]) => !path.includes('.test.'))
  .map(([path, src]) => ({ name: path.split('/').pop()!, src }));

describe('글자 크기 규칙', () => {
  it('검사할 파일을 찾았다', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it('px를 직접 쓴 글자 크기가 없다', () => {
    const offenders = entries
      .filter(({ src }) => /text-\[[0-9.]+px\]/.test(src))
      .map(({ name, src }) => `${name}: ${src.match(/text-\[[0-9.]+px\]/g)?.join(', ')}`);

    expect(offenders).toEqual([]);
  });

  it('본문은 밀도에 따라 한 단계씩만 내려간다', () => {
    // 하루(1일) > 주간(5~7일) > 월간·년간(4~6주)
    expect(BODY_TEXT.day).toBe('text-sm'); // 21px
    expect(BODY_TEXT.week).toBe('text-xs'); // 18px
    expect(BODY_TEXT.month).toBe('text-2xs'); // 16px
  });

  it('보조 정보는 본문보다 한 단계 작다', () => {
    expect(META_TEXT.day).toBe('text-xs');
    expect(META_TEXT.week).toBe('text-2xs');
    expect(META_TEXT.month).toBe('text-2xs');
  });

  it('섹션 제목은 화면과 무관하게 같다', () => {
    expect(SECTION_TITLE).toBe('text-base');
  });

  it('이름 있는 단계만 쓴다 (2xs/xs/sm/base/lg 등)', () => {
    const allowed = /^text-(2xs|xs|sm|base|lg|xl|2xl|3xl|4xl)$/;
    for (const cls of [BODY_TEXT.day, BODY_TEXT.week, BODY_TEXT.month, META_TEXT.day, META_TEXT.week, META_TEXT.month, SECTION_TITLE]) {
      expect(cls).toMatch(allowed);
    }
  });
});
