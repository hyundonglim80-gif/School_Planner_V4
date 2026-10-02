// src/lib/googleApi.test.ts
//
// 구글 토큰이 만료됐을 때 로그인을 어떻게 받는지 본다 (2026-10-02 사용자 신고).
// 파일 고르기 창에서 파일을 고른 뒤에는 브라우저가 로그인 창을 막아서, 첨부가 '파일 업로드에 실패했습니다'로만
// 끝났다. 이제는 그때 '구글 로그인이 필요합니다' 창을 묻고, 그 단추에서 로그인 창을 연다.
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const signInWithPopup = vi.fn();
vi.mock('firebase/auth', () => ({
  signInWithPopup: (...a: unknown[]) => signInWithPopup(...a),
  GoogleAuthProvider: { credentialFromResult: (r: any) => r?.credential ?? null },
}));
vi.mock('./firebase', () => ({ auth: {}, googleProvider: {} }));

import { getValidGoogleToken, renewGoogleToken, forgetGoogleToken, GoogleAuthError } from './googleApi';
import { registerGoogleLoginHost, finishGoogleLogin, useGoogleLoginPrompt, askGoogleLogin } from './googleLoginPrompt';
import { uploadToDrive } from './driveApi';
import { useAppStore } from '../store/useAppStore';

/** navigator.userActivation 흉내 - true면 '방금 누른 때' */
function setActivation(active: boolean | undefined) {
  Object.defineProperty(navigator, 'userActivation', {
    configurable: true,
    get: () => (active === undefined ? undefined : { isActive: active }),
  });
}

/** 토큰 확인(tokeninfo)과 드라이브를 흉내 낸다 */
function mockFetch(handler: (url: string, init?: RequestInit) => any) {
  globalThis.fetch = vi.fn(async (url: any, init?: RequestInit) => handler(String(url), init)) as any;
}
const res = (status: number, body: any = {}, headers: Record<string, string> = {}) => ({
  ok: status >= 200 && status < 300,
  status,
  json: async () => body,
  text: async () => JSON.stringify(body),
  headers: { get: (k: string) => headers[k] ?? null },
});

let unregister: (() => void) | null = null;

beforeEach(() => {
  signInWithPopup.mockReset();
  forgetGoogleToken();
  unregister = registerGoogleLoginHost();
});
afterEach(() => {
  unregister?.();
  unregister = null;
  setActivation(undefined);
});

describe('getValidGoogleToken', () => {
  it('살아 있는 토큰이 있으면 창을 띄우지 않는다', async () => {
    useAppStore.getState().setGoogleAccessToken('live');
    mockFetch(() => res(200));
    await expect(getValidGoogleToken()).resolves.toBe('live');
    expect(signInWithPopup).not.toHaveBeenCalled();
    expect(useGoogleLoginPrompt.getState().open).toBe(false);
  });

  it('방금 누른 때면 로그인 창을 바로 연다 (예전 그대로)', async () => {
    setActivation(true);
    signInWithPopup.mockResolvedValue({ credential: { accessToken: 'new' } });
    await expect(getValidGoogleToken()).resolves.toBe('new');
    expect(useGoogleLoginPrompt.getState().open).toBe(false);
  });

  it('누른 지 오래면(파일을 고른 뒤) 로그인 창을 열지 않고 묻는 창을 띄운다 → 로그인하면 그 토큰', async () => {
    setActivation(false);
    const p = getValidGoogleToken();
    await vi.waitFor(() => expect(useGoogleLoginPrompt.getState().open).toBe(true));
    expect(signInWithPopup).not.toHaveBeenCalled();
    finishGoogleLogin('from-prompt');
    await expect(p).resolves.toBe('from-prompt');
    expect(useGoogleLoginPrompt.getState().open).toBe(false);
  });

  it('브라우저가 로그인 창을 막으면 묻는 창으로 넘어간다', async () => {
    setActivation(true);
    signInWithPopup.mockRejectedValue({ code: 'auth/popup-blocked' });
    const p = getValidGoogleToken();
    await vi.waitFor(() => expect(useGoogleLoginPrompt.getState().open).toBe(true));
    finishGoogleLogin('ok');
    await expect(p).resolves.toBe('ok');
  });

  it('로그인 창이 다른 까닭으로 열리지 못해도(auth/internal-error 등) 묻는 창으로 넘어간다', async () => {
    setActivation(true);
    signInWithPopup.mockRejectedValue({ code: 'auth/internal-error' });
    const p = getValidGoogleToken();
    await vi.waitFor(() => expect(useGoogleLoginPrompt.getState().open).toBe(true));
    finishGoogleLogin('ok');
    await expect(p).resolves.toBe('ok');
  });

  it('사용자가 로그인 창을 닫았으면 다시 묻지 않는다', async () => {
    setActivation(true);
    signInWithPopup.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    await expect(getValidGoogleToken()).rejects.toThrow('창이 닫혀');
    expect(useGoogleLoginPrompt.getState().open).toBe(false);
  });

  it('묻는 창을 닫으면 사용자에게 보여 줄 GoogleAuthError', async () => {
    setActivation(false);
    const p = getValidGoogleToken();
    await vi.waitFor(() => expect(useGoogleLoginPrompt.getState().open).toBe(true));
    finishGoogleLogin(null);
    await expect(p).rejects.toBeInstanceOf(GoogleAuthError);
  });

  it('묻는 창을 그릴 곳이 없으면 기다리지 않고 바로 실패한다', async () => {
    unregister?.();
    unregister = null;
    setActivation(false);
    await expect(getValidGoogleToken()).rejects.toBeInstanceOf(GoogleAuthError);
  });
});

describe('askGoogleLogin', () => {
  it('파일 여러 개가 함께 물어도 창은 하나, 답은 같다', async () => {
    const a = askGoogleLogin();
    const b = askGoogleLogin();
    expect(a).toBe(b);
    finishGoogleLogin('t');
    await expect(Promise.all([a, b])).resolves.toEqual(['t', 't']);
  });
});

describe('renewGoogleToken', () => {
  it('로그인 창을 닫으면 그 까닭을 알린다', async () => {
    signInWithPopup.mockRejectedValue({ code: 'auth/popup-closed-by-user' });
    await expect(renewGoogleToken()).rejects.toThrow('창이 닫혀');
  });
});

describe('uploadToDrive', () => {
  it('드라이브가 토큰을 401로 거절하면 토큰을 잊고 다시 로그인을 받아 한 번 더 올린다', async () => {
    useAppStore.getState().setGoogleAccessToken('stale');
    setActivation(false);
    const used: string[] = [];
    mockFetch((url, init) => {
      if (url.includes('tokeninfo')) return url.includes('stale') ? res(200) : res(400);
      const auth = (init?.headers as any)?.Authorization || '';
      if (url.includes('googleapis.com/drive') || url.includes('upload/drive')) used.push(auth);
      if (auth === 'Bearer stale') return res(401);
      if (url.includes('/files?q=')) return res(200, { files: [{ id: 'folder' }] });
      if (url.includes('uploadType=resumable')) return res(200, {}, { Location: 'https://upload.example/put' });
      if (url === 'https://upload.example/put') return res(200, { id: 'f1', name: 'a.png', webViewLink: 'w' });
      return res(200, {});
    });
    const p = uploadToDrive(new Blob(['x']), 'a.png');
    await vi.waitFor(() => expect(useGoogleLoginPrompt.getState().open).toBe(true));
    finishGoogleLogin('fresh');
    const file = await p;
    expect(file.id).toBe('f1');
    expect(used[0]).toBe('Bearer stale');
    expect(used.slice(1).every((a) => a === 'Bearer fresh')).toBe(true);
    expect(useAppStore.getState().googleAccessToken).toBe(null); // 묻는 창의 토큰 저장은 renewGoogleToken이 한다
  });
});
