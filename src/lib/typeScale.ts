// src/lib/typeScale.ts
//
// 화면 글자 크기 규칙.
//
// index.css의 @theme이 이름 있는 단계를 전부 150%로 키워 둔다(모바일 가독성).
// 그래서 text-[11px] 처럼 px를 직접 쓰면 그 값만 150%가 안 걸려서, 옆의 text-xs(18px)
// 와 나란히 두면 글자 크기가 튄다. 실제로 하루(21px)와 월간(11px)의 일정 글자가
// 두 배 가까이 벌어져 있었다. 화면 글자 크기는 아래 이름만 쓴다.
//
//   text-base  24px  섹션 제목 (일정/수업/기록/월 이름) - 모든 화면 같다
//   text-sm    21px  본문
//   text-xs    18px  보조 정보 (시간·개수·라벨 칩·파일명)
//   text-2xs   16px  가장 밀집한 곳 (달력 칸 안)
//
// 본문 크기는 한 화면이 며칠을 보여주는지(밀도)에 따라 한 단계씩 내린다.
// 두 단계씩 건너뛰면 페이지를 옮길 때 글자가 튀는 느낌이 난다.
//
//   하루   1일      본문 text-sm  / 보조·칩 text-xs
//   주간   5~7일    본문 text-xs  / 보조·칩 text-2xs
//   월간   4~6주    본문 text-2xs / 보조·칩 text-2xs
//   년간   12개월   본문 text-2xs / 보조·칩 text-2xs
//   메모   카드형   하루와 같다 (카드가 넓다)

export type DensityTier = 'day' | 'week' | 'month';

/** 본문(일정·기록·메모 내용) */
export const BODY_TEXT: Record<DensityTier, string> = {
  day: 'text-sm',
  week: 'text-xs',
  month: 'text-2xs',
};

/** 보조 정보와 라벨 칩 */
export const META_TEXT: Record<DensityTier, string> = {
  day: 'text-xs',
  week: 'text-2xs',
  month: 'text-2xs',
};

/** 섹션 제목 - 화면과 무관하게 같다 */
export const SECTION_TITLE = 'text-base';
