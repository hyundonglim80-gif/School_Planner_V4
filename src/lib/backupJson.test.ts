import { describe, it, expect, vi, beforeEach } from 'vitest';
import { collection, getDocs, query } from 'firebase/firestore';
import { buildBackupPayload, describeBackup } from './backupJson';

// JSON 백업 만들기 (docs/ROADMAP.md 3-1). 내보내기 창과 드라이브 자동 백업이 같이 쓴다.

/** 컬렉션 경로 → [id, data][] */
let DATA: Record<string, Array<[string, any]>>;
beforeEach(() => {
  vi.mocked(collection).mockImplementation(((_db: any, ...segs: string[]) => ({ path: segs.join('/') })) as any);
  vi.mocked(query).mockImplementation(((ref: any) => ref) as any);
  vi.mocked(getDocs).mockImplementation((async (ref: any) => ({
    forEach: (fn: any) => (DATA[ref.path] || []).forEach(([id, data]) => fn({ id, data: () => data })),
  })) as any);
  DATA = {
    'users/u1/events': [['2026-10-01', { eventList: [{ id: 'a' }] }]],
    'users/u1/schedules': [['2026-10-01', { periods: {} }]],
    'users/u1/journals': [['2026-10-01', { entries: [] }]],
    'users/u1/notices': [['2026-10-01', { lines: ['우유'] }]],
    'users/u1/tasks': [['m1', { text: '메모' }]],
    'users/u1/evaluations': [['2026-10-01', { evalList: [] }]],
    'users/u1/settings': [
      ['labels', { eventLabels: [] }],
      ['rosters', { classList: [] }],
      ['backup_config', { sheetId: 'x' }],
    ],
    'users/u1/attendance': [
      ['2026_1_1_2026-10-01', { date: '2026-10-01', records: {} }],
      ['2026_1_1_2026-09-01', { date: '2026-09-01', records: {} }],
    ],
    'groups/g1/events': [['2026-10-02', { eventList: [{ id: 'g' }] }]],
  };
});

const ALL = { events: true, schedules: true, journals: true, evaluations: true, memos: true, rosters: true };

describe('JSON 백업 만들기', () => {
  it('개인 공간 전체: 알림장·출석부·설정까지 담고, 기기에 매인 연결 정보(backup_config)는 뺀다', async () => {
    const p = await buildBackupPayload({ uid: 'u1', scope: 'personal', scopeName: '개인', include: ALL });
    expect(p.version).toBe('SP4-UNIFIED-BACKUP');
    expect(p.period).toBe('all');
    expect(Object.keys(p.events)).toEqual(['2026-10-01']);
    expect(Object.keys(p.notices)).toEqual(['2026-10-01']);
    expect(Object.keys(p.tasks)).toEqual(['m1']);
    expect(Object.keys(p.attendance)).toHaveLength(2);
    expect(Object.keys(p.settings).sort()).toEqual(['labels', 'rosters']);
    expect(Object.keys(p.rosters)).toEqual(['rosters']);
    expect(describeBackup(p)).toBe('일정 1일, 수업 1일, 기록 1일, 알림장 1일, 메모 1건, 조사표 1일, 출석부 2건');
  });

  it('알림장은 기록과 함께, 출석부는 명렬표와 함께만 담긴다', async () => {
    const p = await buildBackupPayload({ uid: 'u1', scope: 'personal', scopeName: '개인', include: { memos: true } });
    expect(p.notices).toEqual({});
    expect(p.attendance).toEqual({});
    expect(Object.keys(p.tasks)).toEqual(['m1']);
  });

  it('기간을 주면 출석부는 안의 날짜로 거른다', async () => {
    const p = await buildBackupPayload({
      uid: 'u1',
      scope: 'personal',
      scopeName: '개인',
      startDate: '2026-10-01',
      endDate: '2026-10-31',
      include: ALL,
    });
    expect(p.period).toEqual({ startDate: '2026-10-01', endDate: '2026-10-31' });
    expect(Object.keys(p.attendance)).toEqual(['2026_1_1_2026-10-01']);
  });

  it('공유 그룹은 그 그룹의 자료만, 설정·출석부(개인 것)는 담지 않는다', async () => {
    const p = await buildBackupPayload({ uid: 'u1', scope: 'g1', scopeName: '협의회', include: ALL });
    expect(Object.keys(p.events)).toEqual(['2026-10-02']);
    expect(p.settings).toEqual({});
    expect(p.attendance).toEqual({});
  });
});
