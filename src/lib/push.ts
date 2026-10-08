// src/lib/push.ts
//
// 일정 알림 서버 푸시 - 이 기기의 FCM 토큰을 계정에 올려 둔다 (2026-10-08).
// 서버(functions/index.js의 sendDueAlarms)가 알림 시각에 users/{uid}/v4_pushTokens의 토큰으로 보내고,
// 서비스 워커(public/sw.js의 push)가 받는다: 앱을 보고 있으면 앱에 넘겨 알림 창·소리(useEventAlarms),
// 아니면 휴대폰·PC 알림을 띄운다. 앱을 닫아도 온다.
//
// - 켜고 끄기는 기기마다(localStorage `sp4-push`). 알림 허용이 이미 되어 있고 끈 적이 없으면 앱이 뜰 때 저절로 켠다.
// - 토큰은 바뀔 수 있어 앱이 뜰 때마다 다시 받아 맞춘다(refreshPushToken).
// - 아이폰·아이패드는 홈 화면에 설치한 앱(iOS 16.4+)에서만 된다 - 사파리 탭에서는 'ios-install'.
// - 로그아웃할 때 이 기기 토큰을 지운다(다른 계정의 알림이 이 기기로 오지 않게).
import { getMessaging, getToken, deleteToken, isSupported } from 'firebase/messaging';
import { deleteDoc, doc, setDoc } from 'firebase/firestore';
import { app, auth, db } from './firebase';
import { detectDeviceKind } from './preferenceSync';
import { USING_EMULATOR } from './emulator';

const PREF_KEY = 'sp4-push'; // 'on' | 'off' (없으면 아직 고르지 않음)
const TOKEN_KEY = 'sp4-push-token'; // { uid, id } - 이 기기가 올린 토큰 문서

export type PushState = 'unsupported' | 'ios-install' | 'blocked' | 'off' | 'on';

function readLocal(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function writeLocal(key: string, value: string | null) {
  try {
    if (value == null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    /* 시크릿 모드 등 */
  }
}

function isIOS(): boolean {
  const ua = navigator.userAgent || '';
  return /iPhone|iPad|iPod/i.test(ua) || (/Macintosh/.test(ua) && navigator.maxTouchPoints > 1);
}
function isStandalone(): boolean {
  try {
    return window.matchMedia?.('(display-mode: standalone)').matches || (navigator as any).standalone === true;
  } catch {
    return false;
  }
}

/** 토큰 → 문서 id (FNV-1a 두 번, 토큰 글자를 그대로 id로 쓰지 않는다) */
export function tokenDocId(token: string): string {
  let a = 0x811c9dc5;
  let b = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < token.length; i++) {
    const c = token.charCodeAt(i);
    a = Math.imul(a ^ c, 0x01000193) >>> 0;
    b = Math.imul(b ^ c, 0x5bd1e995) >>> 0;
  }
  return `t${a.toString(16).padStart(8, '0')}${b.toString(16).padStart(8, '0')}`;
}

async function supported(): Promise<boolean> {
  if (typeof window === 'undefined' || typeof Notification === 'undefined' || !('serviceWorker' in navigator)) return false;
  if (USING_EMULATOR) return true; // 점검: 진짜 FCM 대신 가짜 토큰(아래)
  try {
    return await isSupported();
  } catch {
    return false;
  }
}

export async function readPushState(): Promise<PushState> {
  if (!(await supported())) return isIOS() && !isStandalone() ? 'ios-install' : 'unsupported';
  if (Notification.permission === 'denied') return 'blocked';
  return Notification.permission === 'granted' && readLocal(PREF_KEY) === 'on' && readLocal(TOKEN_KEY) ? 'on' : 'off';
}

async function swRegistration(): Promise<ServiceWorkerRegistration> {
  const ready = navigator.serviceWorker.ready;
  const timeout = new Promise<never>((_, rej) => setTimeout(() => rej(new Error('서비스 워커가 준비되지 않았습니다. 새로고침한 뒤 다시 눌러 주세요.')), 10000));
  return Promise.race([ready, timeout]);
}

async function fetchToken(): Promise<string> {
  if (USING_EMULATOR) return `emulator-token-${detectDeviceKind()}`;
  return getToken(getMessaging(app), { serviceWorkerRegistration: await swRegistration() });
}

async function saveToken(uid: string, token: string) {
  const id = tokenDocId(token);
  const prev = parseSaved();
  await setDoc(doc(db, 'users', uid, 'v4_pushTokens', id), {
    token,
    device: detectDeviceKind(),
    ua: (navigator.userAgent || '').slice(0, 200),
    updatedAt: Date.now(),
  });
  // 토큰이 바뀌었으면 옛 문서를 지운다 (같은 계정일 때만 - 남의 문서는 규칙상 못 지운다)
  if (prev && prev.uid === uid && prev.id !== id) {
    await deleteDoc(doc(db, 'users', uid, 'v4_pushTokens', prev.id)).catch(() => {});
  }
  writeLocal(TOKEN_KEY, JSON.stringify({ uid, id }));
}

function parseSaved(): { uid: string; id: string } | null {
  try {
    const v = JSON.parse(readLocal(TOKEN_KEY) || 'null');
    return v && typeof v.uid === 'string' && typeof v.id === 'string' ? v : null;
  } catch {
    return null;
  }
}

/** 단추로 켠다 (누른 직후여야 휴대폰이 허용을 묻는다). 실패하면 까닭을 담아 던진다 */
export async function enablePush(): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  const state = await readPushState();
  if (state === 'unsupported') throw new Error('이 브라우저는 앱을 닫았을 때의 알림을 받을 수 없습니다.');
  if (state === 'ios-install') throw new Error('아이폰·아이패드는 사파리 공유(⬆️) → "홈 화면에 추가"로 앱을 설치한 뒤, 설치한 앱에서 켜 주세요.');
  const perm = Notification.permission === 'granted' ? 'granted' : await Notification.requestPermission();
  if (perm !== 'granted') throw new Error('알림이 허용되지 않았습니다. 브라우저(또는 휴대폰) 설정에서 이 사이트의 알림을 허용해 주세요.');
  await saveToken(uid, await fetchToken());
  writeLocal(PREF_KEY, 'on');
}

/** 이 기기에서 끈다 */
export async function disablePush(): Promise<void> {
  writeLocal(PREF_KEY, 'off');
  await forgetThisDevice();
}

async function forgetThisDevice() {
  const saved = parseSaved();
  writeLocal(TOKEN_KEY, null);
  if (saved && auth.currentUser?.uid === saved.uid) {
    await deleteDoc(doc(db, 'users', saved.uid, 'v4_pushTokens', saved.id)).catch(() => {});
  }
  if (!USING_EMULATOR) {
    try {
      if (await isSupported()) await deleteToken(getMessaging(app));
    } catch {
      /* 이미 없으면 그만 */
    }
  }
}

/** 로그아웃 직전에 부른다 - 이 기기 토큰 문서를 지운다(다음 사람이 로그인하면 새로 켜진다) */
export async function forgetPushOnLogout(): Promise<void> {
  const saved = parseSaved();
  writeLocal(TOKEN_KEY, null);
  if (saved && auth.currentUser?.uid === saved.uid) {
    await deleteDoc(doc(db, 'users', saved.uid, 'v4_pushTokens', saved.id)).catch(() => {});
  }
}

/**
 * 앱이 뜰 때(로그인한 뒤) 한 번. 알림이 허용되어 있고 이 기기에서 끈 적이 없으면 토큰을 받아 맞춘다.
 * 창을 띄우지 않는다(허용을 묻지 않는다). 실패는 조용히 넘긴다 - 앱 안의 알림 창은 그대로 돈다.
 */
export async function refreshPushToken(uid: string): Promise<void> {
  try {
    if (readLocal(PREF_KEY) === 'off') return;
    if (!(await supported())) return;
    if (Notification.permission !== 'granted') return;
    const saved = parseSaved();
    if (saved && saved.uid !== uid) writeLocal(TOKEN_KEY, null); // 다른 계정이 쓰던 기기
    await saveToken(uid, await fetchToken());
    writeLocal(PREF_KEY, 'on');
  } catch (e) {
    console.warn('알림 푸시 토큰을 맞추지 못했습니다:', e);
  }
}
