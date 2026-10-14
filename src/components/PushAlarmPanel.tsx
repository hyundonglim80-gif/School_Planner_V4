// src/components/PushAlarmPanel.tsx
//
// 환경설정 '일정 알림 (앱을 닫아도)' - 이 기기에서 서버 푸시를 켜고 끈다 (lib/push, 2026-10-08).
// 휴대폰은 허용을 묻는 창을 '누른 직후'에만 띄우므로 켜기는 반드시 이 단추에서 한다.
// 2026-10-14 V5로 옮기며 V4 알림 함수를 내렸다(같은 일정이 V4·V5에서 두 번 울리지 않게) - 켜기 단추는 없애고
// V5 안내만 둔다. 끄기는 남긴다(이 기기 토큰 문서를 걷는다).
import { useEffect, useState } from 'react';
import { disablePush, readPushState, type PushState } from '../lib/push';
import { showToast } from '../utils/toast';

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
  return (
    <div className="flex flex-wrap items-center gap-2" data-push-alarm data-push-state={state}>
      <span className="text-xs font-bold text-sky-700" data-push-moved>
        🚚 앱을 닫았을 때의 알림은 V5로 옮겼습니다 - V5 환경설정 '알림' 탭에서 켜 주세요.
      </span>
      {state === 'on' && (
        <button
          type="button"
          disabled={busy}
          onClick={turnOff}
          data-push-off
          className="px-3 py-1.5 rounded-lg text-xs font-bold border bg-white text-slate-500 border-slate-200 hover:border-rose-400 hover:text-rose-500 disabled:opacity-50"
        >
          이 기기에서 끄기
        </button>
      )}
    </div>
  );
}
