// src/components/TeachingModeBanner.tsx
//
// 교사 유형을 한 번도 고르지 않은 계정에 하루 화면 맨 위로 뜨는 띠 (docs/ROADMAP-SUBJECT.md S1).
// 고르면 계정에 저장되어 다른 기기에도 다시 뜨지 않는다. '나중에'도 초등 담임(지금까지의 V4)을 저장한다.
// 나중에 환경설정 > 교사 유형에서 바꿀 수 있다.
import { useState } from 'react';
import { auth } from '../lib/firebase';
import { TEACHER_PRESETS, presetPatch, saveTeachingMode, type TeacherPreset } from '../lib/teachingMode';
import { useTeachingMode } from '../hooks/useTeachingMode';
import { showToast, showErrorToast } from '../utils/toast';

export default function TeachingModeBanner() {
  const { loaded, exists } = useTeachingMode();
  const [busy, setBusy] = useState(false);
  const uid = auth.currentUser?.uid;
  if (!loaded || exists || !uid) return null;

  const choose = async (p: TeacherPreset, later = false) => {
    setBusy(true);
    try {
      await saveTeachingMode(uid, presetPatch(p));
      showToast(
        later
          ? '👩‍🏫 초등 담임으로 둡니다. 환경설정 > 교사 유형에서 바꿀 수 있습니다.'
          : `👩‍🏫 교사 유형을 '${TEACHER_PRESETS.find((x) => x.value === p)?.label}'(으)로 저장했습니다.`
      );
    } catch (e) {
      showErrorToast('저장하지 못했습니다. 잠시 뒤 다시 골라 주세요.', e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="status"
      data-teacher-mode-banner
      className="flex items-center gap-2 flex-wrap rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"
    >
      <span className="font-bold">👩‍🏫 교사 유형을 골라 주세요</span>
      <span className="hidden sm:inline text-sky-700">수업 칸과 학급 도구를 그에 맞춰 보여 줍니다.</span>
      <span className="ml-auto flex items-center gap-1.5 flex-wrap">
        {TEACHER_PRESETS.map((p) => (
          <button
            key={p.value}
            type="button"
            disabled={busy}
            title={p.desc}
            onClick={() => void choose(p.value)}
            className="px-2.5 py-1 rounded-lg bg-white border border-sky-300 hover:bg-sky-100 font-bold text-sky-800 disabled:opacity-50"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          disabled={busy}
          onClick={() => void choose('homeroom', true)}
          className="px-2 py-1 rounded-lg hover:bg-sky-100 font-bold text-sky-700 disabled:opacity-50"
        >
          나중에
        </button>
      </span>
    </div>
  );
}
