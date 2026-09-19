// src/lib/studentPhotos.test.ts
//
// 사진을 올릴 때 '같은 학생의 옛 사진'을 제대로 알아보는지 본다.
//
// 여기서 한 번 틀렸다. 올리기 전에 줄이면 이름이 .webp로 바뀌는데(imageShrink),
// 이미 가벼운 사진은 줄이지 않아 원래 확장자 그대로 올라간다. 예전에는 확장자까지
// 맞는 것만 찾았으므로 둘이 서로를 못 알아보고 한 학생에게 두 장이 남았고,
// 화면은 PHOTO_EXTENSIONS 차례를 따라 .webp를 먼저 골라 '방금 올린 사진이
// 반영되지 않는' 것처럼 보였다.
import { describe, it, expect, vi, beforeEach } from 'vitest';
import type { ClassKey } from './studentPhotoNames';

vi.mock('./googleApi', () => ({
  getValidGoogleToken: vi.fn(async () => 'tok'),
  getGoogleTokenQuietly: vi.fn(async () => 'tok'),
}));
vi.mock('./googlePicker', () => ({ pickDriveFolder: vi.fn(async () => null) }));
vi.mock('./driveApi', () => ({ getOrCreateFolder: vi.fn(async () => 'folder-1') }));
// 줄이기는 여기서 볼 것이 아니다. 테스트마다 결과를 갈아 끼운다.
vi.mock('./imageShrink', () => ({
  shrinkPhoto: vi.fn(),
  formatBytes: (n: number) => `${n}B`,
}));

import { uploadStudentPhoto } from './studentPhotos';
import { shrinkPhoto } from './imageShrink';

const cls: ClassKey = { year: 2026, grade: '3', classNum: '1' };
const student = { num: 5, name: '홍길동' };
const BASE = '2026-3-1-05-홍길동';

/** 드라이브 흉내. 폴더에 들어 있는 파일 목록을 들고 있다가 질의에 답한다. */
function fakeDrive(initial: { id: string; name: string }[]) {
  const files = new Map(initial.map((f) => [f.id, { ...f, trashed: false }]));
  const calls = { created: [] as string[], replaced: [] as string[], trashed: [] as string[] };
  let nextId = 100;

  const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
    const ok = (body: unknown) => ({
      ok: true,
      status: 200,
      json: async () => body,
      text: async () => JSON.stringify(body),
    }) as unknown as Response;

    // 목록 질의
    if (url.includes('/drive/v3/files?q=')) {
      const q = decodeURIComponent(new URL(url).searchParams.get('q') || '');
      const wanted = [...q.matchAll(/name='([^']*)'/g)].map((m) => m[1]);
      const hits = [...files.values()].filter((f) => !f.trashed && wanted.includes(f.name));
      return ok({ files: hits.map((f) => ({ id: f.id, name: f.name })) });
    }
    // 내용 갈아끼우기
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files/')) {
      const id = url.split('/files/')[1].split('?')[0];
      calls.replaced.push(id);
      return ok({ id, name: files.get(id)!.name, modifiedTime: '2026-09-19T00:00:00Z' });
    }
    // 새로 만들기
    if (url.startsWith('https://www.googleapis.com/upload/drive/v3/files?')) {
      const form = init!.body as FormData;
      const meta = JSON.parse(await (form.get('metadata') as Blob).text());
      const id = `new-${nextId++}`;
      files.set(id, { id, name: meta.name, trashed: false });
      calls.created.push(meta.name);
      return ok({ id, name: meta.name, modifiedTime: '2026-09-19T00:00:00Z' });
    }
    // 휴지통으로 보내기
    if (init?.method === 'PATCH' && url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
      const id = url.split('/files/')[1].split('?')[0];
      const f = files.get(id);
      if (f) f.trashed = true;
      calls.trashed.push(id);
      return ok({ id, trashed: true });
    }
    throw new Error('예상하지 못한 요청: ' + url);
  });

  return { fetchMock, calls, remaining: () => [...files.values()].filter((f) => !f.trashed) };
}

function asFile(name: string, size = 100): File {
  const f = new File([new Uint8Array(size)], name, { type: 'image/jpeg' });
  return f;
}

/** 줄이기가 걸려 webp로 바뀐 경우 / 안 걸려 원래 확장자 그대로인 경우 */
function shrinkTo(name: string, changed: boolean) {
  const file = asFile(name);
  vi.mocked(shrinkPhoto).mockResolvedValue({ file, before: 999, after: 100, changed });
}

describe('uploadStudentPhoto — 같은 학생의 옛 사진 알아보기', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('처음 올리면 새로 만든다', async () => {
    const drive = fakeDrive([]);
    vi.stubGlobal('fetch', drive.fetchMock);
    shrinkTo(`${BASE}.webp`, true);

    await uploadStudentPhoto(cls, student, asFile('IMG_1.jpg'), 'folder-1', {
      token: 'tok',
      folderId: 'folder-1',
    });

    expect(drive.calls.created).toEqual([`${BASE}.webp`]);
    expect(drive.calls.trashed).toEqual([]);
  });

  it('확장자가 같으면 그 파일의 내용만 갈아끼운다 (두 장이 되지 않는다)', async () => {
    const drive = fakeDrive([{ id: 'old-webp', name: `${BASE}.webp` }]);
    vi.stubGlobal('fetch', drive.fetchMock);
    shrinkTo(`${BASE}.webp`, true);

    await uploadStudentPhoto(cls, student, asFile('IMG_2.jpg'), 'folder-1', {
      token: 'tok',
      folderId: 'folder-1',
    });

    expect(drive.calls.replaced).toEqual(['old-webp']);
    expect(drive.calls.created).toEqual([]);
    expect(drive.remaining()).toHaveLength(1);
  });

  it('⚠️ 확장자가 달라도 옛 사진을 알아보고 치운다 — 한 장만 남는다', async () => {
    // 예전에 줄여서 올린 .webp가 이미 있다
    const drive = fakeDrive([{ id: 'old-webp', name: `${BASE}.webp` }]);
    vi.stubGlobal('fetch', drive.fetchMock);
    // 이번에는 이미 가벼운 .jpg라 줄이기를 건너뛴다
    shrinkTo('IMG_3.jpg', false);

    await uploadStudentPhoto(cls, student, asFile('IMG_3.jpg'), 'folder-1', {
      token: 'tok',
      folderId: 'folder-1',
    });

    expect(drive.calls.created).toEqual([`${BASE}.jpg`]);
    expect(drive.calls.trashed).toEqual(['old-webp']);
    const left = drive.remaining();
    expect(left).toHaveLength(1);
    expect(left[0].name).toBe(`${BASE}.jpg`);
  });

  it('옛 사진이 여럿 남아 있어도 모두 치운다', async () => {
    const drive = fakeDrive([
      { id: 'a', name: `${BASE}.webp` },
      { id: 'b', name: `${BASE}.png` },
      { id: 'c', name: `${BASE}.jpeg` },
    ]);
    vi.stubGlobal('fetch', drive.fetchMock);
    shrinkTo('IMG_4.jpg', false);

    await uploadStudentPhoto(cls, student, asFile('IMG_4.jpg'), 'folder-1', {
      token: 'tok',
      folderId: 'folder-1',
    });

    expect(drive.calls.trashed.sort()).toEqual(['a', 'b', 'c']);
    expect(drive.remaining().map((f) => f.name)).toEqual([`${BASE}.jpg`]);
  });

  it('옛 사진을 못 치워도 방금 올린 것은 올라간다', async () => {
    const drive = fakeDrive([{ id: 'old-webp', name: `${BASE}.webp` }]);
    const failing = vi.fn(async (url: string, init?: RequestInit) => {
      if (init?.method === 'PATCH' && url.startsWith('https://www.googleapis.com/drive/v3/files/')) {
        throw new Error('네트워크 끊김');
      }
      return drive.fetchMock(url, init);
    });
    vi.stubGlobal('fetch', failing);
    shrinkTo('IMG_5.jpg', false);

    const out = await uploadStudentPhoto(cls, student, asFile('IMG_5.jpg'), 'folder-1', {
      token: 'tok',
      folderId: 'folder-1',
    });

    expect(out.name).toBe(`${BASE}.jpg`);
  });
});
