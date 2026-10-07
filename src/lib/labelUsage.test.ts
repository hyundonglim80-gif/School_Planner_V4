import { describe, it, expect, vi } from 'vitest';
vi.mock('./firebase', () => ({ db: {} }));
import { countEntryLabelUsage, emptyEntryLabels, usageTotal } from './labelUsage';

const labels = [
  { id: 'j_1', name: '학급활동' },
  { id: 'j_2', name: '학교' },
  { id: 'jm_A학교', name: 'A학교' },
  { id: 'j_3', name: '빈것' },
  { id: 'j_4', name: '옛글' },
];
const parents = { A학교: '학교' };

describe('countEntryLabelUsage', () => {
  const usage = countEntryLabelUsage(
    {
      memoDocs: [{ labels: ['학급활동', ' A학교 '] }, { labels: ['학교', 'A학교'] }, { labels: 'x' }],
      journalDocs: [
        { entries: [{ labelIds: ['j_1'] }, { label: '학교', labelIds: [] }, { content: '[옛글] 내용' }] },
        { entries: 'bad' },
      ],
      trashDocs: [
        { type: 'memo', data: { labels: ['A학교'] } },
        { type: 'journal', data: { labelIds: ['j_1'] } },
        { type: 'event', data: { label: '학교' } },
      ],
    },
    labels,
    parents
  );
  it('메모·기록·휴지통을 따로 센다', () => {
    expect(usage['학급활동']).toEqual({ memo: 1, journal: 1, trash: 1 });
    expect(usage['옛글']).toEqual({ memo: 0, journal: 1, trash: 0 });
  });
  it('상위는 하위 수를 더하되 한 항목은 한 번', () => {
    expect(usage['A학교']).toEqual({ memo: 2, journal: 0, trash: 1 });
    expect(usage['학교']).toEqual({ memo: 2, journal: 1, trash: 1 });
  });
  it('일정 휴지통은 세지 않는다, 빈 라벨은 0', () => {
    expect(usageTotal(usage['빈것'])).toBe(0);
  });
  it('정리 목록: 빈 라벨만, 하위가 있는 상위·맨 위 라벨은 체크를 뺀다', () => {
    const u = { ...usage, 학교: { memo: 0, journal: 0, trash: 0 }, 학급활동: { memo: 0, journal: 0, trash: 0 } };
    expect(emptyEntryLabels(labels, u, parents)).toEqual([
      { id: 'j_1', name: '학급활동', checked: false },
      { id: 'j_2', name: '학교', checked: false },
      { id: 'j_3', name: '빈것', checked: true },
    ]);
  });
});
