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

// ── 칸에 맞춰 줄어드는 글자 (달력의 수업 칩) ──────────────────────────
//
// 위 단계들은 '읽기 좋은 크기'를 정한 것이고, 그게 맞다. 그런데 월간 달력의
// 수업 칩은 사정이 다르다. 한 칸을 교시 수(6~7개)로 나눠 쓰므로 칩 하나가
// 20px 남짓이다. 거기에 가장 작은 단계(text-2xs = 16px)를 넣어도 '국어'가
// 안 들어가 글자가 잘렸다. 글자 수만 보고 단계를 고르고 있어서, 칸이 얼마나
// 좁은지는 아무도 보지 않았다.
//
// 그렇다고 text-[8px]처럼 px를 박으면 안 된다. 그 값만 150% 확대에서 빠져
// 화면을 키우거나 줄일 때 혼자 어긋난다.
//
// 그래서 '고정된 크기'가 아니라 '칸 너비에 대한 비율'로 준다.
//   cqw = 칩 너비의 1%  (칩에 container-type: inline-size 를 걸어야 한다)
//   한글은 글자 하나가 대략 정사각형이라, n글자가 들어가려면 글자 크기가
//   칩 너비의 1/n 이면 된다 -> 100cqw / n
// 위로는 정해진 단계(text-2xs)를 넘지 않고, 아래로는 읽을 수 있는 선에서 멈춘다.
// 그보다 길어지면 예전처럼 잘리는데, 그건 글자를 더 줄이는 것보다 낫다.

/** 이보다 작아지면 읽을 수 없다 */
const MIN_FIT_PX = 7;

/** 글자 사이 여백 몫 (1.0이면 글자가 칩에 딱 붙는다) */
const FIT_RATIO = 0.92;

/**
 * 칩 너비에 맞춰 줄어드는 글자 크기.
 * 쓰는 쪽에서 칩에 `[container-type:inline-size]` 를 걸어야 cqw가 동작한다.
 * 브라우저가 cqw를 모르면 이 값이 통째로 무시되므로, 함께 둔 text-2xs가 그대로 쓰인다.
 */
export function fitToWidthFontSize(text: string): string {
  const chars = Math.max(1, text.trim().length);
  return `clamp(${MIN_FIT_PX}px, calc(100cqw / ${chars} * ${FIT_RATIO}), var(--text-2xs))`;
}
