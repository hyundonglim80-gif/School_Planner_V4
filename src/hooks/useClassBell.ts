// src/hooks/useClassBell.ts
//
// 수업 종 (lib/classBell) - 설정을 읽고 쓰고, Layout에서 한 번 걸어 교시 시각에 종을 울린다.
// 소리는 lib/sound(Web Audio, 파일 없이). 브라우저는 사용자가 한 번 누르기 전에는 소리를 막으므로, 처음 누르거나 키를 칠 때 소리 장치를 깨워 둔다.
// 앱(탭)이 열려 있을 때만 울린다 - 닫혀 있으면 울리지 않는다(설명서에 적었다).
import { useEffect, useRef, useState } from 'react';
import { doc, setDoc } from 'firebase/firestore';
import { auth, db } from '../lib/firebase';
import { subscribeDocWithServerFallback } from '../lib/firestoreSubscribe';
import { BELL_MUTE_KEY, DEFAULT_BELL, bellDay, bellMessage, bellTimes, bellsDue, sanitizeBell, type ClassBellSettings } from '../lib/classBell';
import { usePeriodTimes } from './usePeriodTimes';
import { showToast } from '../utils/toast';
import { playBell, wakeAudioOnGesture } from '../lib/sound';

const bellRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_classBell');

export function useClassBellSettings(): { bell: ClassBellSettings; loaded: boolean } {
  const [state, setState] = useState({ bell: DEFAULT_BELL, loaded: false });
  const uid = auth.currentUser?.uid;
  useEffect(() => {
    if (!uid) return;
    return subscribeDocWithServerFallback(
      bellRef(uid),
      (data) => setState({ bell: sanitizeBell(data), loaded: true }),
      (err) => console.warn('수업 종 설정을 불러오지 못했습니다:', err)
    );
  }, [uid]);
  return state;
}

/** 통째로 쓴다 (이 문서에는 이것뿐). 실패하면 던진다 */
export async function saveClassBell(bell: ClassBellSettings): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  await setDoc(bellRef(uid), { ...sanitizeBell(bell), updatedAt: Date.now() });
}

export function isBellMutedHere(): boolean {
  try {
    return localStorage.getItem(BELL_MUTE_KEY) === '1';
  } catch {
    return false;
  }
}
export function setBellMutedHere(muted: boolean) {
  try {
    if (muted) localStorage.setItem(BELL_MUTE_KEY, '1');
    else localStorage.removeItem(BELL_MUTE_KEY);
  } catch {
    /* 시크릿 모드 등 */
  }
}

// 소리는 lib/sound (일정 알림과 함께 쓴다). ClassBellPanel이 이 자리에서 가져가므로 다시 내보낸다
export { playBell };

const secOfDay = (d: Date) => d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();

/** Layout에서 한 번. 교시 시각에 맞춰 종을 울리고 안내를 띄운다 */
export function useClassBellRunner(periodNames: string[] = []) {
  const { bell } = useClassBellSettings();
  const { times } = usePeriodTimes();
  const prevRef = useRef<number>(secOfDay(new Date()));
  const listRef = useRef(bellTimes(times, bell));
  listRef.current = bellTimes(times, bell);
  const cfgRef = useRef(bell);
  cfgRef.current = bell;
  const namesRef = useRef(periodNames);
  namesRef.current = periodNames;

  // 처음 누르거나 키를 칠 때 소리 장치를 깨운다 (브라우저가 그 전에는 소리를 막는다)
  useEffect(() => {
    if (!bell.enabled) return;
    return wakeAudioOnGesture();
  }, [bell.enabled]);

  useEffect(() => {
    if (!bell.enabled) return;
    prevRef.current = secOfDay(new Date());
    const id = setInterval(() => {
      const now = new Date();
      const sec = secOfDay(now);
      const prev = prevRef.current;
      prevRef.current = sec;
      if (!bellDay(cfgRef.current, now) || isBellMutedHere()) return;
      const due = bellsDue(listRef.current, prev, sec);
      if (due.length === 0) return;
      playBell();
      const b = due[due.length - 1];
      const msg = `🔔 ${bellMessage(b, cfgRef.current, namesRef.current[b.period - 1])}`;
      (window as any).__spBellLast = msg; // 점검이 본다 (안내는 몇 초 뒤 사라진다)
      showToast(msg);
    }, 1000);
    return () => clearInterval(id);
  }, [bell.enabled]);
}
