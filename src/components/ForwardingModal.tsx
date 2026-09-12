import React, { useState, useEffect } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { useAppStore } from '../store/useAppStore';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';
import DetailEditModal from './DetailEditModal';
import { moveToTrash } from '../utils/trashHelper';

interface ForwardingModalProps {
  isOpen: boolean;
  onClose: () => void;
}

interface ForwardEvent {
  dateStr: string;
  event: any;
  eventIdx: number;
}

function formatDate(d: Date): string {
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
}

export default function ForwardingModal({ isOpen, onClose }: ForwardingModalProps) {
  useBodyScrollLock(isOpen);

  const vv = useVisualViewport(isOpen);

  const zIndex = useModalLayer(isOpen, onClose);
  const { selectedGroupId } = useAppStore();
  const [incompleteEvents, setIncompleteEvents] = useState<ForwardEvent[]>([]);
  const [loading, setLoading] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [completingKeys, setCompletingKeys] = useState<Set<string>>(new Set());
  const [detailItem, setDetailItem] = useState<{ dateStr: string; itemId: string; initialData: any } | null>(null);

  const itemKey = (item: ForwardEvent) => `${item.dateStr}_${item.eventIdx}`;

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
          const data = snap.data();
          const eventList = data.eventList || [];
          eventList.forEach((ev: any, idx: number) => {
            // '전달' 또는 'forward' 라벨이 있고 미완료인 일정
            const hasForwardLabel = (ev.labelIds || []).some((l: string) =>
              ['전달', 'forward', '미완료'].includes(l.toLowerCase())
            );
            if (hasForwardLabel && !ev.completed) {
              incomplete.push({ dateStr, event: ev, eventIdx: idx });
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

    setProcessing(true);
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      const todayStr = formatDate(new Date());
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;

      // 오늘 일정 로드
      const todaySnap = await getDoc(doc(db, colPath, todayStr));
      const todayData = todaySnap.exists() ? todaySnap.data() : {};
      const todayEvents = todayData.eventList || [];

      // 원본에서 제거 및 오늘로 이동
      const processedDates = new Set<string>();
      for (const item of incompleteEvents) {
        // 오늘 일정에 추가
        todayEvents.push({
          ...item.event,
          id: 'fwd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
          forwardedFrom: item.dateStr,
        });
        processedDates.add(item.dateStr);
      }

      // 오늘 일정 저장
      await setDoc(doc(db, colPath, todayStr), { ...todayData, eventList: todayEvents, updatedAt: Date.now() }, { merge: true });

      // 원본 날짜에서 전달된 일정 제거
      for (const dateStr of processedDates) {
        const snap = await getDoc(doc(db, colPath, dateStr));
        if (snap.exists()) {
          const data = snap.data();
          const eventList = (data.eventList || []).filter((ev: any) => {
            const hasForwardLabel = (ev.labelIds || []).some((l: string) =>
              ['전달', 'forward', '미완료'].includes(l.toLowerCase())
            );
            return !(hasForwardLabel && !ev.completed);
          });
          await setDoc(doc(db, colPath, dateStr), { ...data, eventList, updatedAt: Date.now() }, { merge: true });
        }
      }

      alert(`✅ ${incompleteEvents.length}개의 일정이 오늘(${todayStr})로 전달되었습니다.`);
      setIncompleteEvents([]);
      onClose();
    } catch (e: any) {
      console.error(e);
      alert('전달 처리 중 오류: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  const handleDeleteForwarded = async (item: ForwardEvent) => {
    if (!confirm(`"${item.event.text}" 일정을 삭제하시겠습니까?`)) return;
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      const colPath = selectedGroupId && selectedGroupId !== 'personal'
        ? `groups/${selectedGroupId}/events`
        : `users/${uid}/events`;
      const snap = await getDoc(doc(db, colPath, item.dateStr));
      if (snap.exists()) {
        const data = snap.data();
        const eventList = data.eventList || [];
        const itemToDelete = eventList[item.eventIdx];
        if (itemToDelete) {
          try {
            await moveToTrash({
              id: String(itemToDelete.id ?? item.eventIdx),
              type: 'event',
              originalDateStr: item.dateStr,
              fId: selectedGroupId || 'personal',
              content: itemToDelete.text || itemToDelete.content || item.event.text,
              data: itemToDelete,
            });
          } catch (trashErr) {
            console.error('휴지통 이동 실패:', trashErr);
          }
        }
        const updatedList = eventList.filter((_: any, i: number) => i !== item.eventIdx);
        await setDoc(doc(db, colPath, item.dateStr), { ...data, eventList: updatedList, updatedAt: Date.now() }, { merge: true });
      }
      setIncompleteEvents(prev => prev.filter(e => !(e.dateStr === item.dateStr && e.eventIdx === item.eventIdx)));
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
        const data = snap.data();
        const eventList = data.eventList || [];
        if (eventList[item.eventIdx]) {
          eventList[item.eventIdx] = { ...eventList[item.eventIdx], completed: true };
          await setDoc(doc(db, colPath, item.dateStr), { ...data, eventList, updatedAt: Date.now() }, { merge: true });
        }
      }
      setTimeout(() => {
        setIncompleteEvents(prev => prev.filter(e => !(e.dateStr === item.dateStr && e.eventIdx === item.eventIdx)));
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
    <div className="fixed inset-0 flex items-center justify-center overflow-y-auto bg-black/40 backdrop-blur-sm animate-fade-in" style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }} onClick={closeAllModals}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-full flex flex-col border border-slate-200" onClick={e => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
          <h3 className="text-lg font-black text-slate-800">📤 미완료 일정 전달</h3>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-700 text-xl font-bold">✕</button>
        </div>

        <div className="px-6 py-3">
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
                    key={idx}
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
                        {item.event.text}
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
                            className="text-[16.5px] px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 font-bold transition-colors disabled:opacity-60 cursor-pointer"
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

        <div className="flex items-center justify-between px-6 py-3.5 border-t border-slate-100 bg-slate-50">
          <button onClick={scanIncompleteEvents} className="px-3 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold">다시 스캔</button>
          <div className="flex gap-2">
            <button onClick={onClose} className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold">닫기</button>
            {incompleteEvents.length > 0 && (
              <button onClick={handleForwardAll} disabled={processing} className="px-5 py-2 bg-primary text-white rounded-xl text-xs font-bold shadow-xs">
                {processing ? '처리 중...' : `오늘로 전달 (${incompleteEvents.length}건)`}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>

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
