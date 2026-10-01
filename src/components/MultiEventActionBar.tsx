import React, { useState, useRef, useEffect } from 'react';
import { showErrorToast } from '../utils/toast';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { Trash2, X, CheckSquare, Tag, Loader2, CalendarDays } from 'lucide-react';
import { addDays, formatDateStr } from '../lib/dateUtils';
import { shortDateLabel } from '../lib/notices';
import { movesForwardIntoPast } from '../hooks/useEventMove';
import { showDeletedToast, showFieldsChangedToast, showMovedToast } from '../lib/undoToast';

export default function MultiEventActionBar() {
  const {
    isMultiSelectMode,
    selectedEventIds,
    clearEventSelection,
    bulkUpdateSelectedEvents,
    bulkDeleteSelectedEvents,
    bulkMoveSelectedEvents,
    selectedGroupId,
  } = useAppStore();

  const { eventLabels, getLabelColor } = useLabels();
  const [isLabelOpen, setIsLabelOpen] = useState(false);
  // 옮기기: 고른 일정을 모두 이 날짜로 (처음에는 내일 - '오늘 못 한 것 내일로'가 가장 흔하다)
  const [isMoveOpen, setIsMoveOpen] = useState(false);
  const [moveDate, setMoveDate] = useState(() => addDays(formatDateStr(new Date()), 1));
  const moveMenuRef = useRef<HTMLDivElement>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const labelMenuRef = useRef<HTMLDivElement>(null);

  // 바깥을 누르면 옮기기 창을 닫는다 (날짜 고르는 달력 창은 브라우저 것이라 문서 밖이다)
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (moveMenuRef.current && !moveMenuRef.current.contains(e.target as Node)) setIsMoveOpen(false);
    };
    if (isMoveOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMoveOpen]);

  // 외부 클릭 시 라벨 선택 팝오버 닫기
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (labelMenuRef.current && !labelMenuRef.current.contains(e.target as Node)) {
        setIsLabelOpen(false);
      }
    };
    if (isLabelOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isLabelOpen]);

  if (!isMultiSelectMode) return null;

  // 1. 일괄 완료 처리
  const handleBulkComplete = async () => {
    if (selectedEventIds.length === 0 || isProcessing) return;
    try {
      setIsProcessing(true);
      const snaps = await bulkUpdateSelectedEvents({ completed: true });
      if (snaps) showFieldsChangedToast(`✅ 일정 ${snaps.length}건을 완료로 표시했습니다.`, selectedGroupId, snaps);
    } catch (e: any) {
      console.error(e);
      showErrorToast('일괄 완료 처리 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. 라벨 일괄 변경
  const handleBulkChangeLabel = async (labelName: string) => {
    if (selectedEventIds.length === 0 || isProcessing) return;
    try {
      setIsProcessing(true);
      const id = eventLabels.find((l) => l.name === labelName)?.id;
      const snaps = await bulkUpdateSelectedEvents({ label: labelName, labelIds: id ? [id] : [] });
      setIsLabelOpen(false);
      if (snaps) {
        showFieldsChangedToast(
          labelName ? `🏷️ 일정 ${snaps.length}건의 라벨을 '${labelName}'(으)로 바꿨습니다.` : `🏷️ 일정 ${snaps.length}건의 라벨을 뗐습니다.`,
          selectedGroupId,
          snaps
        );
      }
    } catch (e: any) {
      console.error(e);
      showErrorToast('라벨 일괄 변경 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. 한 날짜로 모두 옮기기 (묶음이어도 고른 것만)
  const handleBulkMove = async () => {
    if (selectedEventIds.length === 0 || isProcessing || !moveDate) return;
    try {
      setIsProcessing(true);
      const r = await bulkMoveSelectedEvents(moveDate);
      setIsMoveOpen(false);
      const bounces = r.items.some((item) => movesForwardIntoPast(item, moveDate, eventLabels));
      showMovedToast(
        (r.moved > 0 ? `✅ 일정 ${r.moved}건을 ${shortDateLabel(moveDate)}로 옮겼습니다.` : '옮긴 일정이 없습니다.') +
          (r.same > 0 ? ` ${r.same}건은 이미 그 날입니다.` : '') +
          (r.failed > 0 ? ` ${r.failed}건은 옮기지 못해 고른 채로 두었습니다 - 네트워크를 확인하고 다시 눌러 주세요.` : '') +
          (bounces ? ' 이월 일정은 끝내지 않으면 다음에 오늘로 다시 옮겨 옵니다.' : ''),
        selectedGroupId,
        r.trail
      );
    } catch (e: any) {
      console.error(e);
      showErrorToast('일정을 옮기지 못했습니다.', e);
    } finally {
      setIsProcessing(false);
    }
  };

  // 4. 일괄 삭제
  const handleBulkDelete = async () => {
    if (selectedEventIds.length === 0 || isProcessing) return;
    const confirmDelete = window.confirm(`선택한 ${selectedEventIds.length}개의 일정을 삭제하시겠습니까?`);
    if (!confirmDelete) return;

    try {
      setIsProcessing(true);
      const trashIds = await bulkDeleteSelectedEvents();
      if (trashIds) showDeletedToast(`🗑️ 일정 ${trashIds.length}건을 삭제했습니다. 휴지통에서 복원할 수 있습니다.`, trashIds);
    } catch (e: any) {
      console.error(e);
      showErrorToast('일괄 삭제 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // bottom-20은 좁은 화면에서 하단 탭바 위로 올려 겹치지 않게 하기 위한 값이다.
  return (
    <div className="fixed bottom-20 sm:bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
      {/* 라벨 선택 팝오버 */}
      {isLabelOpen && (
        <div
          ref={labelMenuRef}
          className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-white text-slate-800 p-3 rounded-2xl shadow-2xl border border-slate-200/90 w-64 z-50"
        >
          <div className="text-xs font-bold text-slate-500 mb-2 px-1 flex items-center justify-between">
            <span>라벨 일괄 변경</span>
            <button
              onClick={() => setIsLabelOpen(false)}
              className="text-slate-400 hover:text-slate-600 text-xs"
            >
              ✕
            </button>
          </div>
          <div className="flex flex-wrap gap-1.5 max-h-48 overflow-y-auto pr-1">
            <button
              type="button"
              onClick={() => handleBulkChangeLabel('')}
              className="w-full text-left px-2 py-1.5 text-xs rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-100 font-medium transition-colors"
            >
              라벨 해제 (없음)
            </button>
            {eventLabels.map((l) => {
              const color = getLabelColor(l.name);
              return (
                <button
                  key={l.id}
                  type="button"
                  onClick={() => handleBulkChangeLabel(l.name)}
                  className="px-2.5 py-1 text-xs font-bold rounded-lg border hover:opacity-85 transition-opacity shadow-2xs"
                  style={{
                    backgroundColor: color.bg,
                    color: color.text,
                    borderColor: color.border,
                  }}
                >
                  {l.name}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* 옮기기 창 */}
      {isMoveOpen && (
        <div
          ref={moveMenuRef}
          className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 bg-white text-slate-800 p-3 rounded-2xl shadow-2xl border border-slate-200/90 w-72 z-50"
        >
          <div className="text-xs font-bold text-slate-500 mb-2 px-1 flex items-center justify-between">
            <span>고른 일정을 이 날짜로 모두 옮기기</span>
            <button onClick={() => setIsMoveOpen(false)} className="text-slate-400 hover:text-slate-600 text-xs">
              ✕
            </button>
          </div>
          <div className="flex items-center gap-1.5">
            <button
              type="button"
              onClick={() => setMoveDate((d) => addDays(d, -1))}
              title="전날로"
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-black"
            >
              ◀
            </button>
            <input
              type="date"
              value={moveDate}
              onChange={(e) => e.target.value && setMoveDate(e.target.value)}
              aria-label="옮길 날짜"
              className="flex-1 min-w-0 px-2 py-1 text-sm border border-slate-200 rounded-lg font-bold"
            />
            <button
              type="button"
              onClick={() => setMoveDate((d) => addDays(d, 1))}
              title="다음 날로"
              className="w-7 h-7 rounded-lg bg-slate-100 hover:bg-slate-200 text-xs font-black"
            >
              ▶
            </button>
          </div>
          <p className="mt-2 text-2xs text-slate-400 leading-snug">
            기간·반복 묶음이어도 고른 일정만 옮깁니다. 묶음째 옮기려면 일정을 눌러 칸의 날짜를 고치세요.
          </p>
          <button
            type="button"
            onClick={() => void handleBulkMove()}
            disabled={isProcessing || !moveDate}
            className="mt-2 w-full py-1.5 text-xs font-bold text-white bg-primary hover:bg-blue-600 rounded-xl disabled:opacity-50"
          >
            {shortDateLabel(moveDate)}로 {selectedEventIds.length}건 옮기기
          </button>
        </div>
      )}

      {/* 하단 바 본체 */}
      <div className="bg-slate-900/95 backdrop-blur-md text-white px-4 py-2.5 rounded-2xl shadow-2xl flex items-center gap-4 min-w-[340px] justify-between border border-slate-700/60">
        <div className="flex items-center gap-2.5">
          <div className="bg-primary text-white text-xs font-black w-6 h-6 rounded-full flex items-center justify-center shadow-xs">
            {selectedEventIds.length}
          </div>
          <span className="text-sm font-semibold tracking-tight">선택됨</span>
          {isProcessing && (
            <Loader2 size={16} className="animate-spin text-primary ml-1" />
          )}
        </div>

        <div className="flex items-center gap-1.5">
          {/* 일괄 완료 버튼 */}
          <button
            onClick={handleBulkComplete}
            disabled={selectedEventIds.length === 0 || isProcessing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:text-emerald-400 hover:bg-slate-800 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="선택 일정 일괄 완료 처리"
          >
            <CheckSquare size={16} />
            <span className="hidden sm:inline">완료</span>
          </button>

          {/* 라벨 일괄 변경 버튼 */}
          <button
            onClick={() => {
              setIsMoveOpen(false);
              setIsLabelOpen(!isLabelOpen);
            }}
            disabled={selectedEventIds.length === 0 || isProcessing}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isLabelOpen
                ? 'bg-amber-500/20 text-amber-300 border border-amber-500/40'
                : 'text-slate-200 hover:text-amber-300 hover:bg-slate-800'
            }`}
            title="선택 일정 라벨 일괄 변경"
          >
            <Tag size={16} />
            <span className="hidden sm:inline">라벨</span>
          </button>

          {/* 한 날짜로 옮기기 버튼 */}
          <button
            onClick={() => {
              setIsLabelOpen(false);
              setIsMoveOpen(!isMoveOpen);
            }}
            disabled={selectedEventIds.length === 0 || isProcessing}
            className={`flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed ${
              isMoveOpen
                ? 'bg-sky-500/20 text-sky-300 border border-sky-500/40'
                : 'text-slate-200 hover:text-sky-300 hover:bg-slate-800'
            }`}
            title="선택 일정을 다른 날짜로 옮기기"
          >
            <CalendarDays size={16} />
            <span className="hidden sm:inline">옮기기</span>
          </button>

          {/* 일괄 삭제 버튼 */}
          <button
            onClick={handleBulkDelete}
            disabled={selectedEventIds.length === 0 || isProcessing}
            className="flex items-center gap-1 px-2.5 py-1.5 text-xs font-bold text-slate-200 hover:text-rose-400 hover:bg-slate-800 rounded-xl transition-all disabled:opacity-40 disabled:cursor-not-allowed"
            title="선택 일정 일괄 삭제"
          >
            <Trash2 size={16} />
            <span className="hidden sm:inline">삭제</span>
          </button>

          <div className="w-[1px] h-5 bg-slate-700 mx-1"></div>

          {/* 선택 취소 버튼 */}
          <button
            onClick={clearEventSelection}
            disabled={isProcessing}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800 rounded-xl transition-colors disabled:opacity-40"
            title="선택 취소"
          >
            <X size={18} />
          </button>
        </div>
      </div>
    </div>
  );
}
