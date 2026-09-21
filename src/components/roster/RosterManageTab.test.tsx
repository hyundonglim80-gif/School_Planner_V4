// src/components/roster/RosterManageTab.test.tsx
//
// 사진을 누르면 크게 띄우는 자리로 이어지는지 본다.
//
// 예전에는 사진 위에 카메라 단추가 얹혀 있어서, 얼굴을 보려고 누르면 파일
// 고르는 창이 열렸다. 이제 사진을 누르면 크게 뜨고, 바꾸는 일은 그 창 아래에서
// 한다. 목록 보기와 타일 보기가 같게 움직여야 한다.
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import RosterManageTab from './RosterManageTab';
import type { Student } from '../../hooks/useRoster';

const students: Student[] = [
  { num: 1, name: '홍길동', gender: '남', isActive: true } as Student,
  { num: 2, name: '성춘향', gender: '여', isActive: true } as Student,
];

const photos = new Map([
  [1, { url: 'blob:fake-1', exact: true, fileName: '2026-3-1-01-홍길동.webp' }],
]);

function setup(view: 'list' | 'tile', onOpenPhoto = vi.fn()) {
  render(
    <RosterManageTab
      students={students}
      view={view}
      showPhoto
      photos={photos as any}
      canUploadPhoto
      uploadingNum={null}
      onUploadPhoto={vi.fn()}
      onOpenPhoto={onOpenPhoto}
      onUpdateStudent={vi.fn()}
      onRemoveStudent={vi.fn()}
    />
  );
  return onOpenPhoto;
}

describe('학생 사진을 누르면 크게 띄운다', () => {
  it.each(['list', 'tile'] as const)('%s 보기에서 사진을 누르면 그 학생으로 알려 준다', async (view) => {
    const onOpenPhoto = setup(view);
    const photo = screen.getByTitle('홍길동 사진 크게 보기');
    await userEvent.click(photo);
    expect(onOpenPhoto).toHaveBeenCalledTimes(1);
    expect(onOpenPhoto.mock.calls[0][0].num).toBe(1);
    expect(onOpenPhoto.mock.calls[0][1]).toBe('blob:fake-1');
  });

  it.each(['list', 'tile'] as const)('%s 보기에서 사진 위에 카메라 단추를 얹지 않는다', (view) => {
    setup(view);
    expect(screen.queryByTitle('사진 바꾸기')).toBeNull();
  });

  it('사진이 없는 학생은 크게 띄울 것이 없으므로 누르는 자리도 없다', () => {
    setup('tile');
    expect(screen.queryByTitle('성춘향 사진 크게 보기')).toBeNull();
    // 대신 올릴 수 있는 빈 칸이 있다
    expect(screen.getByTitle('성춘향 사진 올리기')).toBeTruthy();
  });

  it('타일은 좁은 화면에서 세 칸, 넓은 화면에서 여섯 칸이다', () => {
    const { container } = render(
      <RosterManageTab
        students={students}
        view="tile"
        showPhoto
        photos={photos as any}
        canUploadPhoto
        uploadingNum={null}
        onUploadPhoto={vi.fn()}
        onUpdateStudent={vi.fn()}
        onRemoveStudent={vi.fn()}
      />
    );
    const grid = container.querySelector('.grid');
    expect(grid?.className).toContain('grid-cols-3');
    expect(grid?.className).toContain('sm:grid-cols-6');
  });
});
