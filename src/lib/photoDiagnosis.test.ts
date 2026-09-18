import { describe, it, expect } from 'vitest';
import { diagnosePhotos } from './photoDiagnosis';
import type { PhotoScan } from './studentPhotos';

const scan = (over: Partial<PhotoScan> = {}): PhotoScan => ({
  folderId: 'f1',
  source: 'subfolder',
  files: [],
  subfolderNames: [],
  rootEmpty: false,
  ...over,
});

const base = { className: '2026-3-1', studentCount: 25, matchedCount: 0 };

describe('아직 훑기 전', () => {
  it('불러오는 중이라고 한다', () => {
    const d = diagnosePhotos({ ...base, scan: null });
    expect(d.message).toContain('불러오는 중');
    expect(d.offerRepick).toBe(false);
  });
});

describe('사진을 찾을 곳을 못 잡았을 때', () => {
  it('고른 폴더가 통째로 비어 보이면 권한 이야기를 한다', () => {
    const d = diagnosePhotos({
      ...base,
      scan: scan({ folderId: null, source: 'none', rootEmpty: true }),
    });
    expect(d.tone).toBe('error');
    expect(d.message).toContain('비어 보입니다');
    expect(d.hint).toContain('하위 폴더까지는');
    expect(d.hint).toContain('2026-3-1');
    expect(d.offerRepick).toBe(true);
  });

  it('다른 폴더는 보이는데 학급 폴더만 없으면 보이는 것을 알려 준다', () => {
    const d = diagnosePhotos({
      ...base,
      scan: scan({
        folderId: null,
        source: 'none',
        subfolderNames: ['2026-3-2', '2025-6-3'],
      }),
    });
    expect(d.tone).toBe('error');
    expect(d.message).toContain("'2026-3-1' 폴더가 없습니다");
    expect(d.message).toContain('2026-3-2');
    expect(d.offerRepick).toBe(true);
  });

  it('폴더가 많으면 몇 개만 추리고 나머지는 세어 준다', () => {
    const d = diagnosePhotos({
      ...base,
      scan: scan({
        folderId: null,
        source: 'none',
        subfolderNames: ['a', 'b', 'c', 'd', 'e'],
      }),
    });
    expect(d.message).toContain('a, b, c 외 2개');
  });

  it('폴더도 사진도 없으면 확장자를 짚어 준다', () => {
    const d = diagnosePhotos({ ...base, scan: scan({ folderId: null, source: 'none' }) });
    expect(d.message).toContain('png');
    expect(d.offerRepick).toBe(true);
  });
});

describe('폴더는 잡았을 때', () => {
  it('사진이 한 장도 없으면 올리라고 한다', () => {
    const d = diagnosePhotos({ ...base, scan: scan({ files: [] }) });
    expect(d.tone).toBe('warn');
    expect(d.message).toContain('사진 파일이 없습니다');
    expect(d.offerRepick).toBe(false);
  });

  it('사진은 있는데 하나도 안 맞으면 이름 규칙을 알려 준다', () => {
    const d = diagnosePhotos({
      ...base,
      scan: scan({ files: [{ id: '1', name: 'IMG_001.png' }, { id: '2', name: 'IMG_002.png' }] }),
    });
    expect(d.tone).toBe('error');
    expect(d.message).toContain('2장을 찾았지만');
    expect(d.message).toContain('IMG_001.png');
    expect(d.hint).toContain('2026-3-1-번호-이름');
    // 이름이 틀린 것이지 폴더가 틀린 것이 아니므로 다시 고르라고 하지 않는다
    expect(d.offerRepick).toBe(false);
  });

  it('학급 폴더가 아니라 고른 폴더에서 찾았으면 그렇게 말한다', () => {
    const d = diagnosePhotos({
      ...base,
      scan: scan({ source: 'root', files: [{ id: '1', name: 'x.png' }] }),
    });
    expect(d.message).toContain('고른 폴더');
    expect(d.message).not.toContain('2026-3-1 폴더에서');
  });

  it('일부만 맞으면 몇 명인지 센다', () => {
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
