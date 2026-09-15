// src/components/HolidayName.tsx
//
// 달력 칸에 공휴일 이름을 넣는 자리.
//
// 예전에는 화면마다 `truncate max-w-[65px]` 를 따로 적어 두어서, '대체공휴일'이나
// '부처님오신날' 같은 긴 이름이 '대체공...' 으로 잘렸고 무슨 날인지 알 수 없었다.
//
//   1) 이름이 길면 한 단계 작은 글자로 바꿔 더 들어가게 한다.
//      글자 크기는 lib/typeScale.ts 의 이름 있는 단계만 쓴다(px를 직접 쓰면
//      index.css의 150% 확대가 그 값만 비껴가서 옆 글자와 크기가 튄다).
//      text-2xs가 바닥이라 그 아래로는 줄이지 않는다.
//   2) 폭은 칸이 정한다. 남는 자리를 다 쓰고(min-w-0 + flex-1), 그래도 모자랄
//      때만 잘린다.
//   3) 잘리든 아니든 title을 달아, 마우스를 올리면 온전한 이름이 뜬다.
import React from 'react';
import { META_TEXT } from '../lib/typeScale';
import type { DensityTier } from '../lib/typeScale';

/** 이 글자 수를 넘으면 한 단계 줄인다 ('부처님오신날' = 7자) */
const LONG_NAME = 5;

/** 한 단계 작은 크기. text-2xs가 가장 작아 더 내려갈 곳이 없다. */
const ONE_STEP_SMALLER: Record<string, string> = {
  'text-sm': 'text-xs',
  'text-xs': 'text-2xs',
  'text-2xs': 'text-2xs',
};

interface HolidayNameProps {
  name: string;
  /** 화면 밀도. 하루 / 주간 / 월간·년간 */
  tier: DensityTier;
  /** 칸 안에서 남는 자리를 차지할지 (달력 칸은 true, 뱃지처럼 놓을 때는 false) */
  fill?: boolean;
  className?: string;
}

export default function HolidayName({ name, tier, fill = true, className = '' }: HolidayNameProps) {
  const base = META_TEXT[tier];
  const size = name.length > LONG_NAME ? ONE_STEP_SMALLER[base] : base;

  return (
    <span
      title={name}
      className={`${size} font-bold text-red-600 truncate ${fill ? 'min-w-0 flex-1' : ''} ${className}`}
    >
      {name}
    </span>
  );
}
