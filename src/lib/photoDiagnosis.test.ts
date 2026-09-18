import { describe, it, expect } from 'vitest';
import { diagnosePhotos, MANAGED_PATH } from './photoDiagnosis';
import type { PhotoScan } from './studentPhotos';

const scan = (over: Partial<PhotoScan> = {}): PhotoScan => ({
  folderId: 'f1',
  source: 'managed',
  files: [],
  subfolderNames: [],
  rootEmpty: false,
  classFolderLooksEmpty: false,
  ...over,
});

const base = { className: '2026-3-1', studentCount: 25, matchedCount: 0 };
const nothing = scan({ folderId: null, source: 'none' as const });

describe('아직 훑기 전', () => {
  it('불러오는 중이라고 한다', () => {
    const d = diagnosePhotos({ ...base, scan: null });
    expect(d.message).toContain('불러오는 중');
    expect(d.offerPickClass).toBe(false);
  });
});

describe('앱이 맡아 두는 자리만 쓰는 경우', () => {
  it('아직 아무것도 없으면 어디에 담기는지 알려 준다', () => {
    const d = diagnosePhotos({ ...base, scan: nothing });
    expect(d.tone).toBe('warn');
    expect(d.message).toContain('올린 사진이 없습니다');
    expect(d.hint).toContain(MANAGED_PATH);
    expect(d.hint).toContain('2026-3-1');
    // 드라이브에 이미 있는 사진을 쓰고 싶을 수 있으니 길은 열어 둔다
    expect(d.offerPickClass).toBe(true);
    // 옛 방식을 쓴 적이 없으므로 '위쪽 폴더'는 꺼내지 않는다
    expect(d.offerRepick).toBe(false);
  });

  it('폴더는 있는데 비었으면 권한 탓을 하지 않는다', () => {
    const d = diagnosePhotos({ ...base, scan: scan({ source: 'managed', files: [] }) });
    expect(d.tone).toBe('warn');
    expect(d.message).toContain(MANAGED_PATH);
    expect(d.hint).toBeUndefined();
  });

  it('붙은 사진 수를 센다', () => {
    const d = diagnosePhotos({
      ...base,
      matchedCount: 23,
      scan: scan({ files: [{ id: '1', name: 'a.png' }] }),
    });
    expect(d.tone).toBe('warn');
    expect(d.message).toContain('23/25명');
  });

  it('다 맞으면 다 됐다고 한다', () => {
    const d = diagnosePhotos({
      ...base,
      matchedCount: 25,
      scan: scan({ files: [{ id: '1', name: 'a.png' }] }),
    });
    expect(d.tone).toBe('ok');
    expect(d.message).toContain('모든 학생');
  });
});

describe('옛 방식으로 위쪽 폴더를 골라 둔 경우', () => {
  const legacy = { ...base, hasLegacyRoot: true };

  it('고른 폴더가 통째로 비어 보이면 권한 이야기를 한다', () => {
    const d = diagnosePhotos({
      ...legacy,
      scan: scan({ folderId: null, source: 'none', rootEmpty: true }),
    });
    expect(d.tone).toBe('error');
    expect(d.message).toContain('비어 보입니다');
    expect(d.hint).toContain('구글 권한');
    expect(d.offerPickClass).toBe(true);
    expect(d.offerRepick).toBe(true);
  });

  it('다른 폴더는 보이는데 학급 폴더만 없으면 보이는 것을 알려 준다', () => {
    const d = diagnosePhotos({
      ...legacy,
      scan: scan({ folderId: null, source: 'none', subfolderNames: ['2026-3-2', '2025-6-3'] }),
    });
    expect(d.message).toContain("'2026-3-1' 폴더가 없습니다");
    expect(d.message).toContain('2026-3-2');
  });

  it('폴더가 많으면 몇 개만 추리고 나머지는 세어 준다', () => {
    const d = diagnosePhotos({
      ...legacy,
      scan: scan({ folderId: null, source: 'none', subfolderNames: ['a', 'b', 'c', 'd', 'e'] }),
    });
    expect(d.message).toContain('a, b, c 외 2개');
  });

  it('학급 폴더는 보이는데 그 안이 비면 권한일 수 있다고 말한다', () => {
    // 실제로 여기서 막혔다. 폴더는 자식이라 보이고 사진은 손자라 안 보였다.
    const d = diagnosePhotos({ ...legacy, scan: scan({ source: 'subfolder', files: [] }) });
    expect(d.tone).toBe('error');
    expect(d.message).toContain('그 안의 사진이 보이지 않습니다');
    expect(d.hint).toContain('구글 권한');
    expect(d.offerPickClass).toBe(true);
  });

  it('직접 고른 폴더가 비었으면 무엇을 골랐는지 되비쳐 준다', () => {
    // 위쪽 폴더를 골라 놓고 왜 안 되는지 몰라 헤매는 일이 있었다
    const d = diagnosePhotos({
      ...legacy,
      pickedFolderName: 'Students_Poto',
      scan: scan({ source: 'picked', files: [] }),
    });
    expect(d.tone).toBe('error');
    expect(d.message).toContain('Students_Poto');
    expect(d.hint).toContain('2026-3-1 폴더 자체');
    expect(d.offerPickClass).toBe(true);
    // 권한 탓이 아니므로 그 이야기는 하지 않는다
    expect(d.hint).not.toContain('구글 권한');
  });
});

describe('이름이 안 맞을 때', () => {
  it('찾은 파일을 예로 들고 규칙을 알려 준다', () => {
    const d = diagnosePhotos({
      ...base,
      scan: scan({ files: [{ id: '1', name: 'IMG_001.png' }, { id: '2', name: 'IMG_002.png' }] }),
    });
    expect(d.tone).toBe('error');
    expect(d.message).toContain('2장을 찾았지만');
    expect(d.message).toContain('IMG_001.png');
    expect(d.hint).toContain('2026-3-1-번호-이름');
    // 이름이 틀린 것이지 폴더가 틀린 것이 아니다
    expect(d.offerPickClass).toBe(false);
    expect(d.offerRepick).toBe(false);
  });
});
