import React, { useState } from 'react';
import { showToast } from '../utils/toast';
import ModalShell, { ModalCloseButton } from './ModalShell';

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
  const initialParts = (initialTime || '').split('T');
  const [dVal, setDVal] = useState(initialParts[0] || dateStr);
  const [tVal, setTVal] = useState(initialParts[1] || '');
  const [error, setError] = useState('');

  const handleSave = async () => {
    const normalized = normalizeTimeInput(tVal);
    if (!normalized) {
      setError('시간을 "1430" 또는 "14:30" 형식으로 입력해주세요.');
      return;
    }
    await onSave(`${dVal || dateStr}T${normalized}`);
    showToast('✅ 알림이 설정되었습니다.');
    // ⚠️ 저장하고 나면 닫아야 한다. '알림 끄기'는 닫는데 '저장'만 안 닫고 있었다.
    //    설정됐다는 알림은 뜨는데 창은 그대로 있으니 안 된 줄 알고 또 누르게 된다.
    //    새 일정에 알림을 다는 자리에서는 더 나쁘다. 이 창의 가림막이 일정 칸의
    //    '저장'을 덮어, 창을 손수 닫기 전에는 일정 자체를 저장할 수 없었다.
    onClose();
  };

  const handleTurnOff = async () => {
    await onTurnOff();
    onClose();
  };

  return (
    <ModalShell
      isOpen={isOpen}
      onClose={onClose}
      width="sm"
      title="⏰ 알림 시간 설정"
      footer={
        <>
          <button
            type="button"
            onClick={handleTurnOff}
            className="mr-auto px-3 py-2 text-xs font-bold text-red-600 bg-red-50 hover:bg-red-100 border border-red-200 rounded-xl transition-colors cursor-pointer"
          >
            알림 끄기
          </button>
          <ModalCloseButton onClose={onClose} />
          <button
            type="button"
            onClick={handleSave}
            className="px-4 py-2 text-xs font-bold text-white bg-primary hover:bg-blue-600 rounded-xl shadow-xs transition-colors cursor-pointer"
          >
            저장
          </button>
        </>
      }
    >
      <div>
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
      </div>
    </ModalShell>
  );
}
