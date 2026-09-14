// src/lib/forwarding.ts
//
// 미완료 일정을 오늘로 끌어올 때 "며칠 전까지" 훑을지.
//
// 예전에는 이 값이 세 군데에 제각각 박혀 있었다.
//   자동 이월(useDayData)        14일
//   미완료 일정 전달 팝업         7일
//   사용 설명서 안내 문구        "최근 14일간"
// 그래서 전달 팝업에는 안 뜨는데 자동 이월은 가져오는 날짜 구간(8~14일 전)이 생겼고,
// 설명서 문구도 실제 동작과 달랐다. 한 곳에서만 정한다.
export const FORWARD_LOOKBACK_DAYS = 14;

/** 오늘을 뺀, 거슬러 올라갈 날짜 문자열 목록 (어제부터 과거로) */
export function pastDateStrings(from: Date, days: number = FORWARD_LOOKBACK_DAYS): string[] {
  const list: string[] = [];
  for (let i = 1; i <= days; i++) {
    const d = new Date(from);
    d.setDate(d.getDate() - i);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    list.push(`${y}-${m}-${day}`);
  }
  return list;
}
