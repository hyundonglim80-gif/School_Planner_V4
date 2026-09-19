import { describe, it, expect } from 'vitest';
import { fitWithin, withExtension, formatBytes, MAX_EDGE } from './imageShrink';

describe('fitWithin', () => {
  it('긴 변을 기준으로 줄인다 (가로가 긴 사진)', () => {
    expect(fitWithin(4000, 3000, 1000)).toEqual({ width: 1000, height: 750 });
  });

  it('세로가 긴 사진도 긴 변을 기준으로', () => {
    expect(fitWithin(3000, 4000, 1000)).toEqual({ width: 750, height: 1000 });
  });

  it('비율을 지킨다', () => {
    const { width, height } = fitWithin(4032, 3024, 1000);
    expect(width / height).toBeCloseTo(4032 / 3024, 2);
  });

  it('이미 작은 사진은 키우지 않는다', () => {
    // 키워 봐야 없던 화질이 생기지 않고 용량만 는다
    expect(fitWithin(400, 500, 1000)).toEqual({ width: 400, height: 500 });
  });

  it('딱 맞는 크기는 그대로 둔다', () => {
    expect(fitWithin(1000, 800, 1000)).toEqual({ width: 1000, height: 800 });
  });

  it('아주 납작한 사진도 한 픽셀 밑으로 내려가지 않는다', () => {
    expect(fitWithin(10000, 3, 1000).height).toBeGreaterThanOrEqual(1);
  });

  it('말이 안 되는 크기는 0으로', () => {
    expect(fitWithin(0, 100)).toEqual({ width: 0, height: 0 });
    expect(fitWithin(-5, 100)).toEqual({ width: 0, height: 0 });
  });

  it('기본 한도는 1000px', () => {
    expect(MAX_EDGE).toBe(1000);
    expect(fitWithin(2000, 2000).width).toBe(1000);
  });
});

describe('withExtension', () => {
  it('확장자를 바꾼다', () => {
    expect(withExtension('2026-3-1-05-홍길동.png', 'image/webp')).toBe('2026-3-1-05-홍길동.webp');
    expect(withExtension('IMG_0421.JPG', 'image/jpeg')).toBe('IMG_0421.jpg');
  });

  it('확장자가 없으면 붙인다', () => {
    expect(withExtension('홍길동', 'image/webp')).toBe('홍길동.webp');
  });

  it('이름 가운데 점이 있어도 마지막 것만 바꾼다', () => {
    expect(withExtension('2026.3.1-홍길동.png', 'image/webp')).toBe('2026.3.1-홍길동.webp');
  });
});

describe('formatBytes', () => {
  it('사람이 읽을 크기로 적는다', () => {
    expect(formatBytes(512)).toBe('512B');
    expect(formatBytes(2048)).toBe('2KB');
    expect(formatBytes(3.2 * 1024 * 1024)).toBe('3.2MB');
  });
});
