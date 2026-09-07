import React, { useState, useRef, useEffect } from 'react';
import { useAppStore } from '../store/useAppStore';
import { useLabels } from '../hooks/useLabels';
import { Trash2, X, CheckSquare, Tag, Loader2 } from 'lucide-react';

export default function MultiEventActionBar() {
  const {
    isMultiSelectMode,
    selectedEventIds,
    clearEventSelection,
    bulkUpdateSelectedEvents,
    bulkDeleteSelectedEvents,
  } = useAppStore();

  const { eventLabels, getLabelColor } = useLabels();
  const [isLabelOpen, setIsLabelOpen] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const labelMenuRef = useRef<HTMLDivElement>(null);

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
      await bulkUpdateSelectedEvents({ completed: true });
    } catch (e: any) {
      console.error(e);
      alert('일괄 완료 처리 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 2. 라벨 일괄 변경
  const handleBulkChangeLabel = async (labelName: string) => {
    if (selectedEventIds.length === 0 || isProcessing) return;
    try {
      setIsProcessing(true);
      await bulkUpdateSelectedEvents({ label: labelName });
      setIsLabelOpen(false);
    } catch (e: any) {
      console.error(e);
      alert('라벨 일괄 변경 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  // 3. 일괄 삭제
  const handleBulkDelete = async () => {
    if (selectedEventIds.length === 0 || isProcessing) return;
    const confirmDelete = window.confirm(`선택한 ${selectedEventIds.length}개의 일정을 삭제하시겠습니까?`);
    if (!confirmDelete) return;

    try {
      setIsProcessing(true);
      await bulkDeleteSelectedEvents();
    } catch (e: any) {
      console.error(e);
      alert('일괄 삭제 중 오류가 발생했습니다: ' + e.message);
    } finally {
      setIsProcessing(false);
    }
  };

  return (
    <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 animate-slide-up">
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
            onClick={() => setIsLabelOpen(!isLabelOpen)}
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
