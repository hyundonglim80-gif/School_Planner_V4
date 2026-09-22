// src/components/DateRangeFields.tsx
//
// 조회 범위 드롭다운 옆에 붙는 시작일 ~ 종료일 칸.
//
// 드롭다운만 있으면 '±1주일'이 실제로 며칠부터 며칠까지인지 알 수 없고, 하루만
// 늘리고 싶어도 '기간 설정'을 고른 뒤 두 날짜를 처음부터 다시 찍어야 했다.
// 고른 범위를 날짜로 보여 주고, 그 자리에서 고칠 수 있게 한다.
// (내보내기 팝업이 이미 이렇게 되어 있다. 같은 모양으로 맞춘다)
interface DateRangeFieldsProps {
  start: string;
  end: string;
  /** 둘 중 하나를 고치면 바뀐 짝을 그대로 돌려준다 */
  onChange: (start: string, end: string) => void;
  /** 촘촘한 자리(링커 필터 줄)에서 쓴다 */
  dense?: boolean;
}

export default function DateRangeFields({ start, end, onChange, dense = false }: DateRangeFieldsProps) {
  const box = dense
    ? 'px-2 py-1 text-xs border border-slate-300 rounded-lg bg-white text-slate-700'
    : 'px-2.5 py-1.5 text-xs border border-slate-200 rounded-lg bg-white text-slate-700 font-semibold';

  return (
    <div className="flex items-center gap-1.5 min-w-0">
      {/* 날짜 칸에는 브라우저가 제 달력 단추를 그려 준다. 앞의 이 표시는
          '여기부터 날짜'라는 이정표다. */}
      <span className="text-xs shrink-0" aria-hidden="true">📅</span>
      <input
        type="date"
        value={start}
        onChange={(e) => onChange(e.target.value, end)}
        className={box}
        aria-label="시작일"
        title="시작일 (직접 고칠 수 있습니다)"
      />
      <span className="text-xs text-slate-400 shrink-0">~</span>
      <input
        type="date"
        value={end}
        onChange={(e) => onChange(start, e.target.value)}
        className={box}
        aria-label="종료일"
        title="종료일 (직접 고칠 수 있습니다)"
      />
    </div>
  );
}
