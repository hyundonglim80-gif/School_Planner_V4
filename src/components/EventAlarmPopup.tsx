import React from 'react';
import { useVisualViewport } from '../hooks/useVisualViewport';
import type { RingingAlarm } from '../hooks/useEventAlarms';

interface EventAlarmPopupProps {
  alarms: RingingAlarm[];
  onDismiss: () => void;
}

export default function EventAlarmPopup({ alarms, onDismiss }: EventAlarmPopupProps) {
  const isOpen = alarms.length > 0;
  const vv = useVisualViewport(isOpen);

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 z-[99999] flex items-center justify-center overflow-y-auto p-4 sp4-alarm-backdrop"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height }}
    >
      <div className="relative w-full max-w-lg max-h-full overflow-y-auto rounded-[30px] border-8 border-yellow-300 p-8 text-center shadow-2xl sp4-alarm-content">
        <div className="text-7xl mb-5">⏰</div>
        <div className="space-y-4 mb-8">
          {alarms.map((a, i) => (
            <div key={a.id} className={i > 0 ? 'pt-4 border-t-2 border-dashed border-white/50' : ''}>
              <p className="text-xl sm:text-2xl font-black text-white whitespace-pre-wrap leading-relaxed break-words">
                🚨 {a.content}
              </p>
            </div>
          ))}
        </div>
        <button
          type="button"
          onClick={onDismiss}
          className="px-10 py-4 text-xl sm:text-2xl font-black text-slate-900 bg-white border-4 border-slate-900 rounded-2xl shadow-lg hover:bg-slate-100 active:scale-95 transition-transform cursor-pointer"
        >
          확 인 (알림 끄기)
        </button>
      </div>
    </div>
  );
}
