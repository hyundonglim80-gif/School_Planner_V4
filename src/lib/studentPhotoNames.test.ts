import { describe, it, expect } from 'vitest';
import {
  classFolderName,
  photoBaseName,
  photoFileName,
  isPhotoFile,
  findPhotoFor,
  matchClassPhotos,
} from './studentPhotoNames';

const cls = { year: 2026, grade: '3', classNum: '2' };

describe('이름 만들기', () => {
  it('학급 폴더 이름', () => {
    expect(classFolderName(cls)).toBe('2026-3-2');
  });

  it('사진 파일의 기본 이름에 번호가 두 자리로 들어간다', () => {
    // 두 자리로 적어야 드라이브 파일 목록이 번호 차례로 정렬된다
    expect(photoBaseName(cls, 8, '배유나')).toBe('2026-3-2-08-배유나');
    expect(photoBaseName(cls, 23, '최지우')).toBe('2026-3-2-23-최지우');
  });

  it('올릴 때는 원본 확장자를 따른다', () => {
    expect(photoFileName(cls, 8, '배유나', 'IMG_0421.JPG')).toBe('2026-3-2-08-배유나.jpg');
    expect(photoFileName(cls, 8, '배유나', 'x.webp')).toBe('2026-3-2-08-배유나.webp');
  });

  it('모르는 확장자는 png로 둔다', () => {
    expect(photoFileName(cls, 8, '배유나', 'scan.heic')).toBe('2026-3-2-08-배유나.png');
    expect(photoFileName(cls, 8, '배유나', '확장자없음')).toBe('2026-3-2-08-배유나.png');
  });
});

describe('isPhotoFile', () => {
  it('네 가지 확장자를 모두 받아들인다', () => {
    expect(isPhotoFile('a.png')).toBe(true);
    expect(isPhotoFile('a.jpg')).toBe(true);
    expect(isPhotoFile('a.JPEG')).toBe(true);
    expect(isPhotoFile('a.webp')).toBe(true);
  });

  it('사진이 아닌 것은 거른다', () => {
    expect(isPhotoFile('명단.csv')).toBe(false);
    expect(isPhotoFile('폴더')).toBe(false);
  });
});

describe('findPhotoFor', () => {
  it('번호가 두 자리로 적힌 사진을 찾는다', () => {
    const files = [
      { id: 'a', name: '2026-3-2-07-박서진.png' },
      { id: 'b', name: '2026-3-2-08-배유나.png' },
    ];
    expect(findPhotoFor(files, cls, 8, '배유나')).toEqual({
      id: 'b',
      name: '2026-3-2-08-배유나.png',
      exact: true,
    });
  });

  it('번호가 한 자리로 적혀 있어도 찾는다', () => {
    const files = [{ id: 'b', name: '2026-3-2-8-배유나.png' }];
    expect(findPhotoFor(files, cls, 8, '배유나')?.exact).toBe(true);
  });

  it('번호가 밀렸어도 이름만으로 되찾는다', () => {
    // 전입생이 들어와 배유나가 8번 -> 9번이 되었는데 파일은 아직 8번이다.
    // 번호 없는 이름으로 올려 둔 옛 사진이 그 구실을 한다.
    const files = [{ id: 'b', name: '2026-3-2-배유나.jpg' }];
    expect(findPhotoFor(files, cls, 9, '배유나')).toEqual({
      id: 'b',
      name: '2026-3-2-배유나.jpg',
      exact: false,
    });
  });

  it('번호가 맞는 것이 있으면 그것을 먼저 고른다', () => {
    const files = [
      { id: 'old', name: '2026-3-2-배유나.png' },
      { id: 'new', name: '2026-3-2-09-배유나.png' },
    ];
    expect(findPhotoFor(files, cls, 9, '배유나')?.id).toBe('new');
  });

  it('확장자만 다른 사진이 여럿이면 늘 같은 것을 고른다', () => {
    const files = [
      { id: 'j', name: '2026-3-2-08-배유나.jpg' },
      { id: 'p', name: '2026-3-2-08-배유나.png' },
    ];
    expect(findPhotoFor(files, cls, 8, '배유나')?.id).toBe('p');
    // 차례를 뒤집어 넣어도 같은 답이 나와야 한다
    expect(findPhotoFor([...files].reverse(), cls, 8, '배유나')?.id).toBe('p');
  });

  it('파일 이름에 공백이 섞여 있어도 찾는다', () => {
    const files = [{ id: 'b', name: '2026-3-2-08-배 유나.png' }];
    expect(findPhotoFor(files, cls, 8, '배유나')?.id).toBe('b');
  });

  it('다른 학급의 사진은 고르지 않는다', () => {
    const files = [{ id: 'x', name: '2026-3-1-08-배유나.png' }];
    expect(findPhotoFor(files, cls, 8, '배유나')).toBeNull();
  });

  it('이름이 비어 있으면 아무것도 고르지 않는다', () => {
    const files = [{ id: 'x', name: '2026-3-2-08-.png' }];
    expect(findPhotoFor(files, cls, 8, '')).toBeNull();
  });

  it('없으면 null', () => {
    expect(findPhotoFor([], cls, 8, '배유나')).toBeNull();
  });
});

describe('matchClassPhotos', () => {
  it('학급 전체를 번호를 열쇠로 맞춘다', () => {
    const files = [
      { id: 'a', name: '2026-3-2-01-강민준.png' },
      { id: 'b', name: '2026-3-2-배유나.jpg' },
      { id: 'c', name: '읽을 수 없는 파일.txt' },
    ];
    const got = matchClassPhotos(files, cls, [
      { num: 1, name: '강민준' },
      { num: 3, name: '김도윤' },
      { num: 8, name: '배유나' },
    ]);
    expect(got.get(1)?.id).toBe('a');
    expect(got.get(1)?.exact).toBe(true);
    expect(got.has(3)).toBe(false);
    expect(got.get(8)?.id).toBe('b');
    expect(got.get(8)?.exact).toBe(false);
  });
});
