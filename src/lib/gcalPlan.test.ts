import { describe, it, expect, vi } from 'vitest';
vi.mock('./firebase', () => ({ db: {}, auth: {}, googleProvider: {} }));
import { autoPayloads, eventLabelIdsOf, isGcalEvent, planDateSync } from './gcalPlan';

const labels = [
  { id: 'lbl_a', name: '공문' },
  { id: 'lbl_b', name: '회의' },
];
const on = new Set(['lbl_a']);

describe('gcalPlan', () => {
  it('라벨 id는 labelIds·label(이름이나 id)에서', () => {
    expect(eventLabelIdsOf({ labelIds: ['lbl_b'], label: '공문' }, labels)).toEqual(['lbl_b', 'lbl_a']);
    expect(isGcalEvent({ label: '공문' }, on, labels)).toBe(true);
    expect(isGcalEvent({ label: '회의' }, on, labels)).toBe(false);
    expect(isGcalEvent({ label: '공문' }, new Set(), labels)).toBe(false);
    // 일정에 적은 값이 라벨보다 먼저 (2026-10-07)
    expect(isGcalEvent({ label: '회의', gcal: true }, new Set(), labels)).toBe(true);
    expect(isGcalEvent({ label: '공문', gcal: false }, on, labels)).toBe(false);
    expect(isGcalEvent({ label: '공문', gcal: null }, on, labels)).toBe(true);
  });

  it('켠 라벨 일정만, 수동 보내기와 같은 차례 번호, sp_auto 표시', () => {
    const list = [
      { id: 'e1', content: '회의 준비', label: '회의' },
      { id: 'e2', content: '공문 보내기', label: '공문', completed: true },
      { content: '아이디 없음', label: '공문' },
    ];
    const ps = autoPayloads('2026-10-27', list, labels, on);
    expect(ps).toHaveLength(1);
    const p = ps[0];
    expect(p.extendedProperties.private).toMatchObject({ sp_id: 'e2', sp_auto: 'true', completed: 'true', type: 'event', dateStr: '2026-10-27' });
    expect(p.summary).toMatch(/✅ 공문 보내기 \[공문\]$/);
    expect(p.end.date).toBe('2026-10-28');
  });

  const ev = (id: string, spId: string, extra: Record<string, string> = {}, summary = 'x') => ({
    id,
    summary,
    description: '📌 School Planner에서 관리되는 일정입니다.',
    extendedProperties: { private: { app: 'SchoolPlannerV3', type: 'event', dateStr: '2026-10-27', sp_id: spId, completed: 'false', ...extra } },
  });

  it('넣기·고치기·중복 지우기·빠진 자동 일정 지우기, 수동 것은 남긴다', () => {
    const [p1, p2] = autoPayloads(
      '2026-10-27',
      [
        { id: 'e1', content: '하나', label: '공문' },
        { id: 'e2', content: '둘', label: '공문' },
      ],
      labels,
      on
    );
    const existing = [
      ev('g1', 'e1', { sp_auto: 'true' }, p1.summary), // 같음 → 그대로
      ev('g1dup', 'e1', { sp_auto: 'true' }), // 중복 → 지움
      ev('g9', 'e9', { sp_auto: 'true' }), // V4에서 빠짐 → 지움
      ev('gm', 'e8'), // 수동으로만 보낸 것 → 남김
      { id: 'gc', extendedProperties: { private: { type: 'class', dateStr: '2026-10-27' } } }, // 수업 → 건드리지 않음
    ];
    const plan = planDateSync(existing, [p1, p2]);
    expect(plan.post.map((p) => p.extendedProperties.private.sp_id)).toEqual(['e2']);
    expect(plan.put).toEqual([]);
    expect(plan.del.sort()).toEqual(['g1dup', 'g9']);
    // 판단할 수 없을 때(라벨 설정을 못 받음) 남길 id를 주면 그 일정은 지우지 않는다
    expect(planDateSync(existing, [p1, p2], new Set(['e1', 'e2', 'e9'])).del).toEqual(['g1dup']);
  });

  it("'구글 캘린더'를 끈 일정(그날 V4에 있음)은 구글에서 지운다 (2026-10-07)", () => {
    const list = [
      { id: 'e1', content: '하나', label: '공문' },
      { id: 'e2', content: '둘', label: '공문', gcal: false }, // 일정 칸에서 끔
    ];
    const payloads = autoPayloads('2026-10-27', list, labels, on);
    expect(payloads.map((p) => p.extendedProperties.private.sp_id)).toEqual(['e1']);
    const existing = [ev('g1', 'e1', { sp_auto: 'true' }, payloads[0].summary), ev('g2', 'e2', { sp_auto: 'true' })];
    const plan = planDateSync(existing, payloads);
    expect(plan.del).toEqual(['g2']);
    expect(plan.post).toEqual([]);
    // 라벨에서 끈 것도 같다 (켠 라벨이 없으면 보낼 것이 없어 둘 다 지운다)
    expect(planDateSync(existing, autoPayloads('2026-10-27', list, labels, new Set())).del.sort()).toEqual(['g1', 'g2']);
  });

  it('완료로 글이 바뀌거나 자동 표시가 없던 짝은 PUT', () => {
    const [p] = autoPayloads('2026-10-27', [{ id: 'e1', content: '하나', label: '공문', completed: true }], labels, on);
    expect(planDateSync([ev('g1', 'e1', { sp_auto: 'true' })], [p]).put.map((x) => x.id)).toEqual(['g1']);
    expect(planDateSync([ev('g1', 'e1', {}, p.summary)], [p]).put.map((x) => x.id)).toEqual(['g1']);
  });
});
