// src/lib/entryCollapse.ts
//
// 기록·메모 카드를 언제 접어서 보여줄지 한 곳에서 정한다.
//
// 긴 기록 하나가 목록의 한 칸을 통째로 차지해 버리면, 그 아래 것들을 보려고
// 한참을 내려야 한다. 그래서 일정 크기를 넘는 것은 접은 채로 시작하고,
// 필요할 때 펼치게 한다. 기록과 메모가 서로 다른 기준을 쓰면 같은 길이의 글이
// 화면마다 다르게 보이므로 기준을 나누지 않는다.

// 기준을 정한 근거.
// 기록·메모는 넓은 화면에서 4단으로 늘어서고, 카드 한 칸의 본문 폭은 250px 남짓,
// 한 줄에 한글 16자쯤 들어간다. 그래서 글자 수가 곧 카드 높이가 된다.
//   120자 -> 약 8줄,  180자 -> 약 11줄
// 처음에 200자로 잡았다가, 실제 화면에서 181자짜리 상담 기록이 안 접혀 한 칸을
// 통째로 차지하는 것을 보고 120자로 낮췄다. 숫자만 보지 말고 눈으로 확인할 것.
/** 이 글자 수를 넘으면 길다고 본다 */
export const COLLAPSE_CHAR_LIMIT = 120;

/** 이 줄 수를 넘으면 길다고 본다 (짧은 줄이 여러 개인 목록형 글) */
export const COLLAPSE_LINE_LIMIT = 5;

/** 접었을 때 보여 줄 미리보기 길이 */
export const PREVIEW_CHAR_LIMIT = 60;

/**
 * 접은 채로 시작할 만큼 긴가.
 * 첨부나 이미지는 기준에 넣지 않는다. 사진 한 장만 붙은 짧은 메모까지
 * 접히면 오히려 답답하고, 그림은 그 자체로 훑어보기 좋은 정보다.
 */
export function isLongEntry(text: string | undefined | null): boolean {
  const t = (text || '').trim();
  if (!t) return false;
  if (t.length > COLLAPSE_CHAR_LIMIT) return true;
  return t.split('\n').length > COLLAPSE_LINE_LIMIT;
}

/**
 * 접힌 카드에 한 줄로 보여 줄 요약.
 * 접었을 때 아무것도 안 보이면 어느 항목인지 알 수 없어 펼쳐 봐야만 한다.
 */
export function previewLine(text: string | undefined | null): string {
  const first = (text || '')
    .split('\n')
    .map((l) => l.trim())
    .find((l) => l.length > 0);
  if (!first) return '';
  return first.length > PREVIEW_CHAR_LIMIT ? first.slice(0, PREVIEW_CHAR_LIMIT) + '…' : first;
}
