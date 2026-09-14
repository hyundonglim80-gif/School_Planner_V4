import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import ModalShell, { ModalCloseButton } from './ModalShell';
import DetailEditModal from './DetailEditModal';
import { moveToTrash } from '../utils/trashHelper';
import { eventContentOf, eventDocPayload, readEventList } from '../lib/eventText';

interface ForwardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ForwardEvent {
  dateStr: string;
  event: any;
  eventIdx: number;
  // 💡 배열 인덱스는 안정적인 참조가 아니다. 스캔 이후 이월 로직 등이 목록을 바꾸면
  // 인덱스가 밀려서 엉뚱한 일정이 삭제/완료 처리됐다. ID가 있으면 ID로 찾는다.
  eventId: string | null;
}

function formatDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export default function ForwardingModal({ isOpen, onClose }: ForwardingModalProps) {
  const { selectedGroupId } = useAppStore();
  const [incompleteEvents, setIncompleteEvents] = useState<ForwardEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [completingKeys, setCompletingKeys] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<{ dateStr: string; itemId: string; initialData: any } | null>(null);

  const itemKey = (item: ForwardEvent) => `${item.dateStr}_${item.eventId ?? item.eventIdx}`;

  const isSameItem = (a: ForwardEvent, b: ForwardEvent) =>
    a.dateStr === b.dateStr && itemKey(a) === itemKey(b);

  // 저장된 최신 목록에서 이 항목의 현재 위치를 찾는다.
  // ID가 있는데 목록에 없다면 이미 사라진 항목이므로, 인덱스로 추측하지 않고 -1을 준다.
  const findIndexFor = (list: any[], item: ForwardEvent): number => {
    if (item.eventId) return list.findIndex((e: any) => String(e?.id) === item.eventId);
    return item.eventIdx < list.length ? item.eventIdx : -1;
  };

  useEffect(() => {
    if (isOpen) scanIncompleteEvents();
  }, [isOpen]);

  const scanIncompleteEvents = async () => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    const today = new Date();
    const incomplete: ForwardEvent[] = [];

    // 지난 7일간 스캔
    for (let i = 1; i <= 7; i++) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);
      const dateStr = formatDate(d);

      try {
        const colPath = selectedGroupId && selectedGroupId !== 'personal'
          ? `groups/${selectedGroupId}/events`
          : `users/${uid}/events`;
        const snap = await getDoc(doc(db, colPath, dateStr));
        if (snap.exists()) {
          const eventList = readEventList(snap.data());
          eventList.forEach((ev: any, idx: number) => {
            // '전달' 또는 'forward' 라벨이 있고 미완료인 일정
            const hasForwardLabel = (ev.labelIds || []).some((l: string) =>
              ['전달', 'forward', '미완료'].includes(l.toLowerCase())
            );
            if (hasForwardLabel && !ev.completed) {
              incomplete.push({ dateStr, event: ev, eventIdx: idx, eventId: ev.id ? String(ev.id) : null });
            }
          });
        }
      } catch (e) {
        console.error(e);
      }
    }

    setIncompleteEvents(incomplete);
    setLoading(false);
  };

  const handleForwardAll = async () => {
    if (incompleteEvents.length === 0) return alert('전달할 미완료 일정이 없습니다.');
    if (!confirm(`${incompleteEvents.length}개의 미완료 일정을 오늘 날짜로 전달하시겠습니까?`)) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setProcessing(true);

    try {
      const todayStr = formatDate(new Date());
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;

      // 오늘 일정 로드
      const todaySnap = await getDoc(doc(db, colPath, todayStr));
      const todayEvents = todaySnap.exists() ? readEventList(todaySnap.data()) : [];

      // 목록에 잡힌 항목만 오늘로 복사하고, 제거 대상으로 날짜별로 묶어둔다
      const byDate: Record<string, ForwardEvent[]> = {};
      for (const item of incompleteEvents) {
        todayEvents.push({
          ...item.event,
          id: 'fwd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          forwardedFrom: item.dateStr,
        });
        if (!byDate[item.dateStr]) byDate[item.dateStr] = [];
        byDate[item.dateStr].push(item);
      }

      // 오늘 일정 저장 (eventText도 함께 갱신해야 읽기 폴백이 옛 내용을 되살리지 않는다)
      await setDoc(doc(db, colPath, todayStr), eventDocPayload(todayEvents), { merge: true });

      // 원본 날짜에서 제거.
      // 💡 예전에는 조건에 맞는 "모든" 항목을 다시 걸러서 지웠기 때문에, 스캔 이후에
      // 추가된 일정이 오늘로 옮겨지지도, 휴지통에 가지도 않고 그냥 사라졌다.
      for (const dateStr of Object.keys(byDate)) {
        const snap = await getDoc(doc(db, colPath, dateStr));
        if (!snap.exists()) continue;
        const list = readEventList(snap.data());
        const removeIdx = new Set<number>();
        for (const item of byDate[dateStr]) {
          const idx = findIndexFor(list, item);
          if (idx >= 0) removeIdx.add(idx);
        }
        if (removeIdx.size === 0) continue;
        const updated = list.filter((_: any, i: number) => !removeIdx.has(i));
        await setDoc(doc(db, colPath, dateStr), eventDocPayload(updated), { merge: true });
      }

      showToast(`✅ ${incompleteEvents.length}개의 일정을 오늘(${todayStr})로 전달했습니다.`);
      setIncompleteEvents([]);
    } catch (e: any) {
      console.error(e);
      alert('전달 처리 중 오류: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteForwarded = async (item: ForwardEvent) => {
    if (!confirm(`"${eventContentOf(item.event)}" 일정을 삭제하시겠습니까?`)) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;
      const snap = await getDoc(doc(db, colPath, item.dateStr));
      if (snap.exists()) {
        const eventList = readEventList(snap.data());
        const idx = findIndexFor(eventList, item);
        if (idx < 0) {
          alert('이미 변경되었거나 삭제된 일정입니다. 목록을 다시 스캔합니다.');
          await scanIncompleteEvents();
          return;
        }
        const itemToDelete: any = eventList[idx];
        try {
          await moveToTrash({
            id: String(itemToDelete.id ?? item.eventIdx),
            type: 'event',
            originalDateStr: item.dateStr,
            fId: selectedGroupId || 'personal',
            content: eventContentOf(itemToDelete) || eventContentOf(item.event),
            data: itemToDelete,
          });
        } catch (trashErr) {
          console.error('휴지통 이동 실패:', trashErr);
        }
        const updatedList = eventList.filter((_: any, i: number) => i !== idx);
        await setDoc(doc(db, colPath, item.dateStr), eventDocPayload(updatedList), { merge: true });
      }
      setIncompleteEvents(prev => prev.filter(e => !isSameItem(e, item)));
    } catch (e: any) {
      alert('삭제 중 오류: ' + e.message);
    }
  };

  // 라벨 클릭 시 완료 처리 (체크 효과 후 목록에서 제거)
  const handleToggleComplete = async (item: ForwardEvent) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const key = itemKey(item);
    setCompletingKeys(prev => new Set(prev).add(key));

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;
      const snap = await getDoc(doc(db, colPath, item.dateStr));
      if (snap.exists()) {
        const eventList = readEventList(snap.data());
        const idx = findIndexFor(eventList, item);
        if (idx >= 0) {
          eventList[idx] = { ...eventList[idx], completed: true };
          await setDoc(doc(db, colPath, item.dateStr), eventDocPayload(eventList), { merge: true });
        }
      }
      setTimeout(() => {
        setIncompleteEvents(prev => prev.filter(e => !isSameItem(e, item)));
        setCompletingKeys(prev => {
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }, 450);
    } catch (e: any) {
      setCompletingKeys(prev => {
        const next = new Set(prev);
        next.delete(key);
        return next;
      });
      alert('완료 처리 중 오류: ' + e.message);
    }
  };

  if (!isOpen) return null;

  return (
    <>
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="md"
      title="📤 미완료 일정 전달"
      bare
      footer={
        <>
          <button onClick={scanIncompleteEvents} className="mr-auto px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold">다시 스캔</button>
          <ModalCloseButton onClose={onClose} />
          {incompleteEvents.length > 0 && (
            <button onClick={handleForwardAll} disabled={processing} className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs">
              {processing ? '처리 중...' : `오늘로 전달 (${incompleteEvents.length}건)`}
            </button>
          )}
        </>
      }
    >
      <div>
        <div className="px-5 py-3">
          <div className="bg-amber-50 border border-amber-100 rounded-xl p-3 text-xs text-amber-800">
            <strong>안내:</strong> '전달' 라벨이 있는 미완료 일정을 오늘 날짜로 자동 이동합니다.<br />
            지난 7일간의 미완료 일정을 스캔합니다.
          </div>
        </div>

        <div className="flex-1 min-h-0 overflow-y-auto overscroll-contain px-6 py-2" data-scroll-lock>
          {loading ? (
            <p className="text-center text-slate-400 text-xs py-8">스캔 중...</p>
          ) : incompleteEvents.length === 0 ? (
            <div className="text-center py-12">
              <div className="text-3xl mb-3">✅</div>
              <p className="text-slate-500 font-bold text-sm">전달할 미완료 일정이 없습니다.</p>
              <p className="text-slate-400 text-xs mt-1">모든 일정이 완료되었습니다!</p>
            </div>
          ) : (
            <div className="space-y-2">
              {incompleteEvents.map((item, idx) => {
                const isCompleting = completingKeys.has(itemKey(item));
                return (
                  <div
                    key={`${itemKey(item)}_${idx}`}
                    className={`flex items-center justify-between p-3 border rounded-xl transition-colors duration-300 ${
                      isCompleting ? 'bg-emerald-50 border-emerald-200' : 'bg-slate-50 border-slate-200'
                    }`}
                  >
                    <div
                      className="flex-1 min-w-0 cursor-pointer"
                      onClick={() =>
                        setDetailItem({ dateStr: item.dateStr, itemId: String(item.event.id), initialData: item.event })
                      }
                    >
                      <p className={`text-sm font-bold truncate transition-colors ${isCompleting ? 'text-emerald-600 line-through' : 'text-slate-800'}`}>
                        {isCompleting && <span className="mr-1">✅</span>}
                        {eventContentOf(item.event)}
                      </p>
                      <div className="flex items-center gap-1.5 mt-1 flex-wrap">
                        <span className="text-xs text-slate-400">{item.dateStr}</span>
                        {(item.event.labelIds || []).map((labelId: string) => (
                          <button
                            key={labelId}
                            type="button"
                            title="클릭하면 완료 처리됩니다"
                            disabled={isCompleting}
                            onClick={(e) => {
                              e.stopPropagation();
                              handleToggleComplete(item);
                            }}
                            className="text-[11px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 font-bold transition-colors disabled:opacity-60 cursor-pointer"
                          >
                            {labelId}
                          </button>
                        ))}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteForwarded(item)}
                      className="text-slate-300 hover:text-red-500 text-xs font-bold p-1 shrink-0"
                    >
                      ✕
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </ModalShell>

    {detailItem && (
      <DetailEditModal
        isOpen={true}
        onClose={() => {
          setDetailItem(null);
          scanIncompleteEvents();
        }}
        type="event"
        dateStr={detailItem.dateStr}
        itemId={detailItem.itemId}
        initialData={detailItem.initialData}
      />
    )}
    </>
  );
}
