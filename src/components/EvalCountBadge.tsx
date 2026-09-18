// src/components/EvalCountBadge.tsx
//
// 달력(주간·월간·년간)에서 그날 조사표가 몇 건인지 알려 주는 작은 단추.
//
// V3는 네 화면 모두에 📊 표식을 달아 두어, 달력만 봐도 어느 날에 조사표를
// 만들어 두었는지 알 수 있었다. V4로 옮기면서 이것만 빠져, 날짜를 하나씩 눌러
// 들어가 보기 전에는 알 수가 없었다. 기록 표식과 같은 모양으로 맞춘다.
import { useAppStore } from '../store/useAppStore';

export default function EvalCountBadge({
  dateStr,
  count,
  className = '',
}: {
  dateStr: string;
  count: number;
  className?: string;
}) {
  const { openEvaluationModal } = useAppStore();
  if (!count) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // 날짜를 누르면 하루 화면으로 넘어가는 자리에 얹혀 있다.
        // 이 단추는 그 이동 대신 조사표만 열어 준다.
        e.stopPropagation();
        openEvaluationModal(dateStr, 'schedule');
      }}
      title={`조사표 ${count}건 보기`}
      aria-label={`조사표 ${count}건 보기`}
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-2xs font-bold leading-none hover:bg-blue-100 transition-colors shrink-0 ${className}`}
    >
      <span aria-hidden>📊</span>
      <span>{count}</span>
    </button>
  );
}
