// src/lib/googleLoginPrompt.ts
//
// '구글 로그인이 필요합니다' 창의 상태. googleApi.getValidGoogleToken이 로그인 창을 바로 띄울 수 없을 때
// (사용자가 방금 누른 때가 아니라 브라우저가 막을 때) 이 창을 열고, 사용자가 단추를 누르면 그때 로그인 창을 연다.
// 창은 components/GoogleLoginPrompt가 그린다(Layout에 하나).
import { create } from 'zustand';

/** reason: 무엇 때문에 로그인이 필요한지 (없으면 드라이브 안내 - 2026-10-07 구글 캘린더도 묻는다) */
export const useGoogleLoginPrompt = create<{ open: boolean; reason?: string }>(() => ({ open: false }));

let pending: Promise<string | null> | null = null;
let settle: ((token: string | null) => void) | null = null;
let hosts = 0;

/** 창을 그리는 쪽이 붙어 있는 동안 센다. 붙은 곳이 없으면 묻지 않고 바로 실패로 돌린다(끝나지 않는 기다림을 막는다). */
export function registerGoogleLoginHost(): () => void {
  hosts += 1;
  return () => {
    hosts -= 1;
    if (hosts <= 0) finishGoogleLogin(null);
  };
}

/** 로그인을 묻는다. 로그인하면 토큰, 닫으면 null. 이미 묻는 중이면 같은 답을 기다린다(파일 여러 개를 올릴 때 창이 겹치지 않게). */
export function askGoogleLogin(reason?: string): Promise<string | null> {
  if (hosts <= 0) return Promise.resolve(null);
  if (pending) return pending;
  pending = new Promise((resolve) => {
    settle = resolve;
  });
  useGoogleLoginPrompt.setState({ open: true, reason });
  return pending;
}

/** 창을 닫으며 기다리던 쪽에 답한다 */
export function finishGoogleLogin(token: string | null) {
  const done = settle;
  pending = null;
  settle = null;
  useGoogleLoginPrompt.setState({ open: false, reason: undefined });
  done?.(token);
}
