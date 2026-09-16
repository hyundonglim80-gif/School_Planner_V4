// src/lib/eventLabels.ts
//
// 일정 항목의 라벨은 세 군데에 있을 수 있다.
//   1) label    - "회의" 또는 "회의,완료" 처럼 콤마로 이은 이름 (또는 ID)
//   2) labelIds - 이름 또는 ID의 배열
//   3) content  - V3가 남긴 "[회의] 교직원 회의" 형태의 본문 접두어
//
// 화면마다 이 중 일부만 보고 있었다. 주간은 label 전체를 이름으로 간주해서
// "회의,완료"를 못 찾았고 labelIds는 아예 보지 않았다. 년간도 같았다. 월간은
// label의 첫 조각과 labelIds만 봤다. 그래서 라벨 이름을 바꾸면 화면마다 칩이
// 보이는 것과 안 보이는 것이 갈렸다. 해석은 여기 한 곳에서만 한다.
import type { EventLabel } from '../hooks/useLabels';

const LABEL_PREFIX = /^\[(.*?)\]\s*(.*)$/;

/** 본문 앞에 붙은 [라벨명] 접두어에서 라벨 이름만 꺼낸다. */
function prefixLabelOf(item: any): string | null {
  const content = String(item?.content ?? item?.text ?? '');
  const match = content.match(LABEL_PREFIX);
  return match ? match[1].trim() : null;
}

/**
 * 항목이 들고 있는 라벨을 등록된 라벨 목록에 맞춰 이름으로 풀어낸다.
 * 등록되지 않은(설정에서 지운) 라벨은 제외한다.
 *
 * ⚠️ keepUnknown - '라벨 목록을 아직 못 읽었을 때' 쓴다.
 *    이 함수는 목록에 없는 라벨을 걸러내는데, 목록을 못 읽어 기본값만 들고 있으면
 *    선생님이 만든 라벨이 전부 걸러져 화면에서 라벨 칩이 하나도 안 보인다.
 *    사용자에게는 데이터가 사라진 것으로 보인다. 모르면 거르지 말고 그대로 보여 준다.
 *    (지운 라벨을 감추는 일은 '목록을 제대로 읽었을 때'만 의미가 있다)
 */
export function resolveEventLabelNames(
  item: any,
  eventLabels: EventLabel[],
  opts?: { keepUnknown?: boolean }
): string[] {
  const keys: string[] = [];

  if (item?.label) {
    keys.push(...String(item.label).split(',').map((s) => s.trim()));
  }
  if (Array.isArray(item?.labelIds)) {
    keys.push(...item.labelIds.map((k: any) => String(k ?? '').trim()));
  }
  const prefix = prefixLabelOf(item);
  if (prefix) keys.push(prefix);

  const names: string[] = [];
  for (const key of keys) {
    if (!key) continue;
    const found = eventLabels.find((l) => l.id === key || l.name === key);
    if (found) {
      if (!names.includes(found.name)) names.push(found.name);
    } else if (opts?.keepUnknown) {
      // id로 저장된 것(ev_..., j_...)은 이름이 아니므로 보여 줄 것이 없다
      const looksLikeId = /^(ev|j|lbl)[_-]/i.test(key);
      if (!looksLikeId && !names.includes(key)) names.push(key);
    }
  }
  return names;
}

/** 화면에 보여줄 본문. 라벨로 쓰인 [접두어]는 칩으로 따로 나오므로 떼어낸다. */
export function eventDisplayContent(item: any): string {
  const content = String(item?.content ?? item?.text ?? '');
  const match = content.match(LABEL_PREFIX);
  return match ? match[2].trim() : content;
}

/** 첫 번째 라벨의 정의. 칩 색과 이월 여부를 정할 때 쓴다. */
export function resolveEventLabel(
  item: any,
  eventLabels: EventLabel[],
  opts?: { keepUnknown?: boolean }
): EventLabel | null {
  const name = resolveEventLabelNames(item, eventLabels, opts)[0];
  if (!name) return null;
  const found = eventLabels.find((l) => l.name === name);
  if (found) return found;
  // 목록을 못 읽어 이름만 아는 경우. 칩은 보여 주되 색은 중립으로 둔다.
  return opts?.keepUnknown ? { id: name, name, color: 'gray' } as EventLabel : null;
}

export function isForwardLabel(def: EventLabel | null): boolean {
  return !!(def && (def.forward || (def as any).isForward));
}
