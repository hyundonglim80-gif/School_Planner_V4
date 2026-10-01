// src/components/DrawBigView.tsx
//
// 발표자 뽑기 크게 보기 (ROADMAP 8-3). 화면 가득 뽑힌 학생 이름 - 교실 화면에 띄워 함께 본다.
// 이미지 크게 보기처럼 화면 가운데에 덮는다(오른쪽 칸이 아니다). 몸통으로 붙여 오른쪽 칸 안에 갇히지 않게.
// '다음 학생'에 처음부터 커서를 두어 Enter·Space(발표용 리모컨)로 이어 뽑는다.
import React, { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';

interface DrawBigViewProps {
  isOpen: boolean;
  onClose: () => void;
  /** 보이는 학생 (없으면 아직 안 뽑음) */
  num: number | null;
  name: string;
  rolling: boolean;
  /** '이번 판 3/25명' 같은 한 줄 */
  statusLine: string;
  onPick: () => void;
}

export default function DrawBigView({ isOpen, onClose, num, name, rolling, statusLine, onPick }: DrawBigViewProps) {
  useBodyScrollLock(isOpen);
  const vv = useVisualViewport(isOpen);
  const zIndex = useModalLayer(isOpen, onClose);
  const backdrop = useBackdropClose(onClose);
  const pickRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (isOpen) pickRef.current?.focus();
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div
      className="fixed inset-0 flex flex-col items-center justify-center gap-6 p-6 bg-slate-900/95 text-white"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
      role="dialog"
      aria-label="발표자 뽑기 크게 보기"
      data-draw-big
      {...backdrop}
    >
      <button
        type="button"
        onClick={onClose}
        className="absolute top-4 right-4 w-10 h-10 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 font-bold"
        title="닫기"
        aria-label="크게 보기 닫기"
      >
        ✕
      </button>
      <div className="flex flex-col items-center gap-2 select-none" aria-live="polite" data-draw-big-name={rolling ? '' : num ?? ''}>
        {num === null ? (
          <span className="text-3xl font-black text-white/60">🎯 다음 학생을 누르면 뽑습니다</span>
        ) : (
          <>
            <span className={`font-black leading-none ${rolling ? 'text-white/50' : 'text-amber-300'}`} style={{ fontSize: 'min(10vw, 96px)' }}>
              {num}
            </span>
            <span
              className={`font-black leading-tight text-center break-keep transition-transform duration-200 ${
                rolling ? 'text-white/60' : 'text-white scale-105'
              }`}
              style={{ fontSize: 'min(16vw, 180px)' }}
            >
              {name}
            </span>
          </>
        )}
      </div>
      <p className="text-sm font-bold text-white/60">{statusLine}</p>
      <button
        ref={pickRef}
        type="button"
        onClick={onPick}
        // disabled로 두면 굴리는 동안 커서가 빠져 Enter로 이어 뽑지 못한다 - 누름은 onPick이 굴리는 중이면 무시한다
        aria-disabled={rolling}
        className={`px-8 py-3 rounded-2xl bg-amber-400 hover:bg-amber-300 text-slate-900 text-xl font-black ${rolling ? 'opacity-60' : ''}`}
      >
        🎯 다음 학생
      </button>
    </div>,
    document.body
  );
}
