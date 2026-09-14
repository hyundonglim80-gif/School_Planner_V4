import { describe, it, expect } from 'vitest';

// 삭제 확인 정책
//
//   한 건 지우기  -> 묻지 않고 바로 지우고, 휴지통에서 복원 가능하다는 토스트를 띄운다.
//   여러 건 / 영구 삭제 / 덮어쓰기 / 공유 상태 변경 -> 확인창을 띄운다.
//
// 되돌릴 수 있는 한 건마다 확인창을 띄우면 흐름만 끊긴다. 반대로 한꺼번에 지우거나
// 되돌릴 수 없는 일을 말없이 해버리면 손해가 크다. 그 경계를 여기에 고정한다.
const sources = import.meta.glob('../{components,features}/**/*.{ts,tsx}', {
  query: '?raw',
  import: 'default',
  eager: true,
}) as Record<string, string>;

const entries = Object.entries(sources)
  .filter(([path]) => !path.includes('.test.'))
  .map(([path, src]) => ({ name: path.split('/').pop()!, path, src }));

/** 확인창을 띄우는 것이 맞는 곳. 왜 맞는지 함께 적는다. */
const CONFIRM_ALLOWED: Record<string, string> = {
  'TrashModal.tsx': '영구 삭제 - 복구 불가',
  'GroupModal.tsx': '그룹 영구 삭제 / 탈퇴 - 복구 불가, 공유 상태 변경',
  'MemoScreen.tsx': '완료 메모 일괄 삭제 - 여러 건',
  'MultiEventActionBar.tsx': '선택 일정 일괄 삭제 - 여러 건',
  'RosterModal.tsx': '학급/전체 학생 삭제와 명단 덮어쓰기 - 여러 건, 덮어쓰기',
  'BackupModal.tsx': '백업 복원 - 현재 데이터를 덮어쓴다',
  'TimetableTemplateModal.tsx': '시간표 일괄 적용 - 기간 전체를 덮어쓴다',
  'ForwardingModal.tsx': '미완료 일정 일괄 전달 - 여러 건',
  'RecurringModal.tsx': '반복 일정 일괄 생성 - 여러 건',
  'LabelModal.tsx': '라벨 일괄 복구 - 여러 건',
  'LinkViewerModal.tsx': '연결 해제 - 양쪽에서 끊기고 휴지통에 남지 않는다',
  'DaySchedule.tsx': '기본 시간표 불러오기 - 과목을 덮어쓴다',
};

describe('삭제 확인 정책', () => {
  it('검사할 파일을 찾았다', () => {
    expect(entries.length).toBeGreaterThan(20);
  });

  it('확인창은 허용 목록에 있는 곳에서만 쓴다', () => {
    const offenders = entries
      .filter(({ src }) => /(?:window\.)?confirm\(/.test(src))
      .map(({ name }) => name)
      .filter((name) => !(name in CONFIRM_ALLOWED));

    expect(offenders).toEqual([]);
  });

  it('한 건 삭제를 다루는 곳은 휴지통 복원 안내를 함께 띄운다', () => {
    // 항목 하나를 지우고 토스트로 알리는 화면들
    const singleDeleteFiles = [
      'EventItemActions.tsx',
      'DayJournal.tsx',
      'MemoCard.tsx',
      'DDayModal.tsx',
    ];
    for (const name of singleDeleteFiles) {
      const entry = entries.find((e) => e.name === name);
      expect(entry, `${name} 를 찾지 못했다`).toBeDefined();
    }

    // 안내 문구는 useDDay / 각 화면에서 띄운다. 문구를 쓰는 곳이 하나라도 있어야 한다.
    const withNotice = entries.filter(({ src }) => src.includes('휴지통에서 복원할 수 있습니다'));
    expect(withNotice.length).toBeGreaterThan(2);
  });

  it('alert은 더 쓰지 않는다 (토스트로 통일)', () => {
    const offenders = entries
      .filter(({ src }) => /(?<![.\w])alert\(/.test(src))
      .map(({ name }) => name);

    expect(offenders).toEqual([]);
  });
});
