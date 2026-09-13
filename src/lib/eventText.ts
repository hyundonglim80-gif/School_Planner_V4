// src/lib/eventText.ts
//
// 일정 문서(events/{날짜})는 V3 호환을 위해 같은 내용을 eventList(배열)와
// eventText(문자열) 두 필드에 중복 저장한다. 읽기 쪽은 eventList가 비어 있으면
// eventText를 파싱하는 폴백이 있어서, 한쪽만 갱신하면 삭제한 일정이 옛 eventText에서
// 되살아나고 그게 다시 이월 대상이 되어 무한히 증식한다.
// 그래서 일정 목록을 저장하는 모든 경로는 반드시 eventDocPayload()를 통해
// 두 필드를 함께 쓴다.

export interface V3EventLike {
  id: string;
  content: string;
  completed?: boolean;
  label?: string;
  [key: string]: any;
}

/** 항목의 표시 내용. V4는 content, V3 및 일부 모달은 text를 쓴다. */
export function eventContentOf(item: any): string {
  return String(item?.content ?? item?.text ?? '').trim();
}

export function parseV3EventText(rawText: string): V3EventLike[] {
  if (!rawText || !rawText.trim()) return [];
  const lines = rawText.split('\n');
  const list: V3EventLike[] = [];
  lines.forEach((line, idx) => {
    let t = line.trim();
    if (!t) return;
    let completed = false;
    if (t.startsWith('[v]') || t.startsWith('[V]')) {
      completed = true;
      t = t.substring(3).trim();
    }
    let label = '';
    const labelMatch = t.match(/^\[(.*?)\]\s*(.*)$/);
    let content = t;
    if (labelMatch) {
      label = labelMatch[1].trim();
      content = labelMatch[2].trim();
    }
    const contentStr = content || t;
    const contentHash = Math.abs(contentStr.split('').reduce((acc, char) => ((acc << 5) - acc) + char.charCodeAt(0), 0)).toString(36);
    list.push({
      id: 'ev_t_' + idx + '_' + contentHash,
      content: contentStr,
      completed,
      label: label || undefined,
    });
  });
  return list;
}

export function formatV3EventText(items: any[]): string {
  return (items || [])
    .map((item) => {
      const content = eventContentOf(item);
      if (!content) return null;
      const checkPrefix = item?.completed ? '[v] ' : '';
      const labelPrefix = item?.label ? `[${item.label}] ` : '';
      return `${checkPrefix}${labelPrefix}${content}`;
    })
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * events/{날짜} 문서에 쓸 페이로드. eventList를 바꾸는 모든 경로는 이걸 써야
 * eventText가 같이 갱신되어 읽기 폴백이 옛 내용을 되살리지 않는다.
 */
export function eventDocPayload(list: any[]) {
  return {
    eventList: list,
    eventText: formatV3EventText(list),
    updatedAt: Date.now(),
  };
}

/**
 * 문서에서 일정 목록을 읽는 표준 경로.
 * eventList가 비어 있을 때만 레거시 eventText를 파싱한다(데이터 보존 우선).
 */
export function readEventList(data: any): V3EventLike[] {
  const list = data?.eventList;
  if (Array.isArray(list) && list.length > 0) return list as V3EventLike[];
  if (data?.eventText) return parseV3EventText(data.eventText);
  return [];
}
