import React, { useEffect, useState } from 'react';
import { useBodyScrollLock } from '../hooks/useBodyScrollLock';
import { useVisualViewport } from '../hooks/useVisualViewport';
import { useModalLayer } from '../hooks/useModalLayer';
import { useBackdropClose } from '../hooks/useBackdropClose';

export interface ViewerImage {
  url: string;
  name?: string;
}

interface ImageViewerModalProps {
  isOpen: boolean;
  onClose: () => void;
  images: ViewerImage[];
  startIndex?: number;
  /**
   * 그림 아래에 붙일 것 (이 그림으로 할 수 있는 일).
   *
   * 머리말이 아니라 아래에 둔다. 휴대폰에서는 위쪽이 손가락에서 가장 먼 자리라,
   * 사진을 크게 띄워 놓고 바꾸려면 화면 꼭대기까지 손을 올려야 했다.
   */
  footer?: React.ReactNode;
}

// 메모/기록에 첨부된 캡처 이미지를 팝업으로 바로 확인하는 뷰어.
export default function ImageViewerModal({ isOpen, onClose, images, startIndex = 0, footer }: ImageViewerModalProps) {
  useBodyScrollLock(isOpen);
  const vv = useVisualViewport(isOpen);
  const zIndex = useModalLayer(isOpen, onClose);
  const backdrop = useBackdropClose();
  const [index, setIndex] = useState(startIndex);

  // 뷰어를 다시 열 때 클릭한 이미지부터 보여준다 (useState 초기값은 최초 1회만 적용되므로).
  useEffect(() => {
    if (isOpen) setIndex(startIndex);
  }, [isOpen, startIndex]);

  if (!isOpen || images.length === 0) return null;

  const safeIndex = Math.min(Math.max(index, 0), images.length - 1);
  const current = images[safeIndex];
  const hasMultiple = images.length > 1;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center overflow-y-auto p-4 bg-black/80 backdrop-blur-sm"
      style={{ left: vv.left, top: vv.top, width: vv.width, height: vv.height, zIndex }}
      {...backdrop}
    >
      <div
        className="relative w-full max-w-3xl max-h-full flex flex-col gap-2"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between gap-2 text-white">
          <span className="text-xs font-bold truncate" title={current.name}>
            🖼️ {current.name || '첨부 이미지'}
            {hasMultiple ? ` (${safeIndex + 1}/${images.length})` : ''}
          </span>
          <div className="flex items-center gap-2 shrink-0">
            <a
              href={current.url}
              target="_blank"
              rel="noopener noreferrer"
              className="px-2.5 py-1 text-xs font-bold bg-white/15 hover:bg-white/25 rounded-lg transition-colors"
              title="새 탭에서 원본 보기"
            >
              원본
            </a>
            <button
              type="button"
              onClick={onClose}
              className="w-8 h-8 flex items-center justify-center rounded-xl bg-white/15 hover:bg-white/25 font-bold transition-colors cursor-pointer"
              title="닫기"
            >
              ✕
            </button>
          </div>
        </div>

        <div className="relative flex items-center justify-center bg-black/40 rounded-2xl overflow-hidden">
          <img
            src={current.url}
            alt={current.name || '첨부 이미지'}
            className="max-w-full max-h-[70vh] object-contain"
          />
          {hasMultiple && (
            <>
              <button
                type="button"
                onClick={() => setIndex((safeIndex - 1 + images.length) % images.length)}
                className="absolute left-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors cursor-pointer"
                title="이전 이미지"
              >
                ‹
              </button>
              <button
                type="button"
                onClick={() => setIndex((safeIndex + 1) % images.length)}
                className="absolute right-2 top-1/2 -translate-y-1/2 w-9 h-9 flex items-center justify-center rounded-full bg-black/60 text-white hover:bg-black/80 transition-colors cursor-pointer"
                title="다음 이미지"
              >
                ›
              </button>
            </>
          )}
        </div>

        {footer && (
          <div className="flex items-center justify-center gap-2 pt-1">{footer}</div>
        )}
      </div>
    </div>
  );
}
