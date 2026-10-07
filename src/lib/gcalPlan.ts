// src/lib/gcalPlan.ts
//
// 구글 캘린더 자동 보내기(19번 U11)의 순수한 부분 - 무엇을 넣고 고치고 지울지 정한다. Firestore·fetch 없음.
// 보낸 것은 수동 '구글 캘린더로 보내기'(lib/calendarSync)와 같은 캘린더 SP(work)·같은 글 모양·같은 sp_id라 서로 겹치지 않는다.
// 자동으로 보낸 것에는 sp_auto=true를 단다 - 그날 V4에 없는(지웠거나 옮겼거나 라벨을 바꾼) 일정 가운데 이 표시가 있는 것만 지운다.
// 수동으로만 보낸 것(표시 없음)은 지우지 않는다.
import { buildPayloads, isSameItem, needsUpdate, type GoogleEventPayload, type LabelDef } from './calendarSync';

/** 일정이 단 라벨 id들 (labelIds, label의 id 또는 이름) */
export function eventLabelIdsOf(item: any, eventLabels: LabelDef[]): string[] {
  const keys = [
    ...(Array.isArray(item?.labelIds) ? item.labelIds : []),
    ...(item?.label ? String(item.label).split(',') : []),
  ];
  const out: string[] = [];
  for (const raw of keys) {
    const k = String(raw ?? '').trim();
    if (!k) continue;
    const found = eventLabels.find((l) => l.id === k || l.name === k);
    const id = found?.id || k;
    if (!out.includes(id)) out.push(id);
  }
  return out;
}

/**
 * 구글 캘린더로 보낼 일정인가: 일정에 적은 값(gcal true/false - 일정 칸에서 고침)이 먼저, 없으면(null) '구글 캘린더'를 켠 라벨이 붙었나.
 */
export function isGcalEvent(item: any, enabled: Set<string>, eventLabels: LabelDef[]): boolean {
  if (typeof item?.gcal === 'boolean') return item.gcal;
  if (enabled.size === 0) return false;
  return eventLabelIdsOf(item, eventLabels).some((id) => enabled.has(id));
}

/**
 * 그날 일정 목록 → 자동으로 보낼 payload (수동 보내기와 같은 차례 번호를 쓰려고 하루 전체로 만든 뒤 고른다).
 * id 없는 일정(V3 옛 글)은 맞출 수 없어 보내지 않는다.
 */
export function autoPayloads(dateStr: string, list: any[], eventLabels: LabelDef[], enabled: Set<string>): GoogleEventPayload[] {
  const want = new Set(list.filter((e) => e?.id && isGcalEvent(e, enabled, eventLabels)).map((e) => String(e.id)));
  if (want.size === 0) return [];
  const all = buildPayloads({ dateStr, eventData: { eventList: list }, eventLabels, journalLabels: [], periodNames: [] }).event;
  return all
    .filter((p) => want.has(p.extendedProperties.private.sp_id))
    .map((p) => ({ ...p, extendedProperties: { private: { ...p.extendedProperties.private, sp_auto: 'true' } } }));
}

export interface DatePlan {
  post: GoogleEventPayload[];
  put: { id: string; payload: GoogleEventPayload }[];
  del: string[];
}

/**
 * 구글에 이미 있는 그날 일정(existing, 우리 표시 app이 붙은 것) ↔ 보낼 것 맞추기.
 *  - 짝이 있으면 고칠 것이 있을 때만 PUT (자동 표시가 없던 것도 PUT - 이제부터 자동이 맡는다)
 *  - 같은 sp_id가 둘 이상이면(두 기기가 동시에 넣었다) 남는 것은 지운다
 *  - 짝이 없는 자동 일정은 지운다 - 그날 V4에서 빠졌을 때만(dayIds: 그날 V4에 있는 모든 일정 id)
 */
export function planDateSync(existing: any[], payloads: GoogleEventPayload[], dayIds: Set<string> = new Set()): DatePlan {
  const plan: DatePlan = { post: [], put: [], del: [] };
  const matched = new Set<string>();
  const events = existing.filter((ev) => ev?.extendedProperties?.private?.type === 'event');
  for (const payload of payloads) {
    const hit = events.find((ev) => !matched.has(ev.id) && isSameItem(ev, payload));
    if (!hit) {
      plan.post.push(payload);
      continue;
    }
    matched.add(hit.id);
    if (needsUpdate(hit, payload) || hit.extendedProperties?.private?.sp_auto !== 'true') plan.put.push({ id: hit.id, payload });
    const spId = payload.extendedProperties.private.sp_id;
    for (const dup of events) {
      if (!matched.has(dup.id) && spId && dup.extendedProperties?.private?.sp_id === spId) {
        matched.add(dup.id);
        plan.del.push(dup.id);
      }
    }
  }
  // 그날 V4에 아직 있는 일정(라벨을 바꿨거나 '구글 캘린더'를 끈 것)은 지우지 않는다 - 지운 것·다른 날로 옮긴 것만
  for (const ev of events) {
    const priv = ev.extendedProperties?.private;
    if (!matched.has(ev.id) && priv?.sp_auto === 'true' && !dayIds.has(String(priv.sp_id || ''))) plan.del.push(ev.id);
  }
  return plan;
}
