// src/components/SlotPairInput.tsx
//
// 전담 교사(교과 모드)의 수업 칸 입력을 두 칸으로: **학년-반** + **과목** (2026-10-07 사용자 요청).
// 둘 다 직접 쳐도 되고 ▼ 목록(SlotCombobox)에서 골라도 된다. 저장은 예전처럼 칸 글자 하나 '5-2 과학'(lib/teachingSlot) -
// V3와 같이 쓰는 수업·시간표 문서에 칸을 더하지 않는다.
// 치는 동안('5-' 처럼 덜 친 반)에도 칸이 흔들리지 않게 두 칸을 따로 들고, 밖에서 값이 바뀌었을 때만 다시 나눈다.
import { useEffect, useRef, useState } from 'react';
import type React from 'react';
import SlotCombobox from './SlotCombobox';
import { parseSlot } from '../lib/teachingSlot';

type InputExtras = Omit<React.InputHTMLAttributes<HTMLInputElement>, 'value' | 'onChange' | 'list'> & Record<`data-${string}`, unknown>;

interface Props {
  value: string;
  onValueChange: (value: string) => void;
  classOptions: string[];
  subjectOptions: string[];
  /** 'row' = 옆으로 둘, 'stack' = 위아래 (시간표 표 칸) */
  layout?: 'row' | 'stack';
  openOnFocus?: boolean;
  /** 반 칸에 더할 속성 (표의 data-cell, 키·붙여넣기 처리) */
  classProps?: InputExtras;
  subjectProps?: InputExtras;
  inputClassName?: string;
  className?: string;
  autoFocus?: boolean;
}

/** 두 칸 → 칸 글자 하나 (반이 비면 과목만, 과목이 비면 반만) */
export function joinSlot(cls: string, subject: string): string {
  const c = cls.trim();
  const s = subject.trim().replace(/\s+/g, ' ');
  return c && s ? `${c} ${s}` : c || s;
}

/** 칸 글자 → 두 칸 */
export function splitSlot(text: string): { cls: string; subject: string } {
  const p = parseSlot(text);
  return { cls: p.cls, subject: p.cls ? p.subject : String(text ?? '').trim() };
}

export default function SlotPairInput({
  value,
  onValueChange,
  classOptions,
  subjectOptions,
  layout = 'row',
  openOnFocus = true,
  classProps,
  subjectProps,
  inputClassName = '',
  className = '',
  autoFocus,
}: Props) {
  const [cls, setCls] = useState(() => splitSlot(value).cls);
  const [subject, setSubject] = useState(() => splitSlot(value).subject);
  const emitted = useRef(value);

  // 밖에서 바뀐 값(붙여넣기·다른 날로 바꿈·처음 채움)이면 다시 나눈다
  useEffect(() => {
    if (value === emitted.current) return;
    emitted.current = value;
    const p = splitSlot(value);
    setCls(p.cls);
    setSubject(p.subject);
  }, [value]);

  const emit = (c: string, s: string) => {
    const next = joinSlot(c, s);
    emitted.current = next;
    onValueChange(next);
  };

  return (
    <div className={`${layout === 'stack' ? 'flex flex-col gap-0.5' : 'grid grid-cols-2 gap-1.5'} ${className}`} data-slot-pair>
      <SlotCombobox
        {...(classProps as any)}
        value={cls}
        onValueChange={(v) => {
          setCls(v);
          emit(v, subject);
        }}
        onBlur={(e) => {
          // '5학년 2반'·'502'·'５-２'도 '5-2'로
          const p = parseSlot(cls);
          if (p.cls && p.cls !== cls.trim() && !p.subject) {
            setCls(p.cls);
            emit(p.cls, subject);
          }
          (classProps as any)?.onBlur?.(e);
        }}
        options={classOptions}
        openOnFocus={openOnFocus}
        placeholder="학년-반"
        aria-label="학년-반"
        data-slot-class-input
        autoFocus={autoFocus}
        className={inputClassName}
      />
      <SlotCombobox
        {...(subjectProps as any)}
        value={subject}
        onValueChange={(v) => {
          setSubject(v);
          emit(cls, v);
        }}
        options={subjectOptions}
        openOnFocus={openOnFocus}
        placeholder="과목"
        aria-label="과목"
        data-slot-subject-input
        className={inputClassName}
      />
    </div>
  );
}
