import { describe, it, expect, beforeEach } from 'vitest';
import { useAppStore } from './useAppStore';

// 쓰는 칸(메모·기록·일정·알림장·출석부)은 쌓인다.
// 새 일정 칸을 연 채 새 기록을 열면 일정 칸이 기록 칸으로 바뀌던 것.

beforeEach(() => useAppStore.setState({ entryPanels: [], entryPanel: null }));
const st = () => useAppStore.getState();

describe('쓰는 칸 쌓기', () => {
  it('새 일정 칸을 연 채 새 기록을 열면 둘 다 남고, 기록이 맨 위', () => {
    st().openEntryPanel({ kind: 'event', groupId: null, dateStr: '2026-09-29' });
    st().openEntryPanel({ kind: 'journal', groupId: null, dateStr: '2026-09-29' });
    expect(st().entryPanels.map((p) => p.kind)).toEqual(['event', 'journal']);
    expect(st().entryPanel?.kind).toBe('journal');
  });

  it('새로 쓰는 칸은 같은 종류라도 따로 쌓인다', () => {
    st().openEntryPanel({ kind: 'memo', groupId: null });
    st().openEntryPanel({ kind: 'memo', groupId: null });
    expect(st().entryPanels).toHaveLength(2);
    const [a, b] = st().entryPanels;
    expect(a.openedAt).not.toBe(b.openedAt);
  });

  it('이미 열린 항목을 다시 열면 새로 만들지 않고 맨 위로 올린다', () => {
    st().openEntryPanel({ kind: 'event', groupId: null, dateStr: 'd', entryId: 'e1' });
    st().openEntryPanel({ kind: 'journal', groupId: null, dateStr: 'd' });
    const firstKey = st().entryPanels[0].openedAt;
    st().openEntryPanel({ kind: 'event', groupId: null, dateStr: 'd', entryId: 'e1' });
    expect(st().entryPanels.map((p) => p.kind)).toEqual(['journal', 'event']);
    expect(st().entryPanel?.openedAt).toBe(firstKey);
  });

  it('닫기는 그 칸만, id 알리기도 그 칸만', () => {
    st().openEntryPanel({ kind: 'journal', groupId: null, dateStr: 'd' });
    st().openEntryPanel({ kind: 'memo', groupId: null });
    const [j, m] = st().entryPanels;
    st().setEntryPanelId('new-journal', undefined, j.openedAt);
    expect(st().entryPanels[0].entryId).toBe('new-journal');
    expect(st().entryPanels[1].entryId).toBeUndefined();
    st().closeEntryPanel(m.openedAt);
    expect(st().entryPanels.map((p) => p.kind)).toEqual(['journal']);
  });

  it('지운 항목의 칸은 모두 닫는다', () => {
    st().openEntryPanel({ kind: 'event', groupId: null, dateStr: 'd', entryId: 'e1' });
    st().openEntryPanel({ kind: 'event', groupId: null, dateStr: 'd', entryId: 'e2' });
    st().closeEntryPanelsFor('event', 'e1');
    expect(st().entryPanels.map((p) => p.entryId)).toEqual(['e2']);
  });
});
