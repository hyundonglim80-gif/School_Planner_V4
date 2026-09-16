// src/lib/emulator.ts
//
// 점검용 에뮬레이터 연결. 운영 빌드에는 절대 들어가면 안 된다.
//
// VITE_USE_EMULATOR는 빌드할 때 상수로 치환되므로, 값이 '1'이 아니면 아래
// 코드는 통째로 번들에서 빠진다(vite의 죽은 코드 제거). 그래서 npm run build로
// 만든 결과물에는 에뮬레이터 주소도, 자동 로그인도 남지 않는다.
import { connectAuthEmulator, signInWithEmailAndPassword } from 'firebase/auth';
import { connectFirestoreEmulator } from 'firebase/firestore';
import { connectStorageEmulator } from 'firebase/storage';
import type { Auth } from 'firebase/auth';
import type { Firestore } from 'firebase/firestore';
import type { FirebaseStorage } from 'firebase/storage';

export const USING_EMULATOR = import.meta.env.VITE_USE_EMULATOR === '1';

/** 점검용 계정. 시드 스크립트가 같은 값으로 만든다. */
export const EMULATOR_USER = {
  email: import.meta.env.VITE_EMULATOR_EMAIL || 'teacher@example.com',
  password: 'test1234',
};

export function connectEmulators(auth: Auth, db: Firestore, storage: FirebaseStorage) {
  if (!USING_EMULATOR) return;
  const host = '127.0.0.1';
  connectAuthEmulator(auth, `http://${host}:9099`, { disableWarnings: true });
  connectFirestoreEmulator(db, host, 8080);
  connectStorageEmulator(storage, host, 9199);
}

/**
 * 구글 로그인 팝업은 사람이 눌러야 하므로 자동 점검을 할 수 없다.
 * 에뮬레이터에서는 미리 만들어 둔 계정으로 그냥 들어간다.
 */
export async function autoSignIn(auth: Auth) {
  if (!USING_EMULATOR) return;
  if (auth.currentUser) return;
  try {
    await signInWithEmailAndPassword(auth, EMULATOR_USER.email, EMULATOR_USER.password);
  } catch (err) {
    console.error('[emulator] 자동 로그인 실패. 시드를 먼저 돌렸는지 확인하세요.', err);
  }
}
