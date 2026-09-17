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

/**
 * 이 일정이 전에도 이월되던 것인가.
 *
 * 이월은 지난 날짜의 일정을 오늘로 '옮기는' 일이고, 옮길 때마다 그 흔적을
 * 일정에 남긴다. V4는 forwardChainId와 originalDate를, V3는 originalDate를 찍는다.
 * 그러니 일정 스스로가 '나는 이월되던 것'이라는 증거를 들고 있다.
 */
function wasForwardedBefore(item: any): boolean {
  return !!(item?.forwardChainId || item?.originalDate);
}

export function isForwardTarget(item: any, labelDefs: EventLabel[]): boolean {
  // 사용자가 '이 건은 이월하지 않겠다'고 직접 끈 것만 존중한다.
  if (item?.forwardOptOut === true) return false;

  // 항목에 직접 켜 둔 값은 그대로 따른다
  if (item?.forward === true) return true;

  // ⚠️ 예전에는 여기에 `if (item?.forward === false) return false;`가 있었다.
  //    그런데 V4는 일정을 만들 때마다 forward에 true/false를 '반드시' 박아 넣었다.
  //    라벨 정의를 아직 못 읽은 상태에서 일정을 만들면, 이월 라벨을 골라도
  //    그 라벨이 이월용인지 알 길이 없어 forward: false가 영구히 굳어 버린다.
  //    그 뒤로는 라벨이 제대로 읽히든 말든 이 한 줄이 이월을 먼저 잘라 냈다.
  //    V3는 ev.forward를 아예 보지 않고 라벨만으로 판단한다. 그래서 같은 일정이
  //    V3에서는 이월되고 V4에서는 안 되는, 두 앱이 어긋나는 일이 벌어졌다.
  //    이제 V3와 같이 라벨을 정답으로 삼고, 끄는 것은 위의 forwardOptOut으로만 받는다.

  // 라벨이 풀리면 라벨이 정답이다. 라벨을 껐다 켰다 한 것이 그대로 반영돼야 한다.
  const names = resolveEventLabelNames(item, labelDefs);
  if (names.length > 0) {
    const forwardNames = new Set(
      labelDefs.filter((l) => isForwardLabel(l)).map((l) => l.name)
    );
    return names.some((n) => forwardNames.has(n));
  }

  // ⚠️ 여기가 비어 있었다.
  //    라벨이 하나도 안 풀리면(라벨 정의를 못 읽었거나, 일정이 라벨을
  //    id로만 들고 있는데 그 id를 아는 사람이 없을 때) 무조건 '아니다'로 봤다.
  //    그래서 며칠째 이월되던 일정이 어느 날 갑자기 멈추고 지난 날짜에 남았다.
  //    사용자에게는 일정이 사라진 것으로 보인다.
  //    라벨로 판단할 수 없을 때는, 일정이 스스로 들고 있는 이월 흔적을 믿는다.
  //    한 번 이월되던 것은 계속 이월한다.
  return wasForwardedBefore(item);
}
