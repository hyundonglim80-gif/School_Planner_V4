import React, { useEffect, useState } from 'react';
import { useVisualViewport } from '../hooks/useVisualViewport';
import type { RingingAlarm } from '../hooks/useEventAlarms';
import { playAlarmChime } from '../lib/sound';

/** 알림 소리를 되풀이하는 간격과 가장 오래 울리는 시간 (확인을 누르거나 '소리 끄기'를 누르면 바로 멈춘다) */
const CHIME_EVERY_MS = 3000;
const CHIME_FOR_MS = 60_000;

interface EventAlarmPopupProps {
  alarms: RingingAlarm[];
  onDismiss: () => void;
}

export default function EventAlarmPopup({ alarms, onDismiss }: EventAlarmPopupProps) {
  const isOpen = alarms.length > 0;
  const vv = useVisualViewport(isOpen);
  const [muted, setMuted] = useState(false);
  // 새 알림이 더해지면 다시 울린다 (껐던 소리도 새 알림에는 다시 켠다)
  const ringKey = alarms.map((a) => a.id).join('|');

  useEffect(() => {
    if (!ringKey) return;
    setMuted(false);
  }, [ringKey]);

  useEffect(() => {
    if (!ringKey || muted) return;
    playAlarmChime();
    const started = Date.now();
    const id = setInterval(() => {
      if (Date.now() - started >= CHIME_FOR_MS) {
        clearInterval(id);
        return;
      }
      playAlarmChime();
    }, CHIME_EVERY_MS);
    return () => clearInterval(id);
  }, [ringKey, muted]);

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
        {!muted && (
          <button
            type="button"
            data-alarm-mute
            onClick={() => setMuted(true)}
            className="block mx-auto mb-4 px-4 py-2 text-base font-bold text-white bg-black/30 border-2 border-white/70 rounded-xl hover:bg-black/40 cursor-pointer"
          >
            🔇 소리 끄기
          </button>
        )}
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
