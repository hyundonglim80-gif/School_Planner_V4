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
      }
    } catch (error) {
      console.error('Login failed:', error);
    }
  };

  const logout = async () => {
    try {
      await signOut(auth);
      useAppStore.getState().setGoogleAccessToken(null);
    } catch (error) {
      console.error('Logout failed:', error);
    }
  };

  return { user, loading, loginWithGoogle, logout };
}

