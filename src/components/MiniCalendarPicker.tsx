import React, { useState, useEffect, useRef, useCallback } from 'react';

interface MiniCalendarPickerProps {
  currentDate: string | Date;
  onSelectDate: (date: Date) => void;
}

export default function MiniCalendarPicker({
  currentDate,
  onSelectDate,
}: MiniCalendarPickerProps) {
  const [isOpen, setIsOpen] = useState(false);
  const curDate = typeof currentDate === 'string' ? new Date(currentDate) : currentDate;
  const [viewYear, setViewYear] = useState(curDate.getFullYear());
  const [viewMonth, setViewMonth] = useState(curDate.getMonth()); // 0 ~ 11
  const [popoverPos, setPopoverPos] = useState({ top: 0, left: 0 });

  const btnRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearCloseTimer = useCallback(() => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  }, []);

  const startCloseTimer = useCallback(() => {
    clearCloseTimer();
    closeTimerRef.current = setTimeout(() => {
      setIsOpen(false);
    }, 350);
  }, [clearCloseTimer]);

  const updatePosition = useCallback(() => {
    if (!btnRef.current) return;
    const rect = btnRef.current.getBoundingClientRect();
    const popoverWidth = 230;

    let left = rect.left + rect.width / 2 - popoverWidth / 2;
    const minLeft = 10;
    const maxLeft = Math.max(minLeft, window.innerWidth - popoverWidth - 10);
    if (left < minLeft) left = minLeft;
    if (left > maxLeft) left = maxLeft;

    const top = rect.bottom + 6;
    setPopoverPos({ top, left });
  }, []);

  const handleOpen = useCallback(() => {
    clearCloseTimer();
    const d = new Date(currentDate);
    setViewYear(d.getFullYear());
    setViewMonth(d.getMonth());
    updatePosition();
    setIsOpen(true);
  }, [clearCloseTimer, currentDate, updatePosition]);

  const handleClose = useCallback(() => {
    clearCloseTimer();
    setIsOpen(false);
  }, [clearCloseTimer]);

  const handleMouseEnter = useCallback(() => {
    clearCloseTimer();
    if (!isOpen) {
      handleOpen();
    }
  }, [clearCloseTimer, handleOpen, isOpen]);

  const handleMouseLeave = useCallback(() => {
    startCloseTimer();
  }, [startCloseTimer]);

  // 화면 리사이즈 및 스크롤 시 위치 갱신
  useEffect(() => {
    if (!isOpen) return;
    updatePosition();

    const handleScrollOrResize = () => {
      updatePosition();
    };

    window.addEventListener('resize', handleScrollOrResize);
    window.addEventListener('scroll', handleScrollOrResize, true);
    return () => {
      window.removeEventListener('resize', handleScrollOrResize);
      window.removeEventListener('scroll', handleScrollOrResize, true);
    };
  }, [isOpen, updatePosition]);

  // 외부 클릭 및 ESC 처리
  useEffect(() => {
    if (!isOpen) return;

    const handleClickOutside = (e: MouseEvent) => {
      const target = e.target as Node;
      if (
        btnRef.current &&
        !btnRef.current.contains(target) &&
        popoverRef.current &&
        !popoverRef.current.contains(target)
      ) {
        handleClose();
      }
    };

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        handleClose();
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen, handleClose]);

  const changeMonth = (delta: number) => {
    let nextMonth = viewMonth + delta;
    let nextYear = viewYear;
    if (nextMonth < 0) {
      nextMonth = 11;
      nextYear--;
    } else if (nextMonth > 11) {
      nextMonth = 0;
      nextYear++;
    }
    setViewMonth(nextMonth);
    setViewYear(nextYear);
  };

  const changeYear = (delta: number) => {
    setViewYear((prev) => prev + delta);
  };

  const handleSelectDate = (year: number, month: number, day: number) => {
    const selected = new Date(year, month, day);
    onSelectDate(selected);
    handleClose();
  };

  const handleTodayClick = () => {
    const today = new Date();
    onSelectDate(today);
    handleClose();
  };

  // 달력 날짜 계산
  const firstDayIndex = new Date(viewYear, viewMonth, 1).getDay(); // 0(일) ~ 6(토)
  const daysInMonth = new Date(viewYear, viewMonth + 1, 0).getDate();
  const daysInPrevMonth = new Date(viewYear, viewMonth, 0).getDate();

  const activeDate = new Date(currentDate);
  const curY = activeDate.getFullYear();
  const curM = activeDate.getMonth();
  const curD = activeDate.getDate();

  const today = new Date();
  const todayY = today.getFullYear();
  const todayM = today.getMonth();
  const todayD = today.getDate();

  // 이전 달 날짜 셀
  const prevDays = [];
  const pYear = viewMonth === 0 ? viewYear - 1 : viewYear;
  const pMonth = viewMonth === 0 ? 11 : viewMonth - 1;
  for (let i = firstDayIndex - 1; i >= 0; i--) {
    const pDay = daysInPrevMonth - i;
    prevDays.push({ year: pYear, month: pMonth, day: pDay });
  }

  // 이번 달 날짜 셀
  const currentDays = [];
  for (let d = 1; d <= daysInMonth; d++) {
    currentDays.push({ year: viewYear, month: viewMonth, day: d });
  }

  // 다음 달 날짜 셀
  const totalRendered = firstDayIndex + daysInMonth;
  const remainingCells = (7 - (totalRendered % 7)) % 7;
  const nYear = viewMonth === 11 ? viewYear + 1 : viewYear;
  const nMonth = viewMonth === 11 ? 0 : viewMonth + 1;
  const nextDays = [];
  for (let d = 1; d <= remainingCells; d++) {
    nextDays.push({ year: nYear, month: nMonth, day: d });
  }

  const weekDays = ['일', '월', '화', '수', '목', '금', '토'];

  const dateValueString = `${curDate.getFullYear()}-${String(
    curDate.getMonth() + 1
  ).padStart(2, '0')}-${String(curDate.getDate()).padStart(2, '0')}`;

  return (
    <div
      className="relative inline-flex items-center"
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
    >
      <button
        ref={btnRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          if (isOpen) handleClose();
          else handleOpen();
        }}
        className={`ml-1 px-1.5 py-0.5 text-xs rounded-md border transition-all flex items-center justify-center cursor-pointer shadow-2xs ${
          isOpen
            ? 'bg-sky-100 border-sky-300 text-primary'
            : 'bg-slate-50 hover:bg-slate-100 border-slate-200 text-slate-500 hover:text-primary'
        }`}
        title="달력에서 날짜 선택 (마우스 올리기 또는 클릭)"
      >
        📅
      </button>

      {isOpen && (
        <div
          ref={popoverRef}
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
          onClick={(e) => e.stopPropagation()}
          style={{
            position: 'fixed',
            top: `${popoverPos.top}px`,
            left: `${popoverPos.left}px`,
            width: '230px',
            zIndex: 99999,
          }}
          className="bg-white border border-slate-200 rounded-xl shadow-xl p-2.5 text-slate-800 animate-in fade-in zoom-in-95 duration-150 select-none text-left"
        >
          {/* 상단 호버 브릿지 (버튼과 팝업 사이 간격 보호) */}
          <div className="absolute -top-3 left-0 w-full h-3 bg-transparent pointer-events-auto" />

          {/* 1. 상단 네비게이션 헤더 */}
          <div className="flex justify-between items-center mb-1.5 pb-1 border-b border-slate-100">
            <div className="flex items-center gap-0.5">
              <button
                type="button"
                onClick={() => changeYear(-1)}
                className="px-1 py-0.5 text-[16.5px] text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="이전 연도"
              >
                «
              </button>
              <button
                type="button"
                onClick={() => changeMonth(-1)}
                className="px-1 py-0.5 text-[16.5px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="이전 달"
              >
                ◀
              </button>
              <span className="font-bold text-xs text-slate-800 tracking-tight px-1 whitespace-nowrap">
                {viewYear}년 {viewMonth + 1}월
              </span>
              <button
                type="button"
                onClick={() => changeMonth(1)}
                className="px-1 py-0.5 text-[16.5px] text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="다음 달"
              >
                ▶
              </button>
              <button
                type="button"
                onClick={() => changeYear(1)}
                className="px-1 py-0.5 text-[16.5px] text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded transition-colors cursor-pointer"
                title="다음 연도"
              >
                »
              </button>
            </div>
            <div className="flex items-center gap-1">
              <button
                type="button"
                onClick={handleTodayClick}
                className="px-1.5 py-0.5 text-[15px] font-bold bg-blue-50 hover:bg-blue-100 text-blue-600 border border-blue-200 rounded transition-colors cursor-pointer"
              >
                오늘
              </button>
              <button
                type="button"
                onClick={handleClose}
                className="px-1 text-slate-400 hover:text-slate-700 text-xs font-bold rounded transition-colors cursor-pointer"
                title="닫기"
              >
                ✕
              </button>
            </div>
          </div>

          {/* 2. 요일 헤더 */}
          <div className="grid grid-cols-7 mb-1 pb-1 border-b border-slate-100 text-center text-[15px] font-bold">
            {weekDays.map((w, idx) => {
              const colorClass =
                idx === 0
                  ? 'text-rose-500'
                  : idx === 6
                  ? 'text-blue-600'
                  : 'text-slate-500';
              return (
                <div key={w} className={`py-0.5 ${colorClass}`}>
                  {w}
                </div>
              );
            })}
          </div>

          {/* 3. 날짜 그리드 */}
          <div className="grid grid-cols-7 gap-0.5 text-center">
            {/* 이전 달 */}
            {prevDays.map(({ year, month, day }) => (
              <button
                key={`prev-${year}-${month}-${day}`}
                type="button"
                onClick={() => handleSelectDate(year, month, day)}
                className="h-6 flex items-center justify-center text-[16.5px] text-slate-300 hover:bg-slate-100 hover:text-slate-500 rounded transition-colors cursor-pointer"
              >
                {day}
              </button>
            ))}

            {/* 이번 달 */}
            {currentDays.map(({ year, month, day }) => {
              const dayOfWeek = new Date(year, month, day).getDay();
              const isSelected =
                year === curY && month === curM && day === curD;
              const isToday =
                year === todayY && month === todayM && day === todayD;

              let colorClass =
                dayOfWeek === 0
                  ? 'text-rose-500'
                  : dayOfWeek === 6
                  ? 'text-blue-600'
                  : 'text-slate-700';

              let bgClass = 'hover:bg-blue-50 hover:text-blue-700';
              let borderClass = 'border border-transparent';

              if (isSelected) {
                colorClass = 'text-white font-bold';
                bgClass = 'bg-primary shadow-2xs';
              } else if (isToday) {
                borderClass = 'border border-blue-500 font-bold';
              }

              return (
                <button
                  key={`curr-${year}-${month}-${day}`}
                  type="button"
                  onClick={() => handleSelectDate(year, month, day)}
                  className={`h-6 flex items-center justify-center text-xs rounded transition-colors cursor-pointer ${colorClass} ${bgClass} ${borderClass}`}
                >
                  {day}
                </button>
              );
            })}

            {/* 다음 달 */}
            {nextDays.map(({ year, month, day }) => (
              <button
                key={`next-${year}-${month}-${day}`}
                type="button"
                onClick={() => handleSelectDate(year, month, day)}
                className="h-6 flex items-center justify-center text-[16.5px] text-slate-300 hover:bg-slate-100 hover:text-slate-500 rounded transition-colors cursor-pointer"
              >
                {day}
              </button>
            ))}
          </div>

          {/* 4. 하단 직접 선택 */}
          <div className="flex justify-between items-center mt-1.5 pt-1.5 border-t border-slate-100 text-[15px]">
            <label className="relative inline-flex items-center gap-1 bg-slate-50 hover:bg-slate-100 text-slate-600 border border-slate-200 px-1.5 py-0.5 rounded cursor-pointer transition-colors font-medium">
              <span>📅 직접 선택</span>
              <input
                type="date"
                defaultValue={dateValueString}
                className="absolute inset-0 opacity-0 cursor-pointer"
                onChange={(e) => {
                  if (e.target.value) {
                    const [y, m, d] = e.target.value.split('-').map(Number);
                    handleSelectDate(y, m - 1, d);
                  }
                }}
              />
            </label>
            <span className="text-[13.5px] text-slate-400">클릭 시 이동</span>
          </div>
        </div>
      )}
    </div>
  );
}
