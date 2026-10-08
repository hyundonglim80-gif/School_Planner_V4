// functions/alarmPlan.js
//
// 일정 알림 서버 푸시의 계산 부분 (Firebase에 기대지 않는 순수 함수 - alarmPlan.test.js가 본다).
//
// 일정 문서(events/{날짜})의 eventList 항목 가운데 알림 시각(time: 'YYYY-MM-DDTHH:mm', 한국 시각)이 있고
// 끝나지 않은 것을 v4_alarms/{id} 한 칸씩으로 모아 둔다. 매분 도는 함수가 pendingAt <= 지금인 칸만 골라 보낸다.
//   - 보낸 칸은 sent: true, pendingAt 없음 (범위 조회에 걸리지 않는다 - 색인 하나로 충분)
//   - 같은 시각이면 다시 보내지 않는다. 시각을 바꾸면 새로 보낸다. 알림을 끄거나(time '') 완료·삭제하면 칸을 지운다.
//   - 이미 1시간 넘게 지난 시각은 보내지 않는다(앱의 알림 창과 같은 규칙).

export const ALARM_WINDOW_MS = 60 * 60 * 1000;
const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/;
const KST_OFFSET_H = 9; // 한국은 서머타임이 없다

/** 'YYYY-MM-DDTHH:mm'(한국 시각) → ms. 모양이 틀리면 null */
export function alarmAtMs(time) {
  const m = TIME_RE.exec(typeof time === 'string' ? time : '');
  if (!m) return null;
  const [, y, mo, d, h, mi] = m.map(Number);
  const ms = Date.UTC(y, mo - 1, d, h - KST_OFFSET_H, mi);
  return Number.isNaN(ms) ? null : ms;
}

/** 앱의 lib/eventText.readEventList와 같은 id: id 없는 항목은 ev_차례 */
export function readEventItems(data) {
  const list = Array.isArray(data?.eventList) ? data.eventList : [];
  return list.map((it, i) => (it && typeof it === 'object' ? { ...it, id: it.id != null && it.id !== '' ? String(it.id) : `ev_${i}` } : null));
}

/** 알림 칸 id - 문서 경로·일정 id로 정해진다 (같은 일정은 늘 같은 칸) */
export function alarmDocId(path, eventId) {
  return `${path}#${eventId}`.replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 700);
}

export function alarmBody(item) {
  const text = String(item?.content || item?.text || '').trim();
  return (text || '예정된 일정이 있습니다.').slice(0, 300);
}

/**
 * 하루 문서 하나의 알림 칸을 맞춘다.
 * @param {object} p
 * @param {string} p.path 일정 문서 경로 (users/u/events/2026-10-08)
 * @param {Array} p.items readEventItems 결과
 * @param {Record<string, any>} p.existing 이 문서의 지금 알림 칸 { 칸 id: data }
 * @param {(item: any) => string[]} p.recipientsOf 받을 사람 uid
 * @param {number} p.nowMs
 * @returns {{ sets: Array<{ id: string, data: any }>, deletes: string[] }}
 */
export function planDayAlarms({ path, items, existing, recipientsOf, nowMs }) {
  const sets = [];
  const wanted = new Set();
  for (const item of items) {
    if (!item || item.completed) continue;
    const at = alarmAtMs(item.time);
    if (at == null) continue;
    const id = alarmDocId(path, item.id);
    if (wanted.has(id)) continue;
    wanted.add(id);
    const prev = existing[id];
    const body = alarmBody(item);
    const recipients = [...new Set(recipientsOf(item).filter(Boolean))].sort();
    const same = prev && prev.time === item.time;
    if (same) {
      // 시각이 같다 - 보낸 것은 다시 보내지 않고, 글·받는 사람만 바뀌었으면 고친다
      if (prev.content === body && JSON.stringify(prev.recipients || []) === JSON.stringify(recipients)) continue;
      sets.push({ id, data: { ...prev, content: body, recipients } });
      continue;
    }
    const stale = at < nowMs - ALARM_WINDOW_MS;
    sets.push({
      id,
      data: {
        path,
        eventId: item.id,
        time: item.time,
        atMs: at,
        content: body,
        recipients,
        sent: stale,
        pendingAt: stale ? null : at,
      },
    });
  }
  const deletes = Object.keys(existing).filter((id) => !wanted.has(id));
  return { sets, deletes };
}

/** 푸시에 실을 값 (FCM data는 글자만 받는다) */
export function pushData(alarm) {
  return {
    type: 'event-alarm',
    id: String(alarm.eventId || ''),
    content: String(alarm.content || ''),
    time: String(alarm.time || ''),
    path: String(alarm.path || ''),
  };
}

/** 토큰을 지워야 하는 FCM 오류 (기기에서 앱을 지웠거나 알림을 껐다) */
export function isDeadTokenError(code) {
  return (
    code === 'messaging/registration-token-not-registered' ||
    code === 'messaging/invalid-registration-token' ||
    code === 'messaging/invalid-argument'
  );
}
