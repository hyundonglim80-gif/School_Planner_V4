// src/components/EventItemActions.tsx
// 일정 항목을 마우스로 가리켰을 때 나오는 수정/삭제 아이콘.
// 하루·주간·월간·년간 네 화면이 같은 아이콘을 쓴다.
//
// 부모에 group 클래스가 있어야 가리켰을 때 나타난다.
import React from 'react';

interface EventItemActionsProps {
  /**
   * 수정 아이콘을 눌렀을 때. 주지 않으면 아이콘도 그리지 않는다.
   *
   * 주간·월간·년간은 항목을 누르면 바로 수정 팝업이 열린다. 거기에 ✏️까지 두면
   * 같은 일을 하는 단추가 둘이 되고, 좁은 달력 칸에서 글자만 더 가린다.
   */
  onEdit?: () => void;
  onDelete: () => void;
  /** 달력형 뷰처럼 칸이 좁은 곳에서는 항목 위에 겹쳐 띄운다. */
  floating?: boolean;
}

export default function EventItemActions({ onEdit, onDelete, floating = false }: EventItemActionsProps) {
  const wrapper = floating
    ? 'absolute top-0 right-0 z-10 bg-white/95 border border-slate-200 rounded-md shadow-2xs px-0.5'
    : '';

  return (
    <span
      className={`inline-flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity ${wrapper}`}
    >
      {onEdit && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onEdit();
          }}
          className="px-1 text-2xs leading-none text-slate-400 hover:text-primary cursor-pointer"
          title="일정 수정"
        >
          ✏️
        </button>
      )}
      {/* 확인창 없이 바로 지운다. 휴지통에서 되돌릴 수 있다는 안내는 토스트로 나간다. */}
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onDelete();
        }}
        className="px-1 text-2xs leading-none text-slate-400 hover:text-red-500 cursor-pointer"
        title="일정 삭제"
      >
        🗑️
      </button>
    </span>
  );
}
