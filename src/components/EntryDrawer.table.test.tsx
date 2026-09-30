import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import EntryDrawer from './EntryDrawer';

// 메모·기록에 표 붙이기 (lib/entryTable). 엑셀에서 복사해 본문에 붙여넣으면 서식째 표로 붙는다.
// 엑셀은 표와 함께 그 범위의 '그림'도 복사해서, 그림 올리기가 먼저 받으면 표가 그림으로 붙었다.

vi.mock('../hooks/useMinWidth', () => ({ useMinWidth: () => true }));
const uploadSpy = vi.fn();
vi.mock('../hooks/usePasteImageUpload', () => ({
  usePasteImageUpload: () => ({ handlePaste: uploadSpy, pasting: false }),
}));

const EXCEL = `<style>.xl65{font-weight:700;background:#FFFF00}</style>
<table><col width=80><col width=60>
<tr><td class=xl65>이름</td><td class=xl65>점수</td></tr>
<tr><td>김하나</td><td x:num>95</td></tr></table>`;

const baseProps = {
  isOpen: true,
  onClose: vi.fn(),
  kind: 'memo' as const,
  entry: null,
  labelOptions: [],
  docked: true,
};

/** 엑셀 복사처럼: HTML 표 + 글자(탭) + 그림 */
const paste = (el: HTMLElement, html: string, text = '') =>
  fireEvent.paste(el, {
    clipboardData: {
      getData: (type: string) => (type === 'text/html' ? html : type === 'text/plain' ? text : ''),
      items: [{ kind: 'file', type: 'image/png', getAsFile: () => new File(['x'], 'a.png', { type: 'image/png' }) }],
      files: [new File(['x'], 'a.png', { type: 'image/png' })],
    },
  });

beforeEach(() => uploadSpy.mockClear());

describe('쓰는 칸 - 엑셀 표 붙여넣기', () => {
  it('붙여넣으면 서식째 표로 붙고, 그림으로 올리지 않는다. 저장하면 표가 함께 간다', async () => {
    const onSave = vi.fn(async () => {});
    render(<EntryDrawer {...baseProps} onSave={onSave} />);
    const box = screen.getByRole('textbox');
    paste(box, EXCEL, '이름\t점수\n김하나\t95');

    expect(uploadSpy).not.toHaveBeenCalled();
    const cell = await screen.findByText('이름');
    expect(cell.tagName).toBe('TD');
    expect(cell).toHaveStyle({ fontWeight: '700', backgroundColor: '#ffff00' });
    expect(screen.getByText('95')).toHaveStyle({ textAlign: 'right' });
    // 본문에는 글자가 들어가지 않는다
    expect((box as HTMLTextAreaElement).value).toBe('');

    // 글 없이 표만 있어도 저장할 수 있다
    fireEvent.keyDown(window, { key: 's', code: 'KeyS', ctrlKey: true });
    await waitFor(() => expect(onSave).toHaveBeenCalled());
    const draft = (onSave.mock.calls[0] as any[])[0];
    expect(draft.tables).toHaveLength(1);
    expect(draft.tables[0].rows[1].cells.map((c: any) => c.v)).toEqual(['김하나', '95']);
  });

  it('한 칸만 복사했으면 표도 그림도 아니고 글자로 붙는다', () => {
    render(<EntryDrawer {...baseProps} onSave={vi.fn(async () => {})} />);
    paste(screen.getByRole('textbox'), '<table><tr><td>하나</td></tr></table>', '하나');
    expect(uploadSpy).not.toHaveBeenCalled();
    expect(document.querySelector('[data-entry-table]')).toBeNull();
  });

  it('표가 없는 붙여넣기(캡처 그림 등)는 지금처럼 그림 올리기로', () => {
    render(<EntryDrawer {...baseProps} onSave={vi.fn(async () => {})} />);
    paste(screen.getByRole('textbox'), '');
    expect(uploadSpy).toHaveBeenCalled();
  });

  it('칸을 눌러 글자를 고치고 Enter, 줄 넣기·빼기, 표 삭제', async () => {
    const onSave = vi.fn(async () => {});
    render(<EntryDrawer {...baseProps} onSave={onSave} />);
    paste(screen.getByRole('textbox'), EXCEL);

    fireEvent.click(await screen.findByText('김하나'));
    const input = screen.getByLabelText('2줄 1열 칸');
    fireEvent.change(input, { target: { value: '김두리' } });
    fireEvent.keyDown(input, { key: 'Enter' });
    expect(screen.getByText('김두리')).toBeInTheDocument();

    fireEvent.click(screen.getByText('김두리'));
    fireEvent.keyDown(screen.getByLabelText('2줄 1열 칸'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '↓ 줄' }));
    expect(screen.getByText(/3줄 × 2열/)).toBeInTheDocument();
    fireEvent.click(screen.getByText('이름'));
    fireEvent.keyDown(screen.getByLabelText('1줄 1열 칸'), { key: 'Escape' });
    fireEvent.click(screen.getByRole('button', { name: '열 빼기' }));
    expect(screen.getByText(/3줄 × 1열/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: '표 삭제' }));
    expect(document.querySelector('[data-entry-table]')).toBeNull();
  });

  it('칸을 고치다 ESC를 누르면 칸 고치기만 멈춘다 (쓰는 칸은 닫히지 않는다)', async () => {
    const onKey = vi.fn();
    window.addEventListener('keydown', onKey);
    render(<EntryDrawer {...baseProps} onSave={vi.fn(async () => {})} />);
    paste(screen.getByRole('textbox'), EXCEL);
    fireEvent.click(await screen.findByText('김하나'));
    fireEvent.keyDown(screen.getByLabelText('2줄 1열 칸'), { key: 'Escape' });
    expect(onKey).not.toHaveBeenCalledWith(expect.objectContaining({ key: 'Escape' }));
    expect(screen.queryByLabelText('2줄 1열 칸')).toBeNull();
    window.removeEventListener('keydown', onKey);
  });

  it('저장된 표를 열면 보인다', () => {
    render(
      <EntryDrawer
        {...baseProps}
        onSave={vi.fn(async () => {})}
        entry={{ firestoreId: 'm1', content: '성적', tables: [{ id: 't1', createdAt: 1, rows: [{ cells: [{ v: 'A' }, { v: 'B' }] }] }] } as any}
      />
    );
    expect(screen.getByText('A').tagName).toBe('TD');
  });
});
