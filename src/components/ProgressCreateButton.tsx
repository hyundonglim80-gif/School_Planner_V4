// src/components/ProgressCreateButton.tsx
//
// 수업 칸을 고치는 중에 그 교시에 진도가 없으면 '📘 진도 만들기' (19번 U3). 하루 화면 교시 카드 수정과 'N교시 수정' 팝업이 쓴다.
// 진도 관리 창을 그 칸 글자로 채운 새 진도로 연다 - 초등 담임은 과목 '국어', 교과 모드는 '5-2 과학' → 과목 과학 + 반 5-2
// (lib/progressDraft.draftForSlot). 진도는 개인 공간 수업으로만 세므로 부르는 쪽이 개인 공간에서만 그린다.
import { NEW_PLAN_ID } from '../lib/progress';
import { useAppStore } from '../store/useAppStore';

export default function ProgressCreateButton({ subject }: { subject: string }) {
  const text = subject.trim();
  if (!text) return null;
  return (
    <button
      type="button"
      data-progress-create
      onClick={(e) => {
        e.stopPropagation();
        useAppStore.getState().setProgressModalOpen(true, NEW_PLAN_ID, undefined, text);
      }}
      title={`'${text}' 차시 목록을 넣어 시간표를 따라 몇 차시인지 보이게 합니다 (진도 관리)`}
      className="px-3 py-1.5 bg-indigo-50 text-indigo-700 hover:bg-indigo-100 border border-indigo-200 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors cursor-pointer"
    >
      📘 진도 만들기
    </button>
  );
}
