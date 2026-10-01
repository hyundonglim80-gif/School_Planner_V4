// src/components/AutoBackupBanner.tsx
//
// 드라이브 자동 백업이 오래 밀렸을 때 화면 위에 뜨는 띠 (docs/ROADMAP.md 3-3).
// 자동 백업은 구글 권한이 이미 있을 때만 조용히 돌아서(권한 창을 띄우지 않는다), 권한 없이 며칠이 지나면
// 한 번 눌러 달라고 권한다. '지금 백업'은 사용자가 누른 것이라 권한 창을 띄워도 된다. '나중에'는 하루 미룬다.
import { useState } from 'react';
import { backupNow } from '../hooks/useAutoBackup';

export default function AutoBackupBanner({ overdue, keep, onSnooze }: { overdue: number; keep: number; onSnooze: () => void }) {
  const [busy, setBusy] = useState(false);
  const msg = Number.isFinite(overdue)
    ? `드라이브 자동 백업이 ${overdue}일 밀렸습니다.`
    : '드라이브 자동 백업이 아직 한 번도 되지 않았습니다.';
  return (
    <div
      role="status"
      data-auto-backup-banner
      className="mb-3 flex items-center gap-2 flex-wrap rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900"
    >
      <span className="font-bold">💾 {msg}</span>
      <span className="text-amber-700">구글 권한이 있을 때만 조용히 저장해서, 한 번 눌러 주셔야 합니다.</span>
      <span className="ml-auto flex items-center gap-1.5">
        <button
          type="button"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            try {
              await backupNow(keep);
            } finally {
              setBusy(false);
            }
          }}
          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white font-bold disabled:opacity-50"
        >
          {busy ? '백업 중...' : '지금 백업'}
        </button>
        <button type="button" onClick={onSnooze} className="px-2 py-1 rounded-lg hover:bg-amber-100 font-bold text-amber-800">
          나중에
        </button>
      </span>
    </div>
  );
}
