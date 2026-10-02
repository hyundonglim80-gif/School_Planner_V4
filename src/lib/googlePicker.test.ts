// src/lib/googlePicker.test.ts
//
// 드라이브의 사진 고르기(pickDriveImages) - 선택창을 흉내 내 무엇을 요청하고 무엇을 돌려주는지 본다.
// 폴더가 아니라 '사진 파일'을 고르게 해야 drive.file 권한으로 받아 올 수 있다 (2026-10-02).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./firebase', () => ({ GOOGLE_API_KEY: 'key', GOOGLE_APP_ID: 'app' }));
import { pickDriveImages, pickDriveFolder, PICKABLE_IMAGE_TYPES } from './googlePicker';

/** 선택창 흉내. setVisible(true)이면 정한 답으로 콜백을 부른다 */
function fakeGoogle(answer: { action: 'picked' | 'cancel'; docs?: any[] }) {
  const seen = { view: null as any, mimeTypes: '', multi: false, title: '', viewId: '' };
  class DocsView {
    constructor(id: string) {
      seen.viewId = id;
      seen.view = this;
    }
    setIncludeFolders() { return this; }
    setSelectFolderEnabled() { return this; }
    setMimeTypes(m: string) { seen.mimeTypes = m; return this; }
    setMode() { return this; }
  }
  class PickerBuilder {
    cb: any;
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setTitle(t: string) { seen.title = t; return this; }
    addView() { return this; }
    enableFeature(f: string) { if (f === 'multi') seen.multi = true; return this; }
    setCallback(cb: any) { this.cb = cb; return this; }
    build() {
      const cb = this.cb;
      return {
        setVisible: (on: boolean) => {
          if (!on) return;
          setTimeout(() => cb(answer.action === 'picked' ? { action: 'picked', docs: answer.docs } : { action: 'cancel' }), 0);
        },
      };
    }
  }
  (window as any).gapi = { load: (_: string, o: any) => o.callback() };
  (window as any).google = {
    picker: {
      DocsView, PickerBuilder,
      ViewId: { DOCS_IMAGES: 'images', FOLDERS: 'folders' },
      DocsViewMode: { GRID: 'grid' },
      Feature: { MULTISELECT_ENABLED: 'multi' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
    },
  };
  return seen;
}

beforeEach(() => {
  delete (window as any).google;
});

describe('pickDriveImages', () => {
  it('사진 파일(폴더 아님)을 여러 장 고르게 하고, 고른 것을 돌려준다', async () => {
    const seen = fakeGoogle({ action: 'picked', docs: [{ id: 'a', name: '1번.jpg', mimeType: 'image/jpeg' }, { id: 'b', name: '2번.png', mimeType: 'image/png' }] });
    const got = await pickDriveImages('tok', { multiple: true, title: '여러 장' });
    expect(got).toEqual([{ id: 'a', name: '1번.jpg', mimeType: 'image/jpeg' }, { id: 'b', name: '2번.png', mimeType: 'image/png' }]);
    expect(seen.viewId).toBe('images');
    expect(seen.mimeTypes).toBe(PICKABLE_IMAGE_TYPES);
    expect(seen.multi).toBe(true);
    expect(seen.title).toBe('여러 장');
  });

  it('한 장 고르기는 여러 장 고르기를 켜지 않는다', async () => {
    const seen = fakeGoogle({ action: 'picked', docs: [{ id: 'a', name: 'a.jpg', mimeType: 'image/jpeg' }] });
    await pickDriveImages('tok');
    expect(seen.multi).toBe(false);
  });

  it('취소하면 빈 배열', async () => {
    fakeGoogle({ action: 'cancel' });
    await expect(pickDriveImages('tok', { multiple: true })).resolves.toEqual([]);
  });
});

describe('pickDriveFolder (예전 그대로)', () => {
  it('폴더 하나를 고르면 { id, name }', async () => {
    const seen = fakeGoogle({ action: 'picked', docs: [{ id: 'f', name: '2026-3-1' }] });
    await expect(pickDriveFolder('tok')).resolves.toEqual({ id: 'f', name: '2026-3-1' });
    expect(seen.viewId).toBe('folders');
    expect(seen.multi).toBe(false);
  });
});
