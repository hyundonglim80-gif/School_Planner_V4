// src/components/EvalCountBadge.tsx
//
// 달력(주간·월간·년간)에서 그날 조사표가 몇 건인지 알려 주는 작은 단추.
//
// V3는 네 화면 모두에 📊 표식을 달아 두어, 달력만 봐도 어느 날에 조사표를
// 만들어 두었는지 알 수 있었다. V4로 옮기면서 이것만 빠져, 날짜를 하나씩 눌러
// 들어가 보기 전에는 알 수가 없었다. 기록 표식과 같은 모양으로 맞춘다.
import { useAppStore } from '../store/useAppStore';
import { parseDateStr } from '../lib/dateUtils';

export default function EvalCountBadge({
  dateStr,
  count,
  className = '',
}: {
  dateStr: string;
  count: number;
  className?: string;
}) {
  const { setCurrentDate, setScope } = useAppStore();
  if (!count) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // 그날 조사표를 한데 늘어놓고 고르게 하지 않는다. 하루 화면으로 가면
        // 표식이 교시마다 제자리에 서 있어, 어느 수업 것인지 보고 누르면 된다.
        e.stopPropagation();
        setCurrentDate(parseDateStr(dateStr));
        setScope('day');
      }}
      title={`조사표 ${count}건 - 하루 화면으로`}
      aria-label={`조사표 ${count}건 - 하루 화면으로`}
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-blue-200 bg-blue-50 text-blue-700 text-2xs font-bold leading-none hover:bg-blue-100 transition-colors shrink-0 ${className}`}
    >
      <span aria-hidden>📊</span>
      <span>{count}</span>
    </button>
  );
}
