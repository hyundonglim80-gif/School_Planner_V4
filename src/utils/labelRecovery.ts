import { collection, getDocs } from 'firebase/firestore';
import { db } from '../lib/firebase';

const COLOR_CYCLE = ['blue', 'green', 'red', 'orange', 'yellow', 'indigo', 'purple', 'gray'];

export function pickRecoveryColor(index: number): string {
  return COLOR_CYCLE[index % COLOR_CYCLE.length];
}

export interface LabelScanResult {
  missingEventNames: string[];
  missingJournalNames: string[];
  missingMemoNames: string[];
}

// 일정 항목 하나에서 참조하는 라벨 이름들을 추출 (콤마 구분 label 필드 + 레거시 [라벨명] 접두어)
function extractEventLabelNames(item: any): string[] {
  const names: string[] = [];
  if (item.label) {
    names.push(...String(item.label).split(',').map((s: string) => s.trim()).filter(Boolean));
  }
  if (!item.label) {
    const content = item.content || item.text || '';
    const match = typeof content === 'string' ? content.match(/^\[(.*?)\]\s*(.*)$/) : null;
    if (match) names.push(match[1].trim());
  }
  return names;
}

// 기록(일지) 항목에서 참조하는 라벨 이름 추출. label이 'j_'로 시작하면 id 참조이므로 이름 복구가 불가능해 건너뜀
function extractJournalLabelNames(entry: any): string[] {
  if (entry.label && !String(entry.label).startsWith('j_')) {
    return [String(entry.label).trim()].filter(Boolean);
  }
  return [];
}

async function scanDayDocCollection(
  basePaths: string[][],
  colName: 'events' | 'journals'
): Promise<Set<string>> {
  const found = new Set<string>();
  for (const base of basePaths) {
    try {
      const snap = await getDocs(collection(db, ...base, colName));
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        const list = colName === 'events' ? data.eventList || [] : data.entries || [];
        list.forEach((item: any) => {
          const names = colName === 'events' ? extractEventLabelNames(item) : extractJournalLabelNames(item);
          names.forEach((n) => found.add(n));
        });
      });
    } catch (e) {
      console.warn(`라벨 복구 스캔 오류 (${colName}, ${base.join('/')}):`, e);
    }
  }
  return found;
}

async function scanMemoCollection(basePaths: string[][]): Promise<Set<string>> {
  const found = new Set<string>();
  for (const base of basePaths) {
    try {
      const snap = await getDocs(collection(db, ...base, 'tasks'));
      snap.forEach((docSnap) => {
        const data = docSnap.data();
        (data.labels || []).forEach((n: string) => {
          if (n && typeof n === 'string') found.add(n.trim());
        });
      });
    } catch (e) {
      console.warn(`라벨 복구 스캔 오류 (tasks, ${base.join('/')}):`, e);
    }
  }
  return found;
}

// 사용자의 개인 + 소속 그룹 일정/기록/메모 데이터를 전부 조회해서, 현재 라벨 등록 목록에
// 없는(=삭제되었거나 누락된) 라벨 이름들을 찾아낸다. 실제 저장은 호출부에서 처리한다.
export async function scanForMissingLabels(
  uid: string,
  groupIds: string[],
  currentEventNames: string[],
  currentJournalNames: string[],
  currentMemoNames: string[]
): Promise<LabelScanResult> {
  const basePaths: string[][] = [['users', uid], ...groupIds.map((g) => ['groups', g])];

  const [eventNames, journalNames, memoNames] = await Promise.all([
    scanDayDocCollection(basePaths, 'events'),
    scanDayDocCollection(basePaths, 'journals'),
    scanMemoCollection(basePaths),
  ]);

  const eventSet = new Set(currentEventNames);
  const journalSet = new Set(currentJournalNames);
  const memoSet = new Set(currentMemoNames);

  return {
    missingEventNames: [...eventNames].filter((n) => !eventSet.has(n)),
    missingJournalNames: [...journalNames].filter((n) => !journalSet.has(n)),
    missingMemoNames: [...memoNames].filter((n) => !memoSet.has(n)),
  };
}
