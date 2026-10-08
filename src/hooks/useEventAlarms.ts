import { useCallback, useEffect, useRef, useState } from 'react';
import { doc, onSnapshot, runTransaction } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { formatDateStr } from '../lib/dateUtils';
import { eventDocPayload, readEventList } from '../lib/eventText';
import { wakeAudioOnGesture } from '../lib/sound';
import { refreshPushToken } from '../lib/push';

export interface RingingAlarm {
  id: string;
  dateStr: string;
  content: string;
}

// 일정 알림: 일정에 지정된 time(YYYY-MM-DDTHH:mm)이 지나고 1시간 이내면 전체화면 알림을 울린다.
// 두 길로 온다 (2026-10-08 서버 푸시를 더함):
//   1) 서버 푸시 - functions/index.js가 알림 시각에 FCM으로 보내고, 서비스 워커(public/sw.js)가 이 창을 보고 있으면
//      'sp4-event-alarm' 메시지로 넘긴다. 앱을 보고 있는 기기는 모두 울린다. 닫혀 있으면 서비스 워커가 휴대폰·PC 알림을 띄운다.
//   2) 이 탭이 20초마다 오늘 일정 문서를 보는 것 - 푸시를 못 받는 기기(알림을 허용하지 않음)를 위한 예비.
//      먼저 울린 기기가 alarmTriggered를 써서 다른 기기의 이 길은 건너뛴다(푸시는 alarmTriggered와 상관없이 간다).
// 같은 일정은 한 번만 울린다(triggeredThisSessionRef).
function nowYMDHM() {
  const d = new Date();
  return `${formatDateStr(d)}T${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

const CHECK_INTERVAL_MS = 20000;
const ALARM_WINDOW_MS = 60 * 60 * 1000; // V3와 동일하게 지난 지 1시간 넘은 알림은 무시

/** 울린 일정에 alarmTriggered를 쓴다 (트랜잭션 - 20초마다 도는 일이 편집 중인 내용을 덮지 않게) */
async function markTriggered(path: string, ids: string[]) {
  const ref = doc(db, path);
  await runTransaction(db, async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists()) return;
    const list: any[] = readEventList(snap.data());
    let changed = false;
    const updated = list.map((item) => {
      if (ids.includes(String(item.id)) && !item.alarmTriggered) {
        changed = true;
        return { ...item, alarmTriggered: true };
      }
      return item;
    });
    if (changed) tx.set(ref, eventDocPayload(updated), { merge: true });
  });
}

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

  // 알림 소리(EventAlarmPopup): 브라우저는 이 페이지를 한 번 누르기 전에는 소리를 막는다 - 처음 누를 때 소리 장치를 깨워 둔다
  useEffect(() => wakeAudioOnGesture(), []);

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
        // readEventList: id 없는 V3 항목에도 저장 쪽과 같은 id(ev_차례)가 붙어야 '울림' 표시를 제자리에 쓴다
        eventListRef.current = data ? readEventList(data) : [];
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
        await markTriggered(eventDocRefFor(ds).path, toTrigger.map((t) => String(t.id)));
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

  // 서버 푸시: 이 기기 토큰을 맞추고(허용되어 있을 때만, 창 없이), 서비스 워커가 넘기는 알림을 울린다
  const uid = auth.currentUser?.uid;
  useEffect(() => {
    if (!uid) return;
    void refreshPushToken(uid);
    if (typeof navigator === 'undefined' || !navigator.serviceWorker) return;
    const onMessage = (e: MessageEvent) => {
      const m = e.data;
      if (!m || m.type !== 'sp4-event-alarm' || !m.alarm?.id) return;
      const a = m.alarm as { id: string; content?: string; path?: string };
      if (triggeredThisSessionRef.current.has(a.id)) return;
      triggeredThisSessionRef.current.add(a.id);
      const dateStr = (a.path || '').split('/').pop() || formatDateStr();
      setRingingAlarms((prev) =>
        prev.some((p) => p.id === a.id) ? prev : [...prev, { id: a.id, dateStr, content: a.content || '예정된 일정이 있습니다.' }]
      );
      if (a.path) markTriggered(a.path, [a.id]).catch((err) => console.error('알림 확인 처리 반영 실패:', err));
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, [uid]);

  const dismissAlarms = useCallback(() => {
    setRingingAlarms([]);
  }, []);

  return { ringingAlarms, dismissAlarms };
}
