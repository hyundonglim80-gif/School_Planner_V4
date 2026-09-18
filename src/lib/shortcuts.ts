// src/lib/shortcuts.ts
//
// 단축키 한 곳.
//
// 예전에는 Layout의 키 처리와 사용 설명서의 목록이 따로 적혀 있어서, 키를 하나
// 바꾸면 설명서가 그대로 남아 실제와 달라졌다(실제로 일정 토글은 설명서에도
// 버튼 툴팁에도 없었다). 이제 여기 적힌 것을 처리도 보고 설명서도 본다.

/** 누르는 조합 하나 */
export interface Binding {
  ctrl: boolean;
  alt: boolean;
  shift: boolean;
  /** 'F' 'A' '1' '/' 같은 한 글자, 또는 'ArrowUp' 'Space' 'Enter' 같은 이름 */
  key: string;
}

export type ShortcutId =
  | 'search'
  | 'scopeDay'
  | 'scopeWeek'
  | 'scopeMonth'
  | 'scopeYear'
  | 'scopeMemo'
  | 'scopePrev'
  | 'scopeNext'
  | 'datePrev'
  | 'dateNext'
  | 'dateToday'
  | 'toggleWeekend'
  | 'toggleEvents'
  | 'toggleClass'
  | 'multiSelect'
  | 'calendar'
  | 'dday'
  | 'trash'
  | 'labels'
  | 'recurring'
  | 'forwarding'
  | 'roster'
  | 'group'
  | 'timetable'
  | 'backup'
  | 'help'
  | 'settings';

export interface ShortcutAction {
  id: ShortcutId;
  label: string;
  group: string;
  def: Binding;
  /**
   * 화살표 위/아래를 짝으로 본다.
   * 켜고 끄는 기능이라 어느 쪽을 눌러도 같은 동작이고, 예전부터 그렇게 써 왔다.
   * 화살표가 아닌 키로 바꾸면 이 규칙은 적용되지 않는다.
   */
  pairArrows?: boolean;
}

const b = (key: string, mods: Partial<Omit<Binding, 'key'>> = {}): Binding => ({
  ctrl: false,
  alt: false,
  shift: false,
  ...mods,
  key,
});

export const SHORTCUT_ACTIONS: ShortcutAction[] = [
  { id: 'search', label: '통합 검색 열기', group: '열기', def: b('F', { ctrl: true }) },

  { id: 'scopeDay', label: '하루 화면', group: '화면 이동', def: b('1', { shift: true }) },
  { id: 'scopeWeek', label: '주간 화면', group: '화면 이동', def: b('2', { shift: true }) },
  { id: 'scopeMonth', label: '월간 화면', group: '화면 이동', def: b('3', { shift: true }) },
  { id: 'scopeYear', label: '년간 화면', group: '화면 이동', def: b('4', { shift: true }) },
  { id: 'scopeMemo', label: '메모 화면', group: '화면 이동', def: b('5', { shift: true }) },
  { id: 'scopePrev', label: '이전 화면으로', group: '화면 이동', def: b('ArrowLeft', { shift: true }) },
  { id: 'scopeNext', label: '다음 화면으로', group: '화면 이동', def: b('ArrowRight', { shift: true }) },

  { id: 'datePrev', label: '이전 날짜', group: '날짜 이동', def: b('ArrowLeft', { ctrl: true }) },
  { id: 'dateNext', label: '다음 날짜', group: '날짜 이동', def: b('ArrowRight', { ctrl: true }) },
  { id: 'dateToday', label: '오늘 날짜로', group: '날짜 이동', def: b('Space', { ctrl: true }) },

  { id: 'toggleWeekend', label: '주말 보이기 / 숨기기', group: '화면 표시', def: b('ArrowUp', { shift: true }), pairArrows: true },
  { id: 'toggleEvents', label: '일정 보이기 / 숨기기', group: '화면 표시', def: b('ArrowUp', { ctrl: true }), pairArrows: true },
  { id: 'toggleClass', label: '수업 보이기 / 숨기기', group: '화면 표시', def: b('ArrowUp', { alt: true }), pairArrows: true },

  // 아래는 기본값이 비어 있다. 쓰고 싶은 사람이 직접 정한다.
  // 자주 쓰는 조합을 미리 차지해 두면 오히려 걸리적거린다.
  { id: 'multiSelect', label: '다중 선택 모드', group: '메뉴 열기', def: b('') },
  { id: 'calendar', label: '캘린더', group: '메뉴 열기', def: b('') },
  { id: 'dday', label: 'D-Day 관리', group: '메뉴 열기', def: b('') },
  { id: 'trash', label: '휴지통', group: '메뉴 열기', def: b('') },
  { id: 'labels', label: '통합 라벨 관리', group: '메뉴 열기', def: b('') },
  { id: 'recurring', label: '반복 일정 등록', group: '메뉴 열기', def: b('') },
  { id: 'forwarding', label: '미완료 일정 가져오기', group: '메뉴 열기', def: b('') },
  { id: 'roster', label: '학급 정보(명렬표) 관리', group: '메뉴 열기', def: b('') },
  { id: 'group', label: '공유 그룹 관리', group: '메뉴 열기', def: b('') },
  { id: 'timetable', label: '시간표 적용 (주간 템플릿)', group: '메뉴 열기', def: b('') },
  { id: 'backup', label: '내보내기 / 가져오기 (백업)', group: '메뉴 열기', def: b('') },
  { id: 'help', label: '사용 설명서 및 단축키', group: '메뉴 열기', def: b('') },
  { id: 'settings', label: '환경설정', group: '메뉴 열기', def: b('') },
];

/** 바꾸지 않는 단축키. 목록에는 보여주되 고칠 수 없다. */
export interface FixedShortcut {
  label: string;
  keys: string;
  why: string;
}

export const FIXED_SHORTCUTS: FixedShortcut[] = [
  {
    label: '모든 팝업창 저장 없이 닫기',
    keys: 'ESC',
    why: '거의 모든 프로그램이 같은 뜻으로 쓰는 키라 바꾸지 않습니다.',
  },
  {
    label: '일정 · 메모 · 기록 · 조사표 즉시 저장',
    keys: 'Ctrl + S',
    why: '입력칸 안에서 동작하는 키라 화면 전체 단축키와 따로 움직입니다.',
  },
];

// ── 키 이름 ────────────────────────────────────────────────────────────

const KEY_LABEL: Record<string, string> = {
  ArrowUp: '↑',
  ArrowDown: '↓',
  ArrowLeft: '←',
  ArrowRight: '→',
  Space: 'Space',
  Enter: 'Enter',
};

/** 화면에 보여줄 이름 ('Ctrl + ↑') */
export function formatBinding(binding: Binding): string {
  if (!binding.key) return '없음';
  const parts: string[] = [];
  if (binding.ctrl) parts.push('Ctrl');
  if (binding.alt) parts.push('Alt');
  if (binding.shift) parts.push('Shift');
  parts.push(KEY_LABEL[binding.key] || binding.key);
  return parts.join(' + ');
}

/** 화살표 위/아래를 짝으로 보는 기능은 '↑ / ↓' 로 보여준다 */
export function formatActionBinding(action: ShortcutAction, binding: Binding): string {
  if (!binding.key) return '없음';
  if (action.pairArrows && (binding.key === 'ArrowUp' || binding.key === 'ArrowDown')) {
    const head = formatBinding({ ...binding, key: 'ArrowUp' }).replace(' + ↑', '');
    return `${head} + ↑ / ↓`;
  }
  return formatBinding(binding);
}

/**
 * 눌린 키를 우리가 쓰는 이름으로 바꾼다.
 *
 * e.key 만 보면 안 된다. Shift+1 은 자판에 따라 e.key 가 '!' 로 오고,
 * 한글 상태에서는 글자 키가 'ㅁ' 처럼 온다. 그래서 자리(e.code)를 먼저 본다.
 */
export function eventKeyOf(e: Pick<KeyboardEvent, 'key' | 'code'>): string {
  const digit = /^Digit([0-9])$/.exec(e.code || '');
  if (digit) return digit[1];
  const letter = /^Key([A-Z])$/.exec(e.code || '');
  if (letter) return letter[1];
  if (e.code === 'Space' || e.key === ' ') return 'Space';
  if (e.key in KEY_LABEL) return e.key;
  if (e.key && e.key.length === 1) return e.key.toUpperCase();
  return e.key;
}

/** 눌린 키를 그대로 조합으로 만든다 (단축키 입력칸에서 쓴다) */
export function bindingFromEvent(e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>): Binding {
  return {
    ctrl: e.ctrlKey || e.metaKey,
    alt: e.altKey,
    shift: e.shiftKey,
    key: eventKeyOf(e),
  };
}

/** 수식키(Ctrl/Alt/Shift)만 눌린 상태인지 */
export function isModifierOnly(e: Pick<KeyboardEvent, 'key'>): boolean {
  return ['Control', 'Alt', 'Shift', 'Meta', 'CapsLock'].includes(e.key);
}

/** 이 조합이 눌렸는가 */
export function matchesEvent(
  binding: Binding,
  e: Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey'>,
  action?: ShortcutAction
): boolean {
  // 키를 정하지 않은 기능은 아무 키에도 걸리지 않는다 (기본값이 비어 있는 것들)
  if (!binding.key) return false;
  if (binding.ctrl !== (e.ctrlKey || e.metaKey)) return false;
  if (binding.alt !== e.altKey) return false;
  if (binding.shift !== e.shiftKey) return false;

  const pressed = eventKeyOf(e);
  if (pressed === binding.key) return true;

  // 켜고 끄는 기능은 ↑ 와 ↓ 를 같이 받는다
  if (action?.pairArrows && (binding.key === 'ArrowUp' || binding.key === 'ArrowDown')) {
    return pressed === 'ArrowUp' || pressed === 'ArrowDown';
  }
  return false;
}

// ── 저장된 값 다루기 ───────────────────────────────────────────────────

export type ShortcutOverrides = Partial<Record<ShortcutId, Binding>>;

/** 기본값 위에 사용자가 바꾼 것을 덮는다 */
export function resolveBindings(overrides: ShortcutOverrides = {}): Record<ShortcutId, Binding> {
  const out = {} as Record<ShortcutId, Binding>;
  for (const action of SHORTCUT_ACTIONS) {
    out[action.id] = overrides[action.id] || action.def;
  }
  return out;
}

/** 같은 조합을 쓰는 기능이 있으면 그 쌍을 돌려준다 */
export function findConflicts(bindings: Record<ShortcutId, Binding>): Array<[ShortcutId, ShortcutId]> {
  const slots = new Map<string, ShortcutId>();
  const conflicts: Array<[ShortcutId, ShortcutId]> = [];

  for (const action of SHORTCUT_ACTIONS) {
    const binding = bindings[action.id];
    if (!binding || !binding.key) continue;

    // ↑ 와 ↓ 를 같이 받는 기능은 두 방향을 한 자리로 본다
    const key =
      action.pairArrows && (binding.key === 'ArrowUp' || binding.key === 'ArrowDown')
        ? 'Arrow↕'
        : binding.key;
    const slot = `${binding.ctrl ? 'C' : ''}${binding.alt ? 'A' : ''}${binding.shift ? 'S' : ''}|${key}`;

    const taken = slots.get(slot);
    if (taken) conflicts.push([taken, action.id]);
    else slots.set(slot, action.id);
  }
  return conflicts;
}

export function labelOf(id: ShortcutId): string {
  return SHORTCUT_ACTIONS.find((a) => a.id === id)?.label || id;
}
