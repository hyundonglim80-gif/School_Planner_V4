import React, { useState, useEffect, Suspense } from 'react';
import { doc, collection, getDocs, query, where, documentId, runTransaction } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import { showToast, showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import ModalShell, { ModalCloseButton } from './ModalShell';
import { lazyWithReload } from '../lib/lazyWithReload';
import { eventContentOf, readEventList } from '../lib/eventText';
import { pastDateStrings, isForwardTarget } from '../lib/forwarding';
import { useLabels } from '../hooks/useLabels';
import { resolveEventLabelNames } from '../lib/eventLabels';
import { addReverseLink } from '../utils/linkUtils';
import { updateEventInDoc, deleteEventFromDoc, TrashFailedError } from '../lib/eventDocOps';
import { showDeletedToast } from '../lib/undoToast';
import { setEventDoc } from '../lib/gcalNote';

// Layout도 같은 편집기를 따로 불러온다. 여기서 곧바로 불러오면 분리가 무너져
// 편집기가 첫 화면 묶음에 함께 실려 온다. 그래서 여기서도 필요할 때 불러온다.
const DetailEditModal = lazyWithReload(() => import('./DetailEditModal'));

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
  const { selectedGroupId, forwardLookbackDays } = useAppStore();
  const { eventLabels, labelsLoaded } = useLabels();
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

  // 라벨을 다 읽은 뒤에 훑는다. 라벨을 모르는 채 판단하면 이월 대상을 놓친다(자동 이월과 같은 이유).
  useEffect(() => {
    if (isOpen && labelsLoaded) scanIncompleteEvents();
  }, [isOpen, labelsLoaded]);

  const spaceColPath = (uid: string) =>
    selectedGroupId && selectedGroupId !== 'personal' ? `groups/${selectedGroupId}/events` : `users/${uid}/events`;

  const scanIncompleteEvents = async () => {
    setLoading(true);
    const uid = auth.currentUser?.uid;
    if (!uid) { setLoading(false); return; }

    const today = new Date();
    const incomplete: ForwardEvent[] = [];
    // 훑는 기간은 자동 이월과 같은 값을 쓴다 (환경설정 > 이월)
    const days = pastDateStrings(today, forwardLookbackDays);
    const inWindow = new Set(days);
    try {
      // 날짜마다 따로 읽지 않고 한 번의 범위 조회로 읽는다 (60일이면 60번 읽던 것)
      const snaps = await getDocs(
        query(
          collection(db, spaceColPath(uid)),
          where(documentId(), '>=', days[days.length - 1]),
          where(documentId(), '<', formatDate(today))
        )
      );
      snaps.forEach((snap) => {
        const dateStr = snap.id;
        if (!inWindow.has(dateStr)) return;
        readEventList(snap.data()).forEach((ev: any, idx: number) => {
          // ⚠️ 예전에는 라벨 id가 '전달'·'forward'·'미완료'라는 글자인지를 봤다. 라벨 id는 ev_3 같은 값이라
          //    거의 아무것도 못 찾았다. 설명서대로 자동 이월과 같은 판단(속성·라벨)으로 '이월 대상'을 고른다.
          if (!ev.completed && eventContentOf(ev) && isForwardTarget(ev, eventLabels)) {
            incomplete.push({ dateStr, event: ev, eventIdx: idx, eventId: ev.id ? String(ev.id) : null });
          }
        });
      });
    } catch (e) {
      console.error(e);
      showErrorToast('지난 일정을 읽지 못했습니다. 연결을 확인해 주세요.', e);
    }

    incomplete.sort((x, y) => (x.dateStr < y.dateStr ? -1 : x.dateStr > y.dateStr ? 1 : x.eventIdx - y.eventIdx));
    setIncompleteEvents(incomplete);
    setLoading(false);
  };

  const handleForwardAll = async () => {
    if (incompleteEvents.length === 0) return showErrorToast('전달할 미완료 일정이 없습니다.');
    if (!confirm(`${incompleteEvents.length}개의 미완료 일정을 오늘 날짜로 전달하시겠습니까?`)) return;

    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setProcessing(true);

    try {
      const todayStr = formatDate(new Date());
      const colPath = spaceColPath(uid);
      const fId = selectedGroupId || 'personal';
      const todayRef = doc(db, colPath, todayStr);

      // 옮길 것마다 새 id를 미리 정해 둔다 (트랜잭션이 다시 돌아도 같은 id로)
      const moves = incompleteEvents.map((item) => ({
        item,
        newId: 'fwd_' + Date.now().toString(36) + '_' + Math.random().toString(36).slice(2, 6),
      }));

      // 1. 오늘 문서: 트랜잭션으로 서버의 지금 목록에 얹는다.
      //    예전엔 캐시로 읽은 오늘 목록에 얹어 통째로 써서, 그 사이 오늘에 더한 일정을 덮을 수 있었다.
      await runTransaction(db, async (tx) => {
        const snap = await tx.get(todayRef);
        const todayEvents = snap.exists() ? readEventList(snap.data()) : [];
        const have = new Set(todayEvents.map((e: any) => String(e.id)));
        for (const { item, newId } of moves) {
          if (have.has(newId)) continue;
          todayEvents.push({ ...item.event, id: newId, forwardedFrom: item.dateStr });
        }
        setEventDoc(tx, todayRef, todayEvents);
      });

      // 2. 원본 날짜에서 옮긴 것만 뺀다 (날짜마다 트랜잭션).
      // 💡 예전에는 조건에 맞는 "모든" 항목을 다시 걸러서 지웠기 때문에, 스캔 이후에
      // 추가된 일정이 오늘로 옮겨지지도, 휴지통에 가지도 않고 그냥 사라졌다.
      const byDate: Record<string, ForwardEvent[]> = {};
      for (const { item } of moves) (byDate[item.dateStr] ||= []).push(item);
      for (const dateStr of Object.keys(byDate)) {
        const ref = doc(db, colPath, dateStr);
        await runTransaction(db, async (tx) => {
          const snap = await tx.get(ref);
          if (!snap.exists()) return;
          const list = readEventList(snap.data());
          const removeIdx = new Set<number>();
          for (const item of byDate[dateStr]) {
            const idx = findIndexFor(list, item);
            if (idx >= 0) removeIdx.add(idx);
          }
          if (removeIdx.size === 0) return;
          setEventDoc(tx, ref, list.filter((_: any, i: number) => !removeIdx.has(i)));
        });
      }

      // 3. 연결된 기록·메모·수업 쪽 역링크를 새 id로 갈아끼운다 (자동 이월과 같다). 안 하면 끊어진 링크가 된다.
      for (const { item, newId } of moves) {
        const links: any[] = item.event?.linkedItems || [];
        if (links.length === 0) continue;
        const sourceMeta = {
          targetType: 'event',
          targetId: newId,
          targetDate: todayStr,
          title: `[${todayStr}] ${eventContentOf(item.event)}`,
          targetFId: fId,
        };
        for (const link of links) {
          await addReverseLink(link, sourceMeta as any, fId, { replaceIds: item.eventId ? [item.eventId] : [] });
        }
      }

      showToast(`✅ ${incompleteEvents.length}개의 일정을 오늘(${todayStr})로 전달했습니다.`);
      setIncompleteEvents([]);
    } catch (e: any) {
      console.error(e);
      showErrorToast('전달 처리 중 오류: ' + e.message);
    } finally {
      setProcessing(false);
    }
  };

  // 한 건 삭제는 묻지 않는다. 휴지통으로 가므로 되돌릴 수 있고, 그 안내는 토스트로 나간다.
  const handleDeleteForwarded = async (item: ForwardEvent) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;

    try {
      if (!item.eventId) {
        showToast('이미 변경되었거나 삭제된 일정입니다. 목록을 다시 스캔합니다.');
        await scanIncompleteEvents();
        return;
      }
      // 휴지통에 먼저 넣고, 서버의 지금 목록에서 그 항목만 뺀다 (lib/eventDocOps).
      // 예전엔 캐시로 읽어 통째로 썼고, 휴지통에 못 넣어도 지웠다.
      const trashId = await deleteEventFromDoc(doc(db, spaceColPath(uid), item.dateStr), {
        dateStr: item.dateStr,
        fId: selectedGroupId || 'personal',
        eventId: item.eventId,
      });
      setIncompleteEvents(prev => prev.filter(e => !isSameItem(e, item)));
      showDeletedToast('🗑️ 일정을 삭제했습니다. 휴지통에서 복원할 수 있습니다.', trashId);
    } catch (e: any) {
      showErrorToast(
        e instanceof TrashFailedError
          ? '휴지통에 옮기지 못해 일정을 지우지 않았습니다. 네트워크를 확인해 주세요.'
          : '삭제 중 오류: ' + e.message,
        e
      );
    }
  };

  // 라벨 클릭 시 완료 처리 (체크 효과 후 목록에서 제거)
  const handleToggleComplete = async (item: ForwardEvent) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    const key = itemKey(item);
    setCompletingKeys(prev => new Set(prev).add(key));

    try {
      // 트랜잭션으로 서버의 지금 목록에서 그 일정만 완료로 (lib/eventDocOps)
      if (item.eventId) {
        await updateEventInDoc(doc(db, spaceColPath(uid), item.dateStr), item.eventId, (ev) => ({ ...ev, completed: true }));
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
      showErrorToast('완료 처리 중 오류: ' + e.message);
    }
  };

  if (!isOpen) return null;

  return (
    <>
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      // Ctrl+S = 저장 단추 (누를 수 없을 때는 하지 않는다)
      onSave={() => { if (!processing) void handleForwardAll(); }}
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
            <strong>안내:</strong> 이월 대상(이월 속성이 켜졌거나 이월 라벨이 붙은) 미완료 일정을 오늘 날짜로 옮깁니다.<br />
            지난 {forwardLookbackDays}일간의 미완료 일정을 스캔합니다. 라벨을 누르면 완료, 🗑️는 휴지통으로.
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
                        {/* 라벨 이름으로 보인다. 예전엔 labelIds(ev_3 같은 id)를 그대로 보여 줬고, 라벨 없이 이월 속성만
                            켠 일정은 누를 칩이 없어 완료할 수 없었다 */}
                        {(() => {
                          const names = resolveEventLabelNames(item.event, eventLabels);
                          return (names.length > 0 ? names : ['완료']).map((name) => (
                            <button
                              key={name}
                              type="button"
                              title="클릭하면 완료 처리됩니다"
                              disabled={isCompleting}
                              onClick={(e) => {
                                e.stopPropagation();
                                handleToggleComplete(item);
                              }}
                              className="text-xs px-1.5 py-0.5 rounded-full bg-slate-200 text-slate-600 hover:bg-emerald-100 hover:text-emerald-700 font-bold transition-colors disabled:opacity-60 cursor-pointer"
                            >
                              {name}
                            </button>
                          ));
                        })()}
                      </div>
                    </div>
                    <button
                      onClick={() => handleDeleteForwarded(item)}
                      title="삭제 (휴지통으로)"
                      className="text-slate-300 hover:text-red-500 text-xs font-bold p-1 shrink-0"
                    >
                      🗑️
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
      <Suspense fallback={null}>
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
      </Suspense>
    )}
    </>
  );
}
