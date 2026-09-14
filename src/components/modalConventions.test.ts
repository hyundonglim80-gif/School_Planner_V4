import { describe, it, expect } from 'vitest';

// 팝업 공통 규칙을 코드에서 지키고 있는지 확인한다.
// 팝업이 20개가 넘어 하나씩 눈으로 보기 어렵고, 새 팝업을 만들 때 규칙이 쉽게 어긋난다.
//
// 파일 내용은 Vite의 ?raw 로 읽는다 (node:fs를 쓰면 앱 tsconfig에 Node 타입이 없어 빌드가 깨진다).
const modalSources = import.meta.glob('./*Modal.tsx', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const entries = Object.entries(modalSources).map(([path, src]) => ({
  name: path.replace('./', ''),
  src,
}));

// 이미지 뷰어는 화면 가운데 이미지를 띄우는 것이 맞다.
const CENTERED_BY_DESIGN = ['ImageViewerModal.tsx'];

describe('팝업 공통 규칙', () => {
  it('팝업 파일을 찾았다', () => {
    expect(entries.length).toBeGreaterThan(10);
  });

  it.each(entries.filter((e) => !CENTERED_BY_DESIGN.includes(e.name)))(
    '$name - 내용이 늘어날 때 아래로만 자란다 (items-start)',
    ({ src }) => {
      // 팝업 바깥 틀에 items-center가 있으면 내용이 바뀔 때 위아래로 같이 움직인다
      expect(src).not.toMatch(/inset-0 flex items-center justify-center/);
    }
  );

  it.each(entries)('$name - 배경을 눌러 닫을 수 있다', ({ src }) => {
    expect(src).toContain('closeAllModals');
  });

  it.each(entries)('$name - 닫기 버튼 문구로 "취소"를 쓰지 않는다', ({ src }) => {
    // 저장과 닫기를 분리하기로 했으므로 닫기 쪽 문구는 '닫기'로 통일한다
    expect(src).not.toMatch(/>\s*취소\s*</);
  });
});
