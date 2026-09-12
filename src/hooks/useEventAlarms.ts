import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, getDoc, onSnapshot, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { formatDateStr } from '../lib/dateUtils';

export interface RingingAlarm {
  id: string;
  dateStr: string;
  content: string;
}

// V3의 일정 알림 기능 이식: 일정에 지정된 time(YYYY-MM-DDTHH:mm)이 지나고
// 1시간 이내면 전체화면 알림을 울린다. 브라우저 탭이 열려있는 동안만 동작한다
// (V3와 동일 - 서버 푸시가 아닌 클라이언트 폴링 방식).
function nowYMDHM() {
  const d = new Date();
  return `${formatDateStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const CHECK_INTERVAL_MS = 20000;
const ALARM_WINDOW_MS = 60 * 60 * 1000; // V3와 동일하게 지난 지 1시간 넘은 알림은 무시

export function useEventAlarms() {
  const selectedGroupId = useAppStore((s) => s.selectedGroupId);
  const [ringingAlarms, setRingingAlarms] = useState<RingingAlarm[]>([]);
  const eventListRef = useRef<any[]>([]);
  const dateRef = useRef<string>(formatDateStr());
  const triggeredThisSessionRef = useRef<Set<string>>(new Set());

  // 탭이 백그라운드일 때도 OS 알림을 띄우기 위한 권한 요청 (최초 1회, 이미 결정된 경우 재요청 안 함)
  useEffect(() => {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      Notification.requestPermission().catch(() => {});
    }
  }, []);

  useEffect(() => {
    const user = auth.currentUser;
    if (!user) return;

    let unsub: (() => void) | null = null;
    let cancelled = false;

    const eventDocRefFor = (ds: string) =>
      selectedGroupId
        ? doc(db, 'groups', selectedGroupId, 'events', ds)
        : doc(db, 'users', user.uid, 'events', ds);

    const subscribe = () => {
      if (unsub) unsub();
      const ds = formatDateStr();
      dateRef.current = ds;
      triggeredThisSessionRef.current = new Set();
      unsub = onSnapshot(eventDocRefFor(ds), (snap) => {
        if (cancelled) return;
        const data = snap.exists() ? snap.data() : null;
        eventListRef.current = data && Array.isArray(data.eventList) ? data.eventList : [];
      });
    };
    subscribe();

    const check = async () => {
      // 자정이 지나 날짜가 바뀌면 오늘 날짜 문서로 다시 구독한다.
      if (formatDateStr() !== dateRef.current) {
        subscribe();
        return;
      }

      const nowStr = nowYMDHM();
      const nowMs = Date.now();
      const toTrigger = eventListRef.current.filter((ev) => {
        if (!ev || !ev.time || ev.completed || ev.alarmTriggered) return false;
        if (triggeredThisSessionRef.current.has(ev.id)) return false;
        if (ev.time > nowStr) return false;
        const evMs = new Date(ev.time).getTime();
        if (isNaN(evMs)) return false;
        return nowMs - evMs < ALARM_WINDOW_MS;
      });

      if (toTrigger.length === 0) return;
      toTrigger.forEach((ev) => triggeredThisSessionRef.current.add(ev.id));

      const ds = dateRef.current;
      try {
        const ref = eventDocRefFor(ds);
        const snap = await getDoc(ref);
        if (snap.exists()) {
          const data = snap.data();
          const list: any[] = Array.isArray(data.eventList) ? data.eventList : [];
          let changed = false;
          const updated = list.map((item) => {
            if (toTrigger.some((t) => t.id === item.id)) {
              changed = true;
              return { ...item, alarmTriggered: true };
            }
            return item;
          });
          if (changed) {
            await setDoc(ref, { eventList: updated, updatedAt: Date.now() }, { merge: true });
          }
        }
      } catch (err) {
        console.error('알림 확인 처리 반영 실패:', err);
      }

      setRingingAlarms((prev) => {
        const existingIds = new Set(prev.map((p) => p.id));
        const added = toTrigger
          .filter((t) => !existingIds.has(t.id))
          .map((t) => ({ id: t.id, dateStr: ds, content: t.content || '예정된 일정이 있습니다.' }));
        return added.length > 0 ? [...prev, ...added] : prev;
      });

      // 탭이 화면에 보이지 않을 때만 OS 알림도 함께 띄운다 (보일 때는 전체화면 팝업으로 충분).
      if (
        typeof document !== 'undefined' &&
        document.hidden &&
        typeof Notification !== 'undefined' &&
        Notification.permission === 'granted'
      ) {
        toTrigger.forEach((ev) => {
          try {
            const n = new Notification('⏰ 일정 알림', {
              body: ev.content || '예정된 일정이 있습니다.',
              tag: `sp4-alarm-${ev.id}`,
            });
            n.onclick = () => {
              window.focus();
              n.close();
            };
          } catch (err) {
            console.error('OS 알림 표시 실패:', err);
          }
        });
      }
    };

    const initialTimeout = setTimeout(check, 3000);
    const interval = setInterval(check, CHECK_INTERVAL_MS);

    return () => {
      cancelled = true;
      if (unsub) unsub();
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
    // auth.currentUser는 그 자체로 반응형 값이 아니므로, Firebase 인증이 늦게 끝나
    // (앱 최초 로딩 시 이 훅이 로그인 완료 전에 먼저 마운트되는 경우) 이 effect가 다시
    // 실행되도록 uid를 의존성에 명시한다. useDayData.ts와 동일한 패턴.
  }, [selectedGroupId, auth.currentUser?.uid]);

  const dismissAlarms = useCallback(() => {
    setRingingAlarms([]);
  }, []);

  return { ringingAlarms, dismissAlarms };
}
