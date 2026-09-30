// src/lib/evalList.ts
//
// 조사표 문서(`{sp}/evaluations/{날짜}`)에서 목록을 읽는 한 곳.
//
// V3는 `evalList`만 읽고 쓴다. V4는 2026-09-14부터 `list`와 `evalList`를 함께 쓰고, 그 전에는 `list`만 썼다.
// ⚠️ 예전에는 모든 곳이 `list || evalList`로 읽었다. V4가 두 이름을 맞춰 쓴 날에 V3가 조사표를 더하거나 지우면
//    `evalList`만 바뀌는데, V4는 옛 `list`를 보고 있어서 V3에서 더한 조사표가 안 보였고, V4에서 그날 무엇이든
//    저장하면 옛 목록을 두 이름에 다시 써서 V3에서 더한 조사표가 지워졌다(지운 것은 되살아났다).

const keyOf = (e: any) => (e && e.id !== undefined && e.id !== null ? `id:${e.id}` : `js:${JSON.stringify(e)}`);

/**
 * - 한 이름만 있으면 그것을 쓴다.
 * - 둘 다 있으면 `evalList`가 최신이다(두 앱이 모두 쓰는 이름).
 * - 다만 둘이 겹치는 항목이 하나도 없으면, 9/14 전 V4(list)와 V3(evalList)가 따로 만든 두 목록이므로 합친다.
 *   (한쪽이 비었으면 합치지 않는다 - V3에서 모두 지운 날이다)
 */
export function readEvalList(data: any): any[] {
  if (!data) return [];
  const fromBoth = Array.isArray(data.evalList) ? (data.evalList as any[]) : null;
  const fromV4 = Array.isArray(data.list) ? (data.list as any[]) : null;
  if (!fromBoth && !fromV4) return [];
  if (!fromV4) return fromBoth!;
  if (!fromBoth) return fromV4;
  if (fromBoth.length === 0 || fromV4.length === 0) return fromBoth;
  const keys = new Set(fromBoth.map(keyOf));
  if (fromV4.some((e) => keys.has(keyOf(e)))) return fromBoth;
  return [...fromBoth, ...fromV4];
}

/** 조사표 문서에 쓸 페이로드. 두 이름에 같은 목록을 쓴다(한쪽만 쓰면 다른 앱이 옛 목록을 본다). */
export function evalDocPayload(list: any[]) {
  return { list, evalList: list, updatedAt: Date.now() };
}
