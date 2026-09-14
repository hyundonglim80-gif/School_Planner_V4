// src/components/AutoTextarea.tsx
// 내용에 맞춰 세로 높이가 늘어나는 입력칸. 앱의 모든 여러 줄 입력은 이걸 쓴다.
//
// 최소 높이는 CSS(min-h-*)에 맡긴다. 내용이 적을 때 scrollHeight는 min-height가
// 적용된 박스 높이로 나오므로, 따로 최소값을 계산할 필요가 없다.
import React, { useCallback, useEffect, useRef } from 'react';

type AutoTextareaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement>;

export default function AutoTextarea({
  className,
  value,
  onInput,
  ...rest
}: AutoTextareaProps) {
  const ref = useRef<HTMLTextAreaElement>(null);

  const resize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, []);

  // 팝업 안에서는 마운트 직후 레이아웃이 아직 잡히지 않아 scrollHeight가 0으로
  // 나온다. 한 프레임 뒤에 재어야 처음부터 내용에 맞는 높이로 열린다.
  useEffect(() => {
    const frame = requestAnimationFrame(resize);
    return () => cancelAnimationFrame(frame);
  }, [value, resize]);

  return (
    <textarea
      ref={ref}
      value={value}
      // onChange만으로는 한글 조합 중(IME) 높이가 늦게 따라온다.
      onInput={(e) => {
        resize();
        onInput?.(e);
      }}
      className={`resize-none overflow-hidden ${className ?? ''}`}
      {...rest}
    />
  );
}
