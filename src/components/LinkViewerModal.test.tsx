import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinkViewerModal from './LinkViewerModal';
import { getDoc as getDocMock } from 'firebase/firestore';
import { useAppStore } from '../store/useAppStore';

// 연결된 링크 팝업의 '수정'은 예전에 글자만 고치는 칸을 열었다.
// 그래서 캡처 이미지 붙이기·파일 첨부·라벨·링크는 그 항목이 있는 날짜로
// 직접 옮겨 가야만 할 수 있었다. 이제 화면에서 쓰는 편집기를 그대로 연다.
//   일정·수업 -> 일정 수정 팝업
//   기록·메모 -> 옆 배너

const journalLink = {
  targetType: 'journal',
  targetId: 'jr_1',
  targetDate: '2026-09-16',
  title: '[2026-09-16] 기록',
  targetFId: 'personal',
};
const eventLink = {
  targetType: 'event',
  targetId: 'ev_1',
  targetDate: '2026-09-16',
  title: '[2026-09-16] 일정',
  targetFId: 'personal',
};

/** 출발지(일정)가 위 링크들을 달고 있는 상태를 흉내낸다 */
function mockSource(links: any[]) {
  (getDocMock as any).mockImplementation(async () => ({
    exists: () => true,
    data: () => ({
      eventList: [{ id: 'src-1', content: '출발 일정', linkedItems: links }],
      entries: [],
      periods: {},
    }),
  }));
}

const props = {
  isOpen: true,
  onClose: vi.fn(),
  sourceType: 'event',
  sourceDateStr: '2026-09-16',
  sourceId: 'src-1',
  sourceFId: 'personal',
};

beforeEach(() => {
  vi.clearAllMocks();
  useAppStore.setState({
    isEntryEditorOpen: false,
    entryEditorTarget: null,
    isDetailEditOpen: false,
    detailEditTarget: null,
  });
});

describe('연결된 링크 - 수정 버튼', () => {
  it('기록 링크는 기록·메모 배너를 연다', async () => {
    mockSource([journalLink]);
    const user = userEvent.setup();
    render(<LinkViewerModal {...props} />);

    await user.click(await screen.findByRole('button', { name: /수정/ }));

    const s = useAppStore.getState();
    expect(s.isEntryEditorOpen).toBe(true);
    expect(s.entryEditorTarget).toEqual({
      kind: 'journal',
      dateStr: '2026-09-16',
      id: 'jr_1',
      fId: 'personal',
    });
    // 일정 수정 팝업은 열리지 않는다
    expect(s.isDetailEditOpen).toBe(false);
  });

  it('일정 링크는 일정 수정 팝업을 연다', async () => {
    mockSource([eventLink]);
    const user = userEvent.setup();
    render(<LinkViewerModal {...props} />);

    await user.click(await screen.findByRole('button', { name: /수정/ }));

    const s = useAppStore.getState();
    expect(s.isDetailEditOpen).toBe(true);
    expect(s.detailEditTarget).toMatchObject({
      type: 'event',
      dateStr: '2026-09-16',
      itemId: 'ev_1',
      fId: 'personal',
    });
    expect(s.isEntryEditorOpen).toBe(false);
  });

  it('글자만 고치는 칸은 더 이상 열지 않는다', async () => {
    mockSource([journalLink]);
    const user = userEvent.setup();
    const { container } = render(<LinkViewerModal {...props} />);

    await user.click(await screen.findByRole('button', { name: /수정/ }));

    expect(container.querySelector('textarea')).toBeNull();
    expect(screen.queryByRole('button', { name: /수정 내용 반영/ })).toBeNull();
  });
});
