import { describe, it, expect } from 'vitest';
import { composeSharedText, hasSharedParams, stripSharedParams } from './shareTarget';

describe('composeSharedText', () => {
  it('제목·글·주소를 줄로 잇는다', () => {
    expect(composeSharedText('기사 제목', '본문 한 줄', 'https://a.kr/1')).toBe('기사 제목\n본문 한 줄\nhttps://a.kr/1');
  });
  it('글에 이미 든 주소·제목은 다시 적지 않는다 (크롬 공유)', () => {
    expect(composeSharedText('제목', '제목 https://a.kr/1', 'https://a.kr/1')).toBe('제목 https://a.kr/1');
  });
  it('주소만 와도 된다', () => {
    expect(composeSharedText('', '', ' https://a.kr ')).toBe('https://a.kr');
  });
  it('아무것도 없으면 빈 글', () => {
    expect(composeSharedText(undefined, undefined, undefined)).toBe('');
  });
});

describe('공유 표시 주소', () => {
  it('share·text·url·title 중 하나가 있으면 공유받은 것', () => {
    expect(hasSharedParams('?share=abc')).toBe(true);
    expect(hasSharedParams('?text=hi')).toBe(true);
    expect(hasSharedParams('?as=teacher')).toBe(false);
    expect(hasSharedParams('')).toBe(false);
  });
  it('공유 표시만 지우고 다른 값은 둔다', () => {
    expect(stripSharedParams('https://x.io/School_Planner_V4/index.html?share=abc&as=t#h')).toBe(
      '/School_Planner_V4/index.html?as=t#h'
    );
    expect(stripSharedParams('https://x.io/app/index.html?text=a&url=b')).toBe('/app/index.html');
  });
});
