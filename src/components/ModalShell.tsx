// src/components/ModalShell.tsx
//
// 팝업 껍데기. 예전에는 이 20줄이 팝업 20개에 각각 복사돼 있었고, 그래서 배경·여백·
// 정렬·스크롤 잠금이 파일마다 조금씩 달랐다(여백이 아예 없는 팝업도 7개 있었다).
// 공통 규칙을 여기 한 곳에서만 지킨다.
//
//   - 상단을 기준으로 붙고 아래로만 자란다. 탭을 바꿔 내용 높이가 달라져도
//     팝업의 위쪽 위치가 흔들리지 않는다.
//   - 배경을 누르면 열린 팝업이 전부 닫힌다.
//   - index.html이 viewport를 화면 폭으로 두므로, 실제로 보이는 영역(visual viewport)
//     에 맞춰야 핀치 줌 상태에서도 팝업이 화면 밖으로 밀려나지 않는다.
//   - 본문 스크롤을 잠근다.
import React from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';

export type ModalWidth = 'sm' | 'md' | 'lg' | 'xl' | '2xl' | '4xl';

const WIDTH_CLASS: Record<ModalWidth, string> = {
  sm: 'max-w-sm',
  md: 'max-w-md',
  lg: 'max-w-lg',
  xl: 'max-w-xl',
  '2xl': 'max-w-2xl',
  '4xl': 'max-w-4xl',
};

interface ModalShellProps {
  isOpen: boolean;
  onClose: () => void;
  width?: ModalWidth;
  /** 팝업 제목. 주면 공통 머리말(제목 + ✕)을 그려준다. */
  title?: React.ReactNode;
  /** 머리말 오른쪽, ✕ 왼쪽에 놓을 것 */
  headerExtra?: React.ReactNode;
  /** 아래 고정 영역. 저장/닫기 버튼을 둔다. */
  footer?: React.ReactNode;
  /** 본문에 기본 여백을 두지 않는다 (직접 구역을 나누는 팝업용) */
  bare?: boolean;
  children: React.ReactNode;
}

export default function ModalShell({
  isOpen,
  onClose,
  width = 'md',
  title,
  headerExtra,
  footer,
  bare = false,
  children,
}: ModalShellProps) {
  useBodyScrollLock(isOpen);
  const vv = useVisualViewport(isOpen);
  const zIndex = useModalLayer(isOpen, onClose);
  const backdrop = useBackdropClose();

  if (!isOpen) return null;

  return (
    <div
      className="fixed inset-0 flex items-start justify-center overflow-y-auto p-4 bg-slate-900/40 backdrop-blur-sm animate-fade-in"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
      {...backdrop}
    >
      <div
        className={`bg-white w-full ${WIDTH_CLASS[width]} max-h-full rounded-2xl shadow-2xl border border-slate-200 flex flex-col overflow-hidden`}
        onClick={(e) => e.stopPropagation()}
      >
        {title !== undefined && (
          <div className="flex items-center justify-between gap-2 px-5 py-3.5 border-b border-slate-100 bg-slate-50/60 shrink-0">
            <h2 className="text-base font-black text-slate-800 truncate">{title}</h2>
            <div className="flex items-center gap-2 shrink-0">
              {headerExtra}
              <button
                type="button"
                onClick={onClose}
                title="닫기"
                className="w-8 h-8 flex items-center justify-center rounded-xl bg-slate-100 text-slate-500 hover:bg-slate-200 hover:text-slate-700 font-bold transition-colors cursor-pointer"
              >
                ✕
              </button>
            </div>
          </div>
        )}

        <div
          className={`flex-1 min-h-0 overflow-y-auto overscroll-contain ${bare ? '' : 'px-5 py-4'}`}
          data-scroll-lock
        >
          {children}
        </div>

        {footer && (
          <div className="px-5 py-3.5 border-t border-slate-100 bg-slate-50/60 flex items-center justify-end gap-2 shrink-0">
            {footer}
          </div>
        )}
      </div>
    </div>
  );
}

/** 팝업 아래에 두는 닫기 버튼. 문구와 모양을 한 곳에서 맞춘다. */
export function ModalCloseButton({ onClose, label = '닫기' }: { onClose: () => void; label?: string }) {
  return (
    <button
      type="button"
      onClick={onClose}
      className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
    >
      {label}
    </button>
  );
}
