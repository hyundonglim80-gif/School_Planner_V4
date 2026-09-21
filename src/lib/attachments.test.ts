import { describe, it, expect } from 'vitest';
import { isImageAttachment, collectImages, collectFiles, hasAnyAttachment } from './attachments';

// 일정·수업·기록·메모가 모두 같은 모양으로 붙임을 들고 있다. 가려내는 규칙이
// 화면마다 따로 적혀 있으면 한 곳만 고치고 나머지를 잊는다. 여기에 모아 둔다.
const srcOf = (a: { url?: string }) => a.url || '';

describe('그림인지 가리기', () => {
  it('type이 image면 그림이다', () => {
    expect(isImageAttachment({ type: 'image', url: 'https://x/a' })).toBe(true);
  });

  it('메모가 적는 MIME도 그림으로 본다', () => {
    expect(isImageAttachment({ type: 'image/png', url: 'u' })).toBe(true);
  });

  it('type이 없어도 확장자를 보고 가린다 (옛 자료)', () => {
    expect(isImageAttachment({ url: 'https://x/a.PNG' })).toBe(true);
    expect(isImageAttachment({ url: 'https://x/a.jpeg?v=2' })).toBe(true);
    expect(isImageAttachment({ url: 'https://x/a.pdf' })).toBe(false);
  });

  it('드라이브 주소에는 확장자가 없다. 파일 이름 쪽을 본다.', () => {
    const drive = { name: '칠판.jpg', url: 'https://drive.google.com/file/d/abc/view' };
    expect(isImageAttachment(drive)).toBe(true);
    expect(isImageAttachment({ ...drive, name: '안내.pdf' })).toBe(false);
  });

  it('없는 것은 그림이 아니다', () => {
    expect(isImageAttachment(null)).toBe(false);
    expect(isImageAttachment({})).toBe(false);
  });
});

describe('그림 모으기', () => {
  it('붙임 목록의 그림을 차례대로 모은다', () => {
    const item = {
      attachments: [
        { name: '칠판.png', url: 'u1', type: 'image' },
        { name: '안내.pdf', url: 'u2', type: 'file' },
        { name: '활동.jpg', url: 'u3' },
      ],
    };
    expect(collectImages(item, srcOf)).toEqual([
      { url: 'u1', name: '칠판.png' },
      { url: 'u3', name: '활동.jpg' },
    ]);
  });

  it('붙임 목록이 생기기 전의 imageUrl도 본다', () => {
    expect(collectImages({ imageUrl: 'old' }, srcOf)).toEqual([{ url: 'old', name: '첨부 이미지' }]);
  });

  it('같은 그림이 두 자리에 적혀 있으면 한 번만 센다', () => {
    const item = { imageUrl: 'u1', attachments: [{ name: '칠판.png', url: 'u1', type: 'image' }] };
    expect(collectImages(item, srcOf)).toHaveLength(1);
  });

  it('없으면 빈 목록이다', () => {
    expect(collectImages(null, srcOf)).toEqual([]);
    expect(collectImages({}, srcOf)).toEqual([]);
  });
});

describe('그림 아닌 파일 모으기', () => {
  it('그림은 빼고 남긴다', () => {
    const item = {
      attachments: [
        { name: '칠판.png', url: 'u1', type: 'image' },
        { name: '안내.pdf', url: 'u2', type: 'file' },
      ],
    };
    expect(collectFiles(item).map((a) => a.name)).toEqual(['안내.pdf']);
  });

  it('붙임이 하나라도 있는지 가린다', () => {
    expect(hasAnyAttachment({ imageUrl: 'u' })).toBe(true);
    expect(hasAnyAttachment({ attachments: [{ name: 'a', url: 'u' }] })).toBe(true);
    expect(hasAnyAttachment({ attachments: [] })).toBe(false);
    expect(hasAnyAttachment(null)).toBe(false);
  });
});
