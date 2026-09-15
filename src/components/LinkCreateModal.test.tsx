import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import LinkCreateModal from './LinkCreateModal';
import { setDoc as setDocMock, addDoc as addDocMock } from 'firebase/firestore';

vi.mock('../hooks/useLabels', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../hooks/useLabels')>();
  return {
    ...actual,
    useLabels: () => ({
      eventLabels: [{ id: '1', name: '수업', color: 'blue' }],
      journalLabels: [{ id: '1', name: '상담', color: 'green' }],
      memoLabels: ['업무'],
      getLabelColor: () => 'blue',
    }),
  };
});

const props = {
  isOpen: true as const,
  type: 'event' as const,
  defaultDate: '2026-09-15',
  fId: 'personal',
  colPathOf: (col: string) => `users/test-uid/${col}`,
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe('새 항목 만들어 연결 - 입력칸', () => {
  it('일정은 내용·날짜·라벨을 정할 수 있다', () => {
    render(<LinkCreateModal {...props} onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.getByPlaceholderText('새 일정 내용')).toBeInTheDocument();
    expect(screen.getByLabelText('날짜')).toHaveValue('2026-09-15');
    expect(screen.getByRole('button', { name: '수업' })).toBeInTheDocument();
  });

  it('메모는 날짜 칸이 없다 (날짜에 매이지 않는다)', () => {
    render(<LinkCreateModal {...props} type="memo" onClose={vi.fn()} onCreated={vi.fn()} />);

    expect(screen.queryByLabelText('날짜')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '업무' })).toBeInTheDocument();
  });

  it('내용이 비어 있으면 저장할 수 없다', () => {
    render(<LinkCreateModal {...props} onClose={vi.fn()} onCreated={vi.fn()} />);
    expect(screen.getByRole('button', { name: '저장' })).toBeDisabled();
  });
});

describe('새 항목 만들어 연결 - 저장', () => {
  it('저장하면 만들고, 연결 목록에 담고, 창을 닫아 연결창으로 돌아간다', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    const onCreated = vi.fn();
    render(<LinkCreateModal {...props} onClose={onClose} onCreated={onCreated} />);

    await user.type(screen.getByPlaceholderText('새 일정 내용'), '학년 협의회');
    await user.click(screen.getByRole('button', { name: '수업' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());

    const created = onCreated.mock.calls[0][0];
    expect(created.type).toBe('event');
    expect(created.title).toBe('학년 협의회');
    expect(created.date).toBe('2026-09-15');
    // 담은 뒤 스스로 닫혀야 원래의 연결창이 다시 보인다
    expect(onClose).toHaveBeenCalled();
  });

  it('일정은 V3도 읽을 수 있는 모양으로 저장한다', async () => {
    const user = userEvent.setup();
    render(<LinkCreateModal {...props} onClose={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('새 일정 내용'), '학년 협의회');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(setDocMock).toHaveBeenCalled());
    const payload = (setDocMock as any).mock.calls[0][1];
    // V4는 eventList, V3는 eventText를 읽는다. 둘 다 써야 한쪽에서 사라지지 않는다.
    expect(payload).toHaveProperty('eventList');
    expect(payload).toHaveProperty('eventText');
  });

  it('메모는 tasks 컬렉션에 새 문서로 들어간다', async () => {
    const user = userEvent.setup();
    render(<LinkCreateModal {...props} type="memo" onClose={vi.fn()} onCreated={vi.fn()} />);

    await user.type(screen.getByPlaceholderText('새 메모 내용'), '준비물 확인');
    await user.click(screen.getByRole('button', { name: '업무' }));
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(addDocMock).toHaveBeenCalled());
    const payload = (addDocMock as any).mock.calls[0][1];
    expect(payload.content).toBe('준비물 확인');
    expect(payload.text).toBe('준비물 확인'); // V3 호환
    expect(payload.labels).toEqual(['업무']);
  });

  it('라벨을 고르지 않아도 저장된다', async () => {
    const user = userEvent.setup();
    const onCreated = vi.fn();
    render(<LinkCreateModal {...props} type="memo" onClose={vi.fn()} onCreated={onCreated} />);

    await user.type(screen.getByPlaceholderText('새 메모 내용'), '메모만');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(onCreated).toHaveBeenCalled());
    expect((addDocMock as any).mock.calls[0][1].labels).toEqual([]);
  });
});
