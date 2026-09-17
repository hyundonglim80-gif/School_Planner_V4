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

// 환경설정에서 바꿀 수 있는 값이라 범위를 정해 둔다.
// 0이면 이월이 아예 안 돌고, 너무 크면 하루 문서를 그만큼 읽어야 해서 느려진다.
export const MIN_LOOKBACK_DAYS = 1;
export const MAX_LOOKBACK_DAYS = 60;

/** 입력칸으로 들어온 값을 쓸 수 있는 범위로 자른다 */
export function clampLookbackDays(value: unknown): number {
  const n = Math.floor(Number(value));
  if (!Number.isFinite(n)) return FORWARD_LOOKBACK_DAYS;
  return Math.min(MAX_LOOKBACK_DAYS, Math.max(MIN_LOOKBACK_DAYS, n));
}

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

// ── 이 일정이 이월 대상인가 ──────────────────────────────────────────
//
// ⚠️ 예전에는 이월이 라벨을 자기식으로 판단했다.
//      if (it.label) labelName = it.label.split(',')[0]
//    즉 label 자리에 든 값을 '이름'으로 단정했다. 그런데 V3에서 만든 일정은
//    그 자리에 id(lbl_ev_...)가 들어 있다. 그러면 이름과 맞을 리가 없어
//    이월 라벨이 붙은 일정이 이월 대상으로 잡히지 않았다.
//    화면은 lib/eventLabels의 공용 함수로 id와 이름을 둘 다 맞춰 보기 때문에
//    라벨 칩은 멀쩡히 보였다. 같은 물음에 두 곳이 다른 답을 내고 있었다.
//    이제 화면과 같은 함수로 푼다.
import { resolveEventLabelNames, isForwardLabel } from './eventLabels';
import type { EventLabel } from '../hooks/useLabels';

export function isForwardTarget(item: any, labelDefs: EventLabel[]): boolean {
  // 항목에 직접 정해 둔 값이 가장 세다 (V4에서 켜고 끈 것)
  if (item?.forward === true) return true;
  if (item?.forward === false) return false;

  const forwardNames = new Set(
    labelDefs.filter((l) => isForwardLabel(l)).map((l) => l.name)
  );
  if (forwardNames.size === 0) return false;

  return resolveEventLabelNames(item, labelDefs).some((n) => forwardNames.has(n));
}
