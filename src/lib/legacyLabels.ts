// V3는 라벨을 브라우저 localStorage에 저장하고, Firestore에는 저장할 때만
// 부수적으로 동기화한다. V4는 Firestore만 읽기 때문에, V3에서 만든 라벨
// (일정/완료/회의 …)이 V4에서는 아예 보이지 않아 라벨 칩이 전부 사라졌다.
//
// 두 앱은 같은 주소에서 돌아가므로 localStorage를 공유한다. Firestore에
// 라벨이 없으면 V3가 쓰던 값을 읽어 쓰고, 한 번 Firestore에 옮겨 두 앱이
// 같은 곳을 보도록 한다.

export const LEGACY_EVENT_LABELS_KEY = 'workCalendar_eventLabels_v4';
export const LEGACY_JOURNAL_LABELS_KEY = 'workCalendar_journalLabels_v4';
export const LEGACY_MEMO_LABELS_KEY = 'workCalendar_memoLabels';

function readArray(key: string): any[] | null {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) && parsed.length > 0 ? parsed : null;
  } catch {
    return null;
  }
}

export function readLegacyEventLabels(): any[] | null {
  return readArray(LEGACY_EVENT_LABELS_KEY);
}

export function readLegacyJournalLabels(): any[] | null {
  return (
    readArray(LEGACY_JOURNAL_LABELS_KEY) || readArray('workCalendar_journalLabels_v3')
  );
}

export function readLegacyMemoLabels(): any[] | null {
  return readArray(LEGACY_MEMO_LABELS_KEY);
}
