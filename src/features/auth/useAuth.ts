import { useState, useEffect, useRef } from 'react';
import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signOut,
  onAuthStateChanged,
  GoogleAuthProvider,
} from 'firebase/auth';
import type { User, UserCredential } from 'firebase/auth';
import { auth, googleProvider } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';
import { showErrorToast } from '../../utils/toast';

/** 구글 액세스 토큰을 챙겨 둔다. 시트·캘린더 연동이 이 값을 읽는다. */
function keepAccessToken(result: UserCredential | null) {
  const credential = result ? GoogleAuthProvider.credentialFromResult(result) : null;
  if (!credential?.accessToken) return;
  useAppStore.getState().setGoogleAccessToken(credential.accessToken);
  try {
    sessionStorage.setItem('google_api_token', credential.accessToken);
  } catch {
    /* 시크릿 모드 등에서 실패할 수 있으나 스토어 값으로 동작한다 */
  }
}

/** 팝업으로는 안 되는 상황인가 (막혔거나, 창은 떴는데 끝을 못 잡는 경우) */
function popupUnusable(code: string): boolean {
  return (
    code === 'auth/popup-blocked' ||
    code === 'auth/operation-not-supported-in-this-environment' ||
    code === 'auth/web-storage-unsupported'
  );
}

export function useAuth() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, (currentUser) => {
      setUser(currentUser);
      setLoading(false);
    });
    return () => unsubscribe();
  }, []);

  // 로그인이 진행 중인지. 두 번 누르면 앞의 요청이 취소되며
  // auth/cancelled-popup-request 가 나고 둘 다 실패한다.
  const signingInRef = useRef(false);
  const [signingIn, setSigningIn] = useState(false);

  // 팝업이 막혀 리디렉션으로 돌아온 경우를 마무리한다.
  // 이걸 안 하면 돌아와도 구글 토큰(시트·캘린더용)을 못 챙긴다.
  useEffect(() => {
    getRedirectResult(auth)
      .then((result) => {
        if (result) keepAccessToken(result);
      })
      .catch((e) => {
        console.error('리디렉션 로그인 마무리 실패:', e);
      });
  }, []);

  const loginWithGoogle = async () => {
    // ⚠️ 여기가 없어서 두 번 누르면 둘 다 실패했다. 팝업이 반응 없어 보이면
    //    누구나 한 번 더 누르는데, 그때 앞의 요청이 취소되고
    //    auth/cancelled-popup-request 가 난다. 게다가 실패를 화면에 알리지
    //    않아서(콘솔에만 찍혔다) 사용자는 왜 안 되는지 알 수가 없었다.
    if (signingInRef.current) return;
    signingInRef.current = true;
    setSigningIn(true);

    try {
      // ⚠️ try 안에 둔다. 밖에 두었더니 여기서 실패했을 때 finally를 못 타고
      //    '진행 중' 표시가 풀리지 않아 버튼이 영영 잠겼다.
      googleProvider.setCustomParameters({ prompt: 'select_account' });
      const result = await signInWithPopup(auth, googleProvider);
      keepAccessToken(result);
    } catch (error: any) {
      const code = String(error?.code || '');

      // 사용자가 스스로 창을 닫은 것은 오류가 아니다.
      if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
        return;
      }

      if (popupUnusable(code)) {
        // 팝업을 못 쓰는 브라우저·설정이면 리디렉션으로 넘어간다.
        // 이 호출은 페이지를 통째로 옮기므로 여기서 끝난다.
        try {
          await signInWithRedirect(auth, googleProvider);
          return;
        } catch (e) {
          console.error('리디렉션 로그인도 실패:', e);
          showErrorToast('로그인 창을 열지 못했습니다. 팝업 차단을 풀고 다시 시도해 주세요.', e);
          return;
        }
      }

      console.error('Login failed:', error);
      showErrorToast(`로그인하지 못했습니다. (${code || '알 수 없는 오류'})`, error);
    } finally {
      signingInRef.current = false;
      setSigningIn(false);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      // 💡 로그아웃할 때 계정에 딸린 상태를 지우지 않아, 다른 계정으로 바꿔도
      // 이전 사용자의 선택된 그룹/토큰/선택 항목이 그대로 남아 있었다.
      useAppStore.getState().clearAuthData();
      try {
        sessionStorage.removeItem('google_api_token');
      } catch {
        /* 무시 */
      }
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return { user, loading, signingIn, loginWithGoogle, logout };
}

