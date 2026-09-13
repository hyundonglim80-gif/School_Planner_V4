import { useState, useEffect } from 'react';
import { signInWithPopup, signOut, onAuthStateChanged, GoogleAuthProvider } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { auth, googleProvider } from '../../lib/firebase';
import { useAppStore } from '../../store/useAppStore';

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

  const loginWithGoogle = async () => {
    try {
      googleProvider.setCustomParameters({
        prompt: 'select_account'
      });
      const result = await signInWithPopup(auth, googleProvider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        useAppStore.getState().setGoogleAccessToken(credential.accessToken);
        // 구글 시트/캘린더 연동 코드가 이 키를 읽는다. 예전에는 아무도 값을 넣지 않아
        // 항상 "구글 로그인이 필요합니다"로 막혀 있었다.
        try {
          sessionStorage.setItem('google_api_token', credential.accessToken);
        } catch {
          /* 시크릿 모드 등에서 실패할 수 있으나 스토어 값으로 동작한다 */
        }
      }
    } catch (error) {
      console.error('Login failed:', error);
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

  return { user, loading, loginWithGoogle, logout };
}

