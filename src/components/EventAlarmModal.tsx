import React, { useState } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer, closeAllModals } from '../hooks/useModalLayer';

export interface EventAlarmModalProps {
  isOpen: boolean;
  onClose: () => void;
  dateStr: string;
  initialTime?: string; // "YYYY-MM-DDTHH:mm"
  onSave: (time: string) => void | Promise<void>;
  onTurnOff: () => void | Promise<void>;
}

// V3의 "⏰ 알림 시간 설정" 팝업을 이식: 날짜 선택 + 24시간제 텍스트 입력(예: 1430, 14:30).
function normalizeTimeInput(raw: string): string | null {
  let cleaned = (raw || '').trim().replace(/[^0-9:]/g, '');
  if (!cleaned) return null;
  if (/^\d{3,4}$/.test(cleaned)) {
    if (cleaned.length === 3) cleaned = '0' + cleaned[0] + ':' + cleaned.substring(1);
    else cleaned = cleaned.substring(0, 2) + ':' + cleaned.substring(2);
  }
  const match = cleaned.match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 23 || m > 59) return null;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export default function EventAlarmModal({
  isOpen,
  onClose,
  dateStr,
  initialTime,
  onSave,
  onTurnOff,
}: EventAlarmModalProps) {
  useBodyScrollLock(isOpen);
  const vv = useVisualViewport(isOpen);
  const zIndex = useModalLayer(isOpen, onClose);

  const initialParts = (initialTime || '').split('T');
  const [dVal, setDVal] = useState(initialParts[0] || dateStr);
  const [tVal, setTVal] = useState(initialParts[1] || '');
  const [error, setError] = useState('');

  if (!isOpen) return null;

  const handleSave = async () => {
    const normalized = normalizeTimeInput(tVal);
    if (!normalized) {
      setError('시간을 "1430" 또는 "14:30" 형식으로 입력해주세요.');
      return;
    }
    await onSave(`${dVal || dateStr}T${normalized}`);
    onClose();
  };

  const handleTurnOff = async () => {
    await onTurnOff();
    onClose();
  };

  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4 bg-black/50 backdrop-blur-xs animate-fade-in"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
      onClick={closeAllModals}
    >
      <div
        className="bg-white w-full max-w-sm max-h-full overflow-y-auto rounded-2xl shadow-2xl border border-slate-200 p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-black text-slate-800 mb-4 flex items-center gap-2">⏰ 알림 시간 설정</h3>

        <div className="mb-4">
          <label className="block text-xs font-bold text-slate-500 mb-1.5">날짜 선택</label>
          <input
            type="date"
            value={dVal}
            onChange={(e) => setDVal(e.target.value)}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>

        <div className="mb-2">
          <label className="block text-xs font-bold text-slate-500 mb-1.5">시간 입력 (24시간제)</label>
          <input
            type="text"
            value={tVal}
            onChange={(e) => { setTVal(e.target.value); setError(''); }}
            onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); handleSave(); } }}
            placeholder="예: 1430 (오후 2시 30분)"
            maxLength={5}
            autoFocus
            className="w-full px-3 py-2.5 text-center text-lg font-bold tracking-widest border border-slate-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-primary/20 focus:border-primary"
          />
        </div>
        {error && <p className="text-xs font-bold text-red-500 mb-2">{error}</p>}

        <div className="flex items-center justify-between gap-2 mt-5">
          <button
            type="button"
            onClick={handleTurnOff}
            className="px-3 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors cursor-pointer"
          >
            알림 끄기
          </button>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-xs font-bold text-slate-600 bg-white border border-slate-200 hover:bg-slate-50 rounded-xl transition-colors cursor-pointer"
            >
              취소
            </button>
            <button
              type="button"
              onClick={handleSave}
              className="px-4 py-2 text-xs font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-xs transition-colors cursor-pointer"
            >
              저장
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
