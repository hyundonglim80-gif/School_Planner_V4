import '@testing-library/jest-dom/vitest';
import { vi, afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// globals: false 라 RTL의 자동 정리가 등록되지 않는다. 직접 붙여 준다.
// (없으면 이전 테스트의 DOM이 남아 조회가 중복으로 잡힌다)
afterEach(() => cleanup());

// 컴포넌트 테스트에서는 Firebase에 접속하지 않는다.
// 실제 데이터가 아니라 화면 구조와 동작만 확인하는 것이 목적이다.
vi.mock('../lib/firebase', () => ({
  db: {},
  auth: { currentUser: { uid: 'test-uid', displayName: '테스트' } },
  storage: {},
  app: {},
  googleProvider: { addScope: () => {}, setCustomParameters: () => {} },
}));

vi.mock('firebase/firestore', () => ({
  doc: vi.fn(() => ({ path: 'mock/path' })),
  collection: vi.fn(() => ({})),
  getDoc: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  getDocs: vi.fn(async () => ({ forEach: () => {}, docs: [] })),
  getDocFromServer: vi.fn(async () => ({ exists: () => false, data: () => ({}) })),
  getDocsFromServer: vi.fn(async () => ({ forEach: () => {}, docs: [] })),
  setDoc: vi.fn(async () => {}),
  updateDoc: vi.fn(async () => {}),
  deleteDoc: vi.fn(async () => {}),
  addDoc: vi.fn(async () => ({ id: 'new-id' })),
  onSnapshot: vi.fn(() => () => {}),
  runTransaction: vi.fn(async () => {}),
  writeBatch: vi.fn(() => ({ set: vi.fn(), update: vi.fn(), delete: vi.fn(), commit: vi.fn(async () => {}) })),
  query: vi.fn(() => ({})),
  where: vi.fn(() => ({})),
  documentId: vi.fn(() => '__name__'),
  orderBy: vi.fn(() => ({})),
  arrayUnion: vi.fn(() => ({})),
  arrayRemove: vi.fn(() => ({})),
}));

vi.mock('firebase/auth', () => ({
  getAuth: vi.fn(() => ({ currentUser: { uid: 'test-uid', email: 't@example.com' } })),
  GoogleAuthProvider: class { addScope() {} setCustomParameters() {} static credentialFromResult() { return null; } },
  signInWithPopup: vi.fn(async () => ({ user: { uid: 'test-uid' } })),
  signInWithRedirect: vi.fn(async () => {}),
  getRedirectResult: vi.fn(async () => null),
  signOut: vi.fn(async () => {}),
  onAuthStateChanged: vi.fn(() => () => {}),
  connectAuthEmulator: vi.fn(),
  signInWithEmailAndPassword: vi.fn(async () => ({ user: { uid: 'test-uid' } })),
  createUserWithEmailAndPassword: vi.fn(async () => ({ user: { uid: 'test-uid' } })),
}));

vi.mock('firebase/storage', () => ({
  ref: vi.fn(() => ({})),
  uploadBytes: vi.fn(async () => ({})),
  getDownloadURL: vi.fn(async () => 'https://example.test/file.png'),
  deleteObject: vi.fn(async () => {}),
}));
