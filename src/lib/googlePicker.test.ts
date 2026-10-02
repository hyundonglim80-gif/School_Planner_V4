// src/lib/googlePicker.test.ts
//
// 드라이브의 사진 고르기(pickDriveImages) - 선택창을 흉내 내 무엇을 요청하고 무엇을 돌려주는지 본다.
// 폴더가 아니라 '사진 파일'을 고르게 해야 drive.file 권한으로 받아 올 수 있다 (2026-10-02).
import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('./firebase', () => ({ GOOGLE_API_KEY: 'key', GOOGLE_APP_ID: 'app' }));
import { pickDriveImages, pickDriveFolder, PICKABLE_IMAGE_TYPES } from './googlePicker';

/** 선택창 흉내. setVisible(true)이면 정한 답으로 콜백을 부른다 */
function fakeGoogle(answer: { action: 'picked' | 'cancel'; docs?: any[] }) {
  const seen = { views: [] as any[], multi: false, title: '' };
  class DocsView {
    o: any;
    constructor(id: string) {
      this.o = { viewId: id };
    }
    setIncludeFolders(v: boolean) { this.o.includeFolders = v; return this; }
    setSelectFolderEnabled(v: boolean) { this.o.selectFolder = v; return this; }
    setMimeTypes(m: string) { this.o.mimeTypes = m; return this; }
    setMode(m: string) { this.o.mode = m; return this; }
    setParent(p: string) { this.o.parent = p; return this; }
    setLabel(l: string) { this.o.label = l; return this; }
    setOwnedByMe(v: boolean) { this.o.ownedByMe = v; return this; }
    setEnableDrives(v: boolean) { this.o.drives = v; return this; }
  }
  class PickerBuilder {
    cb: any;
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    setTitle(t: string) { seen.title = t; return this; }
    addView(v: any) { seen.views.push(v.o); return this; }
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
      ViewId: { DOCS: 'docs', DOCS_IMAGES: 'images', FOLDERS: 'folders' },
      DocsViewMode: { GRID: 'grid', LIST: 'list' },
      Feature: { MULTISELECT_ENABLED: 'multi' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
    },
  };
  return seen;
}

beforeEach(() => {
  delete (window as any).google;
  localStorage.clear();
});

const FOLDER = 'application/vnd.google-apps.folder';

describe('pickDriveImages', () => {
  it('사진 파일(폴더 아님)을 여러 장 고르게 하고, 고른 것을 돌려준다', async () => {
    const seen = fakeGoogle({ action: 'picked', docs: [{ id: 'a', name: '1번.jpg', mimeType: 'image/jpeg' }, { id: 'b', name: '2번.png', mimeType: 'image/png' }] });
    const got = await pickDriveImages('tok', { multiple: true, title: '여러 장' });
    expect(got).toEqual([{ id: 'a', name: '1번.jpg', mimeType: 'image/jpeg' }, { id: 'b', name: '2번.png', mimeType: 'image/png' }]);
    expect(seen.multi).toBe(true);
    expect(seen.title).toBe('여러 장');
  });

  it('드라이브처럼 폴더를 열어 들어가는 탭들 - 내 드라이브 맨 위부터, 폴더는 보이되 고르지는 않는다', async () => {
    const seen = fakeGoogle({ action: 'cancel' });
    await pickDriveImages('tok');
    expect(seen.views.map((v) => v.label)).toEqual(['내 드라이브', '공유 문서함', '공유 드라이브', '모든 사진']);
    const [mine, shared, drives, all] = seen.views;
    expect(mine).toMatchObject({ viewId: 'docs', parent: 'root', includeFolders: true, selectFolder: false, mode: 'list' });
    expect(mine.mimeTypes).toBe(`${FOLDER},${PICKABLE_IMAGE_TYPES}`);
    // 공유 문서함: setOwnedByMe는 setIncludeFolders와 같이 쓰면 무시된다
    expect(shared).toMatchObject({ ownedByMe: false, selectFolder: false });
    expect(shared.includeFolders).toBeUndefined();
    expect(shared.mimeTypes).toContain(FOLDER);
    expect(drives).toMatchObject({ drives: true, includeFolders: true });
    expect(all).toMatchObject({ viewId: 'images', mimeTypes: PICKABLE_IMAGE_TYPES });
  });

  it('고른 사진의 폴더를 기억해 다음에는 \'지난번 폴더\' 탭부터', async () => {
    fakeGoogle({ action: 'picked', docs: [{ id: 'a', name: 'a.jpg', mimeType: 'image/jpeg', parentId: 'fold-3-1' }] });
    await pickDriveImages('tok');
    const seen = fakeGoogle({ action: 'cancel' });
    await pickDriveImages('tok');
    expect(seen.views[0]).toMatchObject({ label: '지난번 폴더', parent: 'fold-3-1', includeFolders: true });
    expect(seen.views[1].label).toBe('내 드라이브');
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
    expect(seen.views.map((v) => v.viewId)).toEqual(['folders']);
    expect(seen.multi).toBe(false);
  });
});
