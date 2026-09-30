import { describe, it, expect } from 'vitest';
import { readJournalEntries } from './journalEntries';

describe('readJournalEntries', () => {
  it('id 없는 옛 기록에 화면과 같은 jr_차례를 붙이고, 있는 것은 그대로 둔다', () => {
    const kept = { id: 'jr_a', content: '있음', v3Extra: 1 };
    const list = readJournalEntries({ entries: [{ content: '옛 기록' }, kept, null] });
    expect(list.map((j) => j.id)).toEqual(['jr_0', 'jr_a', 'jr_2']);
    expect(list[0].content).toBe('옛 기록');
    expect(list[1]).toBe(kept);
  });

  it('entries가 없거나 배열이 아니면 빈 목록', () => {
    expect(readJournalEntries({})).toEqual([]);
    expect(readJournalEntries(null)).toEqual([]);
    expect(readJournalEntries({ entries: 'x' })).toEqual([]);
  });
});
