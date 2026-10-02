// src/features/day/TeachingModeBanner.tsx
//
// 교사 유형 처음 안내 (docs/ROADMAP-SUBJECT.md S1). 계정에 v4_teaching 문서가 없을 때만 하루 화면 맨 위에 뜬다.
// 단추를 누르면 그 유형을, '나중에'는 초등 담임을 저장한다 - 문서가 생기므로 다른 기기에서도 다시 뜨지 않는다.
import { useState } from 'react';
import { saveTeachingPatch, useTeachingMode } from '../../hooks/useTeachingMode';
import { TEACHER_PRESETS, presetPatch, type TeacherPreset } from '../../lib/teachingMode';

export default function TeachingModeBanner() {
  const { loaded, exists } = useTeachingMode();
  const [busy, setBusy] = useState(false);
  if (!loaded || exists) return null;

  const choose = async (p: TeacherPreset | null) => {
    setBusy(true);
    try {
      const label = TEACHER_PRESETS.find((x) => x.value === (p ?? 'homeroom'))?.label;
      await saveTeachingPatch(
        presetPatch(p ?? 'homeroom'),
        p ? `교사 유형: ${label}` : '초등 담임으로 둡니다. 환경설정 > 교사 유형에서 바꿀 수 있습니다.'
      );
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-teacher-mode-banner
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-xl border border-primary/30 bg-primary/5 text-xs"
    >
      <span className="font-bold text-slate-700">🧑‍🏫 교사 유형을 골라 주세요</span>
      <div className="flex flex-wrap items-center gap-1.5">
        {TEACHER_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={busy}
            title={p.desc}
            data-teacher-mode-choice={p.value}
            onClick={() => void choose(p.value)}
            className="px-2.5 py-1 rounded-lg font-bold border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          data-teacher-mode-later
          onClick={() => void choose(null)}
          className="px-2 py-1 rounded-lg font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          나중에
        </button>
      </div>
    </div>
  );
}
