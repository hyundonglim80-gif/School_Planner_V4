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

// '어떤 그림은 미리보기가 되고 어떤 것은 안 되는' 일이 있었다. 가리는 규칙이
// 세 군데에 따로 적혀 있었고, 복사본마다 빠진 것이 달랐다.
//   메모 카드  : type: 'image'(기록이 쓰는 모양)를 몰랐다
//   수정 배너  : 주소만 보고 이름은 안 봐서, 확장자 없는 드라이브 주소를 놓쳤다
describe('그림 가려내기 - 빠뜨렸던 경우들', () => {
  it("기록이 쓰는 type: 'image'도 그림으로 본다", () => {
    expect(isImageAttachment({ name: '사진', url: 'https://x/y', type: 'image' })).toBe(true);
  });

  it('확장자 없는 드라이브 주소는 파일 이름으로 가린다', () => {
    expect(
      isImageAttachment({
        name: '운동회.jpg',
        url: 'https://drive.google.com/file/d/abc123/view',
        type: '',
      })
    ).toBe(true);
  });

  it('heic·bmp·avif도 그림이다 (휴대폰 사진이 heic로 온다)', () => {
    for (const ext of ['heic', 'bmp', 'avif', 'webp', 'gif']) {
      expect(isImageAttachment({ name: `사진.${ext}`, url: '' })).toBe(true);
    }
  });

  it('대문자 확장자도 알아본다', () => {
    expect(isImageAttachment({ name: 'PHOTO.JPG', url: '' })).toBe(true);
  });

  it('그림이 아닌 것은 그대로 파일이다', () => {
    expect(isImageAttachment({ name: '안내문.pdf', url: 'https://x/a.pdf' })).toBe(false);
    expect(isImageAttachment({ name: '명단.xlsx', url: '', type: 'application/vnd.ms-excel' })).toBe(false);
  });
});

// 규칙이 또 복사되면 같은 사고가 되풀이된다. 한 곳에만 있도록 묶어 둔다.
describe('그림 가려내는 규칙은 한 곳에만 있다', () => {
  const sources = import.meta.glob('../{components,features,hooks}/**/*.{ts,tsx}', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  /** 그림 가리기가 아닌 다른 일로 확장자를 쓰는 곳. 왜 다른지 함께 적는다. */
  const OTHER_PURPOSE: Record<string, string> = {
    'components/KeepImportModal.tsx':
      "고른 파일 중 '메모에 딸린 것'을 가린다 - 그림뿐 아니라 소리·PDF도 받는다",
  };

  it('lib/attachments 말고는 확장자 목록을 적지 않는다', () => {
    const offenders = Object.entries(sources)
      .filter(([path]) => !path.includes('.test.'))
      .filter(([, src]) => /jpe?g\|png|png\|gif/.test(src))
      .map(([path]) => path.replace('../', ''))
      .filter((name) => !(name in OTHER_PURPOSE));

    expect(offenders, offenders.join(' / ')).toEqual([]);
  });
});
