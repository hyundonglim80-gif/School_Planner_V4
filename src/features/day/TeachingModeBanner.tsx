// src/features/day/TeachingModeBanner.tsx
//
// 처음 안내 띠 (docs/ROADMAP-SUBJECT.md S1): 계정에 교사 유형 문서가 없으면 하루 화면 맨 위에 하나.
// 단추를 누르면 그 유형을, '나중에'는 초등 담임을 저장한다 - 그래야 다른 기기에도 다시 뜨지 않는다.
import { useState } from 'react';
import { auth } from '../../lib/firebase';
import { TEACHER_PRESETS, presetPatch, saveTeachingMode, type TeacherPreset } from '../../lib/teachingMode';
import { useTeachingMode } from '../../hooks/useTeachingMode';
import { showToast, showErrorToast } from '../../utils/toast';

export default function TeachingModeBanner() {
  const { loaded, exists } = useTeachingMode();
  const [busy, setBusy] = useState(false);
  if (!loaded || exists) return null;

  const choose = async (p: TeacherPreset, later = false) => {
    const uid = auth.currentUser?.uid;
    if (!uid) return;
    setBusy(true);
    try {
      await saveTeachingMode(uid, presetPatch(p));
      const label = TEACHER_PRESETS.find((x) => x.value === p)?.label;
      showToast(later ? '초등 담임으로 둡니다. 환경설정 > 교사 유형에서 바꿀 수 있습니다.' : `저장했습니다 - ${label}`, 3500);
    } catch (e) {
      showErrorToast('저장하지 못했습니다. 잠시 뒤 다시 골라 주세요.', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-teacher-mode-banner
      className="mb-4 flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2 rounded-xl border border-primary/30 bg-primary/5 text-xs"
    >
      <span className="font-black text-slate-700">🧑‍🏫 교사 유형을 골라 주세요</span>
      <span className="hidden sm:inline text-slate-400">수업 칸을 과목으로 볼지, 반+과목으로 볼지 정합니다.</span>
      <span className="flex flex-wrap items-center gap-1.5 ml-auto">
        {TEACHER_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={busy}
            title={p.desc}
            data-teacher-mode-banner-choose={p.value}
            onClick={() => void choose(p.value)}
            className="px-2.5 py-1 rounded-lg font-bold border border-slate-200 bg-white text-slate-600 hover:border-primary hover:text-primary disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          data-teacher-mode-banner-later
          onClick={() => void choose('homeroom', true)}
          className="px-2 py-1 rounded-lg font-bold text-slate-400 hover:text-slate-600 disabled:opacity-50"
        >
          나중에
        </button>
      </span>
    </div>
  );
}
