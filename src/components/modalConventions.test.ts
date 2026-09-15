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
    // ModalShell을 쓰면 껍데기가 처리한다. 직접 만든 팝업은 스스로 처리해야 한다.
    const handled = src.includes('ModalShell') || src.includes('closeAllModals');
    expect(handled).toBe(true);
  });

  it.each(entries.filter((e) => !CENTERED_BY_DESIGN.includes(e.name)))(
    '$name - 껍데기를 직접 만들지 않는다 (ModalShell 사용)',
    ({ src, name }) => {
      // 아직 옮기지 못한 팝업은 여기 적어둔다. 옮기면 목록에서 지운다.
      const NOT_MIGRATED = [
        'BackupModal.tsx',
        'DetailEditModal.tsx',
        'EvaluationModal.tsx',
        'LabelModal.tsx',
        'LinkViewerModal.tsx',
        'LinkerModal.tsx',
        'RosterModal.tsx',
        'SearchModal.tsx',
        'TimetableTemplateModal.tsx',
        'TrashModal.tsx',
      ];
      if (NOT_MIGRATED.includes(name)) {
        expect(src).toContain('closeAllModals');
        return;
      }
      expect(src).toContain('ModalShell');
    }
  );

  it.each(entries)('$name - 닫기 버튼 문구로 "취소"를 쓰지 않는다', ({ src }) => {
    // 저장과 닫기를 분리하기로 했으므로 닫기 쪽 문구는 '닫기'로 통일한다
    expect(src).not.toMatch(/>\s*취소\s*</);
  });
});

// Layout이 팝업을 그려만 두고 여는 자리를 안 만들면, 그 팝업은 열 방법이 없다.
// 환경설정이 실제로 그랬다. SettingsModal은 만들어져 있었지만
// setIsSettingsModalOpen(true)를 부르는 곳이 아무 데도 없어 메뉴에서 닿을 수 없었다.
const layoutSrc = Object.entries(
  import.meta.glob('./Layout.tsx', { query: '?raw', import: 'default', eager: true }) as Record<string, string>
)[0][1];

// 지금도 여는 자리가 없는 팝업들. 만들어져 있고 동작도 하는데 화면에서 닿지 못한다.
// 메뉴에 넣을지 말지는 정해야 할 문제라 일단 여기 적어두고 표시만 해둔다.
// 연결하면 이 목록에서 지운다.
const UNREACHABLE_TODO = [
  'setIsRecurringModalOpen', // 반복 일정 등록
  'setIsForwardingModalOpen', // 미완료 일정을 골라서 가져오기 (하루 화면의 자동 이월과는 다른 화면)
];

describe('Layout - 열 수 없는 팝업이 없다', () => {
  const openers = [...layoutSrc.matchAll(/const \[\w+, (set\w+)\] = useState\(false\)/g)]
    .map((m) => m[1])
    .filter((setter) => !UNREACHABLE_TODO.includes(setter));

  it('꺼짐으로 시작하는 상태를 여럿 찾았다', () => {
    expect(openers.length).toBeGreaterThan(5);
  });

  it.each(openers)('%s 를 켜는 자리가 있다', (setter) => {
    // 켜는 자리는 setX(true) 이거나, 눌러서 뒤집는 setX(!X) 형태다
    const opened = layoutSrc.includes(setter + '(true)') || layoutSrc.includes(setter + '(!');
    expect(opened, setter + ' 로 켜는 곳이 없다 - 화면에서 닿을 수 없는 팝업이다').toBe(true);
  });
});
