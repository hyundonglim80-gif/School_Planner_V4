// src/components/roster/PhotoStatusBar.tsx
//
// 사진이 어디까지 붙었는지, 안 붙었으면 어디서 끊겼는지 한 줄로 내는 띠.
// 관리 탭과 암기 탭이 같은 것을 쓴다. 두 군데에서 다른 말을 하면 곤란하다.
//
// 무슨 말을 할지 정하는 셈은 lib/photoDiagnosis.ts에 있다. 여기는 그리기만 한다.
import React from 'react';
import type { PhotoDiagnosis } from '../../lib/photoDiagnosis';

interface PhotoStatusBarProps {
  diagnosis: PhotoDiagnosis;
  /** '사진폴더 / 2026-3-1' 처럼 지금 보고 있는 자리 */
  where?: string;
  onPickClassFolder: () => void;
  onRepickRoot: () => void;
  /** 고른 폴더를 드라이브에서 열어 눈으로 확인하게 한다 */
  onOpenFolder?: () => void;
  /** 못 읽는 폴더에 묶여 있을 때 앱이 맡아 두는 자리로 되돌아간다 */
  onForgetPicked?: () => void;
}

const TONE = {
  ok: { box: 'bg-emerald-50 border-emerald-200', text: 'text-emerald-700' },
  warn: { box: 'bg-slate-50 border-slate-200', text: 'text-slate-600' },
  error: { box: 'bg-red-50 border-red-200', text: 'text-red-700' },
} as const;

export default function PhotoStatusBar({
  diagnosis,
  where,
  onPickClassFolder,
  onRepickRoot,
  onOpenFolder,
  onForgetPicked,
}: PhotoStatusBarProps) {
  const tone = TONE[diagnosis.tone];

  return (
    <div className={`flex items-center justify-between gap-2 rounded-lg px-2.5 py-2 border flex-wrap ${tone.box}`}>
      <div className="flex flex-col gap-0.5 min-w-0">
        <span className={`text-2xs font-bold ${tone.text}`}>{diagnosis.message}</span>
        {diagnosis.hint && (
          <span className="text-2xs text-slate-500 font-semibold">{diagnosis.hint}</span>
        )}
      </div>

      <div className="flex items-center gap-1.5 shrink-0">
        {where && <span className="text-2xs text-slate-400 font-semibold">{where}</span>}
        {diagnosis.offerOpenFolder && onOpenFolder && (
          <button
            type="button"
            onClick={onOpenFolder}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded text-2xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            고른 폴더 열기
          </button>
        )}
        {diagnosis.offerForgetPicked && onForgetPicked && (
          <button
            type="button"
            onClick={onForgetPicked}
            title="이 학급에 골라 둔 폴더를 잊고, 앱이 맡아 두는 자리를 씁니다"
            className="px-2.5 py-1 bg-white border border-slate-300 rounded text-2xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            앱 폴더로 되돌리기
          </button>
        )}
        {diagnosis.offerPickClass && (
          <button
            type="button"
            onClick={onPickClassFolder}
            className="px-2.5 py-1 bg-primary hover:bg-primary/90 rounded text-2xs font-bold text-white transition-colors cursor-pointer"
          >
            이 학급 폴더 고르기
          </button>
        )}
        {diagnosis.offerRepick && (
          <button
            type="button"
            onClick={onRepickRoot}
            className="px-2.5 py-1 bg-white border border-slate-300 rounded text-2xs font-bold text-slate-600 hover:bg-slate-100 transition-colors cursor-pointer"
          >
            위쪽 폴더 다시 고르기
          </button>
        )}
      </div>
    </div>
  );
}
