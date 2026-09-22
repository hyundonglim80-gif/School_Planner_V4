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

// 드롭다운과 같은 줄에 서야 한다. 줄을 바꿔 아래로 내려가면 필터 줄이 두 줄이 되어,
// 정작 봐야 할 목록이 그만큼 밀린다. 그래서 글자와 여백을 줄여 폭을 맞춘다.
// (칸 안에 들어가는 글자는 '2026-09-08' 열 자로 늘 같아서 줄여도 잘리지 않는다)
// min-w-0 이 있어야 정한 폭이 먹는다 - flex 항목은 기본이 min-width:auto 라
// 안에 든 것보다 작아지지 않는다. 이것 없이 w-[94px]만 주면 112px로 그려졌다.
export default function DateRangeFields({ start, end, onChange, dense = false }: DateRangeFieldsProps) {
  const box = dense
    ? 'min-w-0 px-1 py-0.5 text-2xs w-[94px] border border-slate-300 rounded-md bg-white text-slate-700'
    : 'min-w-0 px-1.5 py-1 text-2xs w-[100px] border border-slate-200 rounded-lg bg-white text-slate-700 font-semibold';

  return (
    <div className="flex items-center gap-1 min-w-0 shrink-0">
      {/* 날짜 칸에는 브라우저가 제 달력 단추를 그려 준다. 앞의 이 표시는
          '여기부터 날짜'라는 이정표다. */}
      <span className="text-2xs shrink-0" aria-hidden="true">📅</span>
      <input
        type="date"
        value={start}
        onChange={(e) => onChange(e.target.value, end)}
        className={box}
        aria-label="시작일"
        title="시작일 (직접 고칠 수 있습니다)"
      />
      <span className="text-2xs text-slate-400 shrink-0">~</span>
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
