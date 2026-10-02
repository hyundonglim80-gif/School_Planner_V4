// src/lib/studentPhotosDrive.test.ts
//
// 드라이브에서 고른 사진을 파일로 받아 오는지 (lib/studentPhotos.pickPhotosFromDrive).
// 받은 파일은 기기에서 고른 것과 같은 올리기 길로 간다 - 이름·종류가 그대로여야 여러 장 짝짓기가 된다.
import { describe, it, expect, vi } from 'vitest';

vi.mock('./googleApi', () => ({ getValidGoogleToken: vi.fn(async () => 'tok'), getGoogleTokenQuietly: vi.fn(async () => 'tok') }));
vi.mock('./googlePicker', () => ({
  pickDriveFolder: vi.fn(),
  pickDriveImages: vi.fn(async () => [
    { id: 'id-1', name: '2026-3-1-01-가람.jpg', mimeType: 'image/jpeg' },
    { id: 'id-2', name: '나래.png', mimeType: 'image/png' },
  ]),
}));
vi.mock('./driveApi', () => ({ getOrCreateFolder: vi.fn(async () => 'folder') }));

import { pickPhotosFromDrive } from './studentPhotos';
import { pickDriveImages } from './googlePicker';

describe('pickPhotosFromDrive', () => {
  it('고른 사진을 차례로 받아 이름·종류를 지닌 파일로 돌려준다', async () => {
    const urls: string[] = [];
    globalThis.fetch = vi.fn(async (url: any, init?: any) => {
      urls.push(`${url}|${init?.headers?.Authorization}`);
      return { ok: true, status: 200, blob: async () => new Blob(['x']) } as any;
    }) as any;
    const progress: string[] = [];
    const files = await pickPhotosFromDrive({ multiple: true }, (d, t) => progress.push(`${d}/${t}`));
    expect(files.map((f) => [f.name, f.type])).toEqual([
      ['2026-3-1-01-가람.jpg', 'image/jpeg'],
      ['나래.png', 'image/png'],
    ]);
    expect(urls).toEqual([
      'https://www.googleapis.com/drive/v3/files/id-1?alt=media|Bearer tok',
      'https://www.googleapis.com/drive/v3/files/id-2?alt=media|Bearer tok',
    ]);
    expect(progress).toEqual(['0/2', '1/2', '2/2']);
    expect(vi.mocked(pickDriveImages).mock.calls[0][1]).toEqual({ multiple: true });
  });

  it('고르지 않으면 아무것도 받지 않는다', async () => {
    vi.mocked(pickDriveImages).mockResolvedValueOnce([]);
    globalThis.fetch = vi.fn() as any;
    await expect(pickPhotosFromDrive()).resolves.toEqual([]);
    expect(globalThis.fetch).not.toHaveBeenCalled();
  });
});
