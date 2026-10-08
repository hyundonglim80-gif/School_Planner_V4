// node --test functions/   (npm run test:functions)
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { alarmAtMs, alarmDocId, planDayAlarms, readEventItems, pushData, isDeadTokenError } from './alarmPlan.js';

const PATH = 'users/u1/events/2026-10-08';
const me = () => ['u1'];
const at = (t) => alarmAtMs(t);

test('alarmAtMs - 한국 시각으로 읽는다', () => {
  assert.equal(new Date(at('2026-10-08T14:20')).toISOString(), '2026-10-08T05:20:00.000Z');
  assert.equal(new Date(at('2026-10-09T03:05')).toISOString(), '2026-10-08T18:05:00.000Z');
  assert.equal(at(''), null);
  assert.equal(at('14:20'), null);
  assert.equal(at(undefined), null);
});

test('readEventItems - id 없는 항목은 ev_차례 (앱과 같다)', () => {
  const items = readEventItems({ eventList: [{ content: 'a' }, { id: 'x', content: 'b' }, null] });
  assert.deepEqual(items.map((i) => i && i.id), ['ev_0', 'x', null]);
  assert.deepEqual(readEventItems({ eventText: '옛 글' }), []);
});

test('새 알림은 pendingAt에 시각을 둔다', () => {
  const now = at('2026-10-08T09:00');
  const { sets, deletes } = planDayAlarms({
    path: PATH,
    items: readEventItems({ eventList: [{ id: 'e1', content: '상담', time: '2026-10-08T14:20' }, { id: 'e2', content: '알림 없음' }] }),
    existing: {},
    recipientsOf: me,
    nowMs: now,
  });
  assert.equal(sets.length, 1);
  assert.equal(sets[0].id, alarmDocId(PATH, 'e1'));
  assert.equal(sets[0].data.pendingAt, at('2026-10-08T14:20'));
  assert.equal(sets[0].data.sent, false);
  assert.deepEqual(sets[0].data.recipients, ['u1']);
  assert.deepEqual(deletes, []);
});

test('같은 시각은 다시 보내지 않고, 바뀐 것이 없으면 쓰지 않는다', () => {
  const id = alarmDocId(PATH, 'e1');
  const sent = { path: PATH, eventId: 'e1', time: '2026-10-08T14:20', content: '상담', recipients: ['u1'], sent: true, pendingAt: null };
  const items = readEventItems({ eventList: [{ id: 'e1', content: '상담', time: '2026-10-08T14:20', alarmTriggered: true }] });
  const r1 = planDayAlarms({ path: PATH, items, existing: { [id]: sent }, recipientsOf: me, nowMs: at('2026-10-08T14:21') });
  assert.deepEqual(r1, { sets: [], deletes: [] });
  // 글만 바뀌면 글만 고치고 보낸 표시는 그대로
  const items2 = readEventItems({ eventList: [{ id: 'e1', content: '상담 (교실)', time: '2026-10-08T14:20' }] });
  const r2 = planDayAlarms({ path: PATH, items: items2, existing: { [id]: sent }, recipientsOf: me, nowMs: at('2026-10-08T14:21') });
  assert.equal(r2.sets[0].data.sent, true);
  assert.equal(r2.sets[0].data.pendingAt, null);
  assert.equal(r2.sets[0].data.content, '상담 (교실)');
});

test('시각을 바꾸면 다시 보낸다', () => {
  const id = alarmDocId(PATH, 'e1');
  const sent = { path: PATH, eventId: 'e1', time: '2026-10-08T14:20', content: '상담', recipients: ['u1'], sent: true, pendingAt: null };
  const items = readEventItems({ eventList: [{ id: 'e1', content: '상담', time: '2026-10-08T15:00' }] });
  const r = planDayAlarms({ path: PATH, items, existing: { [id]: sent }, recipientsOf: me, nowMs: at('2026-10-08T14:30') });
  assert.equal(r.sets[0].data.sent, false);
  assert.equal(r.sets[0].data.pendingAt, at('2026-10-08T15:00'));
});

test('알림을 끄거나 완료·삭제하면 칸을 지운다', () => {
  const e1 = alarmDocId(PATH, 'e1');
  const e2 = alarmDocId(PATH, 'e2');
  const e3 = alarmDocId(PATH, 'e3');
  const existing = { [e1]: { time: '2026-10-08T14:20' }, [e2]: { time: '2026-10-08T15:20' }, [e3]: { time: '2026-10-08T16:20' } };
  const items = readEventItems({ eventList: [{ id: 'e1', time: '' }, { id: 'e2', time: '2026-10-08T15:20', completed: true }] });
  const r = planDayAlarms({ path: PATH, items, existing, recipientsOf: me, nowMs: at('2026-10-08T09:00') });
  assert.deepEqual(r.sets, []);
  assert.deepEqual(r.deletes.sort(), [e1, e2, e3].sort());
});

test('1시간 넘게 지난 시각은 보내지 않는다 (보낸 것으로 둔다)', () => {
  const items = readEventItems({ eventList: [{ id: 'e1', time: '2026-10-08T07:00' }] });
  const r = planDayAlarms({ path: PATH, items, existing: {}, recipientsOf: me, nowMs: at('2026-10-08T09:00') });
  assert.equal(r.sets[0].data.sent, true);
  assert.equal(r.sets[0].data.pendingAt, null);
});

test('pushData는 글자만, 죽은 토큰 오류를 가린다', () => {
  const d = pushData({ eventId: 'e1', content: '상담', time: '2026-10-08T14:20', path: PATH });
  assert.ok(Object.values(d).every((v) => typeof v === 'string'));
  assert.equal(d.type, 'event-alarm');
  assert.ok(isDeadTokenError('messaging/registration-token-not-registered'));
  assert.ok(!isDeadTokenError('messaging/internal-error'));
});
