import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import SettingsModal from './SettingsModal';
import { useAppStore } from '../store/useAppStore';
import { auth } from '../lib/firebase';

const setUser = (email: string | null) => {
  (auth as any).currentUser = { uid: 'test-uid', displayName: '테스트', email };
};

beforeEach(() => {
  vi.clearAllMocks();
  setUser('teacher@school.kr');
  useAppStore.setState({
    showWeekend: true,
    showEvents: true,
    showClass: true,
    enableScrollNav: false,
    startupScope: 'last',
    forwardLookbackDays: 14,
    govApiKey: '',
  });
});

describe('환경설정 - 개발자 전용 항목', () => {
  it('일반 계정에는 공공데이터 API 키 칸이 보이지 않는다', async () => {
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('화면 표시')).toBeInTheDocument());

    expect(screen.queryByText(/개발자 설정/)).not.toBeInTheDocument();
    expect(screen.queryByPlaceholderText(/기본 키 사용/)).not.toBeInTheDocument();
  });

  it('등록된 개발자 계정에만 보인다', async () => {
    setUser('hyundonglim80@gmail.com');
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText(/개발자 설정/)).toBeInTheDocument());

    expect(screen.getByPlaceholderText(/기본 키 사용/)).toBeInTheDocument();
  });
});

describe('환경설정 - 저장과 닫기', () => {
  it('저장 버튼과 닫기 버튼이 따로 있고, 저장해도 창이 닫히지 않는다', async () => {
    const user = userEvent.setup();
    const onClose = vi.fn();
    render(<SettingsModal isOpen onClose={onClose} />);
    await waitFor(() => expect(screen.getByText('화면 표시')).toBeInTheDocument());

    expect(screen.getByRole('button', { name: '닫기' })).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(screen.getByText(/저장되었습니다/)).toBeInTheDocument());
    expect(onClose).not.toHaveBeenCalled();
  });

  it('저장을 눌러야 값이 적용된다 (누르기 전에는 그대로)', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('화면 표시')).toBeInTheDocument());

    await user.click(screen.getByRole('button', { name: '월간' }));
    expect(useAppStore.getState().startupScope).toBe('last');

    await user.click(screen.getByRole('button', { name: '저장' }));
    await waitFor(() => expect(useAppStore.getState().startupScope).toBe('month'));
  });

  it('이월 기간은 쓸 수 있는 범위로 잘려 저장된다', async () => {
    const user = userEvent.setup();
    render(<SettingsModal isOpen onClose={vi.fn()} />);
    await waitFor(() => expect(screen.getByText('이월')).toBeInTheDocument());

    const input = screen.getByRole('spinbutton');
    await user.clear(input);
    await user.type(input, '999');
    await user.click(screen.getByRole('button', { name: '저장' }));

    await waitFor(() => expect(useAppStore.getState().forwardLookbackDays).toBe(60));
  });
});
