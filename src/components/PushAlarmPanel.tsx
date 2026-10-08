// src/components/PushAlarmPanel.tsx
//
// 환경설정 '일정 알림 (앱을 닫아도)' - 이 기기에서 서버 푸시를 켜고 끈다 (lib/push, 2026-10-08).
// 휴대폰은 허용을 묻는 창을 '누른 직후'에만 띄우므로 켜기는 반드시 이 단추에서 한다.
import { useEffect, useState } from 'react';
import { disablePush, enablePush, readPushState, type PushState } from '../lib/push';
import { showToast, showErrorToast } from '../utils/toast';

const STATE_TEXT: Record<PushState, string> = {
  on: '✅ 이 기기에서 받습니다',
  off: '꺼져 있습니다',
  blocked: '🚫 이 사이트의 알림이 막혀 있습니다 - 브라우저(휴대폰) 설정의 사이트 알림에서 허용한 뒤 다시 눌러 주세요',
  'ios-install': '📱 아이폰·아이패드는 사파리 공유(⬆️) → "홈 화면에 추가"로 설치한 앱에서만 받을 수 있습니다',
  unsupported: '이 브라우저는 앱을 닫았을 때의 알림을 받을 수 없습니다 (앱을 열어 두면 알림 창은 뜹니다)',
};

export default function PushAlarmPanel() {
  const [state, setState] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let alive = true;
    readPushState().then((s) => alive && setState(s));
    return () => {
      alive = false;
    };
  }, []);

  const turnOn = async () => {
    setBusy(true);
    try {
      await enablePush();
      showToast('이 기기에서 일정 알림을 받습니다. 앱을 닫아도 알림 시각에 알려 줍니다.');
    } catch (e: any) {
      showErrorToast(e?.message || '알림을 켜지 못했습니다.', e);
    } finally {
      setState(await readPushState());
      setBusy(false);
    }
  };
  const turnOff = async () => {
    setBusy(true);
    try {
      await disablePush();
      showToast('이 기기에서는 앱을 닫았을 때의 일정 알림을 받지 않습니다.');
    } finally {
      setState(await readPushState());
      setBusy(false);
    }
  };

  if (state == null) return <p className="text-xs text-slate-400">확인하는 중…</p>;
  const canToggle = state === 'on' || state === 'off' || state === 'blocked';
  return (
    <div className="flex flex-wrap items-center gap-2" data-push-alarm data-push-state={state}>
      <span className={`text-xs font-bold ${state === 'on' ? 'text-emerald-600' : 'text-slate-500'}`}>{STATE_TEXT[state]}</span>
      {canToggle &&
        (state === 'on' ? (
          <button
            type="button"
            disabled={busy}
            onClick={turnOff}
            data-push-off
            className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-white text-slate-500 border-slate-200 hover:border-rose-400 hover:text-rose-500 disabled:opacity-50"
          >
            이 기기에서 끄기
          </button>
        ) : (
          <button
            type="button"
            disabled={busy}
            onClick={turnOn}
            data-push-on
            className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-primary text-white border-primary shadow-xs disabled:opacity-50"
          >
            🔔 이 기기에서 받기
          </button>
        ))}
    </div>
  );
}
