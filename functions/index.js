// functions/index.js
//
// 일정 알림 서버 푸시 (2026-10-08). 앱이 닫혀 있어도 휴대폰·PC에 알림이 가게 한다.
//   1) alarmIndexUser / alarmIndexGroup - 일정 문서(events/{날짜})가 바뀌면 그날의 알림 칸(v4_alarms)을 맞춘다.
//      앱의 어느 저장 길로 써도(하루 화면·주간·이월·반복 …) 여기서 한 번에 잡힌다.
//   2) sendDueAlarms - 매분 pendingAt <= 지금인 칸을 골라 받는 사람의 기기 토큰(users/{uid}/v4_pushTokens)으로 FCM을 보낸다.
// 계산은 alarmPlan.js(순수 함수, alarmPlan.test.js). v4_alarms는 규칙상 앱이 못 읽고 못 쓴다(이 함수들만, 관리자 권한).
//
// 배포: npx firebase deploy --only functions   (Firestore 위치와 같은 지역 - REGION)
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getMessaging } from 'firebase-admin/messaging';
import { onDocumentWritten } from 'firebase-functions/v2/firestore';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions, logger } from 'firebase-functions/v2';
import { ALARM_WINDOW_MS, alarmAtMs, isDeadTokenError, planDayAlarms, pushData, readEventItems } from './alarmPlan.js';

const REGION = 'asia-northeast3';
setGlobalOptions({ region: REGION, maxInstances: 5 });

initializeApp();
const db = getFirestore();
const ALARMS = 'v4_alarms';
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

async function syncDay(path, after, recipientsOf) {
  const items = after ? readEventItems(after) : [];
  const existingSnap = await db.collection(ALARMS).where('path', '==', path).get();
  const hasTimes = items.some((i) => i && alarmAtMs(i.time) != null);
  if (!hasTimes && existingSnap.empty) return; // 대부분의 저장은 여기서 끝난다
  const existing = {};
  existingSnap.forEach((d) => {
    existing[d.id] = d.data();
  });
  const { sets, deletes } = planDayAlarms({ path, items, existing, recipientsOf: await recipientsOf(), nowMs: Date.now() });
  if (sets.length === 0 && deletes.length === 0) return;
  const batch = db.batch();
  for (const { id, data } of sets) batch.set(db.collection(ALARMS).doc(id), { ...data, updatedAt: Date.now() });
  for (const id of deletes) batch.delete(db.collection(ALARMS).doc(id));
  await batch.commit();
  logger.info('알림 칸 맞춤', { path, sets: sets.length, deletes: deletes.length });
}

export const alarmIndexUser = onDocumentWritten('users/{uid}/events/{date}', async (event) => {
  const { uid, date } = event.params;
  if (!DATE_RE.test(date)) return;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  await syncDay(`users/${uid}/events/${date}`, after, async () => () => [uid]);
});

// 그룹 일정: 쓴 사람(authorId)에게, 쓴 사람이 없는 옛 일정은 그룹 구성원 모두에게
export const alarmIndexGroup = onDocumentWritten('groups/{gid}/events/{date}', async (event) => {
  const { gid, date } = event.params;
  if (!DATE_RE.test(date)) return;
  const after = event.data?.after?.exists ? event.data.after.data() : null;
  await syncDay(`groups/${gid}/events/${date}`, after, async () => {
    let members = null;
    const memberList = async () => {
      if (members) return members;
      const g = await db.collection('groups').doc(gid).get();
      members = Array.isArray(g.data()?.members) ? g.data().members : [];
      return members;
    };
    const all = await memberList();
    return (item) => (item.authorId ? [String(item.authorId)] : all);
  });
});

async function tokensOf(uid) {
  const snap = await db.collection('users').doc(uid).collection('v4_pushTokens').get();
  return snap.docs.map((d) => ({ ref: d.ref, token: d.data().token })).filter((t) => typeof t.token === 'string' && t.token);
}

export const sendDueAlarms = onSchedule({ schedule: 'every 1 minutes', timeZone: 'Asia/Seoul', retryCount: 0 }, async () => {
  const now = Date.now();
  const due = await db.collection(ALARMS).where('pendingAt', '<=', now).limit(300).get();
  if (due.empty) return;
  const messaging = getMessaging();
  for (const doc of due.docs) {
    const alarm = doc.data();
    // 먼저 '보냄'으로 바꾼다 - 앞 회차가 아직 돌고 있어도 두 번 보내지 않게(그 사이 바뀌었으면 건너뛴다)
    try {
      await doc.ref.update({ sent: true, pendingAt: null, sentAt: now }, { lastUpdateTime: doc.updateTime });
    } catch {
      continue;
    }
    if (typeof alarm.atMs === 'number' && alarm.atMs < now - ALARM_WINDOW_MS) continue; // 너무 늦었다
    const tokens = (await Promise.all((alarm.recipients || []).map(tokensOf))).flat();
    if (tokens.length === 0) continue;
    const res = await messaging.sendEachForMulticast({
      tokens: tokens.map((t) => t.token),
      data: pushData(alarm),
      webpush: { headers: { Urgency: 'high', TTL: '3600' } },
      android: { priority: 'high', ttl: 3600 * 1000 },
    });
    const dead = [];
    res.responses.forEach((r, i) => {
      if (!r.success && isDeadTokenError(r.error?.code)) dead.push(tokens[i].ref);
    });
    await Promise.all(dead.map((ref) => ref.delete().catch(() => {})));
    logger.info('알림 보냄', { id: doc.id, ok: res.successCount, fail: res.failureCount, removed: dead.length });
  }
});

// 오래된 칸 정리 (보낸 지 30일 넘은 것) - 하루 한 번
export const cleanupAlarms = onSchedule({ schedule: 'every day 04:00', timeZone: 'Asia/Seoul', retryCount: 0 }, async () => {
  const old = await db.collection(ALARMS).where('atMs', '<', Date.now() - 30 * 24 * ALARM_WINDOW_MS).limit(400).get();
  if (old.empty) return;
  const batch = db.batch();
  old.docs.forEach((d) => batch.delete(d.ref));
  await batch.commit();
  logger.info('지난 알림 칸 지움', { count: old.size });
});

