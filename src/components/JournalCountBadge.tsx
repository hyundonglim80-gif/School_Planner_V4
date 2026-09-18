// src/components/JournalCountBadge.tsx
//
// 달력(주간·월간·년간)에서 그날 기록이 몇 건인지 알려 주는 작은 단추.
//
// 예전에는 달력만 봐서는 그날 기록을 남겼는지 알 수가 없어서, 날짜를 하나씩
// 눌러 하루 화면으로 들어가 봐야 했다. 세 화면이 같은 모양을 쓰도록 한곳에 둔다.
import { useAppStore } from '../store/useAppStore';

export default function JournalCountBadge({
  dateStr,
  count,
  fId,
  className = '',
}: {
  dateStr: string;
  count: number;
  fId?: string | null;
  className?: string;
}) {
  const { openJournalPeek } = useAppStore();
  if (!count) return null;

  return (
    <button
      type="button"
      onClick={(e) => {
        // 날짜를 누르면 하루 화면으로 넘어가는 자리에 얹혀 있다.
        // 이 단추는 그 이동 대신 기록만 펼쳐 보여 준다.
        e.stopPropagation();
        openJournalPeek(dateStr, fId ?? null);
      }}
      title={`기록 ${count}건 보기`}
      aria-label={`기록 ${count}건 보기`}
      className={`inline-flex items-center gap-0.5 px-1 py-0.5 rounded-md border border-amber-200 bg-amber-50 text-amber-700 text-2xs font-bold leading-none hover:bg-amber-100 transition-colors shrink-0 ${className}`}
    >
      <span aria-hidden>📝</span>
      <span>{count}</span>
    </button>
  );
}
