import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import type { SelectedLinkItem } from '../components/LinkerModal';
import { eventDocPayload, readEventList } from '../lib/eventText';

export interface ReverseLinkOptions {
  /**
   * 이월 때문에 id가 바뀐 경우, 이월 전 항목을 가리키던 역링크의 id.
   * 새 역링크를 덧붙이는 대신 이 자리를 갈아끼운다.
   * (안 그러면 이월이 하루 돌 때마다 같은 일정의 링크가 하나씩 쌓인다)
   */
  replaceIds?: string[];
  /**
   * 'YYYY-MM-DD' -> 그 날짜에 실제로 남아 있는 일정 id 목록.
   * 여기 실린 날짜를 가리키면서 목록에 없는 id를 가리키는 역링크는 이미 끊어진
   * 것이므로 함께 지운다. 이월이 지나온 날짜만 넘겨서 범위를 좁힌다.
   */
  liveIdsByDate?: Map<string, Set<string>>;
  /** liveIdsByDate로 판단할 저장소. 다른 그룹을 가리키는 링크는 건드리지 않는다. */
  liveFId?: string;
}

const linkIdOf = (l: any) => String(l?.targetId ?? l?.id ?? '');
const linkFIdOf = (l: any) => String(l?.targetFId || 'personal');

/**
 * 역링크 목록에 sourceMeta를 반영한 새 목록을 돌려준다. 바뀐 것이 없으면 null.
 *
 * 이월된 일정은 날마다 새 id로 다시 만들어진다. 그냥 밀어 넣기만 하면 연결된
 * 기록·메모 쪽에는 9월 1일, 9월 2일, 9월 3일 링크가 나란히 쌓인다. 이미 끊어진
 * 앞날짜 링크는 걷어내고 오늘 것 하나만 남긴다.
 */
export function applyReverseLink(
  existing: any[] | undefined,
  sourceMeta: any,
  options?: ReverseLinkOptions
): any[] | null {
  const list = Array.isArray(existing) ? existing : [];
  const newId = linkIdOf(sourceMeta);
  const replaceIds = new Set((options?.replaceIds || []).map(String));
  const liveIds = options?.liveIdsByDate;
  const liveFId = String(options?.liveFId || 'personal');

  const isStale = (l: any) => {
    if (linkIdOf(l) === newId) return false;
    // 종류가 다른 링크(기록/메모/수업)는 이번 일과 무관하다.
    if (String(l?.targetType) !== String(sourceMeta?.targetType)) return false;
    if (replaceIds.has(linkIdOf(l))) return true;
    if (!liveIds) return false;
    if (linkFIdOf(l) !== liveFId) return false;
    const live = liveIds.get(String(l?.targetDate || ''));
    return !!live && !live.has(linkIdOf(l));
  };

  const kept = list.filter((l) => !isStale(l));
  const removedSomething = kept.length !== list.length;

  if (kept.some((l) => linkIdOf(l) === newId)) {
    return removedSomething ? kept : null;
  }
  return [...kept, sourceMeta];
}

export const addReverseLink = async (
  targetLink: SelectedLinkItem,
  sourceMeta: SelectedLinkItem,
  activeFId: string,
  options?: ReverseLinkOptions
) => {
  const tFId = targetLink.targetFId || activeFId;
  const colPath = (col: string) =>
    tFId === 'personal' || !tFId ? `users/${auth.currentUser?.uid}/${col}` : `groups/${tFId}/${col}`;

  try {
    if (targetLink.targetType === 'event') {
      const ref = doc(db, colPath('events'), targetLink.targetDate);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const list = readEventList(snap.data());
        if (list) {
          const item = list.find((e: any) => String(e.id) === String(targetLink.targetId));
          if (item) {
            const next = applyReverseLink(item.linkedItems, sourceMeta, options);
            if (next) {
              item.linkedItems = next;
              await setDoc(ref, eventDocPayload(list), { merge: true });
            }
          }
        }
      }
    } else if (targetLink.targetType === 'journal') {
      const ref = doc(db, colPath('journals'), targetLink.targetDate);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const list = snap.data().entries || [];
        const item = list.find((j: any) => String(j.id) === String(targetLink.targetId));
        if (item) {
          const next = applyReverseLink(item.linkedItems, sourceMeta, options);
          if (next) {
            item.linkedItems = next;
            await setDoc(ref, { entries: list, updatedAt: Date.now() }, { merge: true });
          }
        }
      }
    } else if (targetLink.targetType === 'schedule') {
      const ref = doc(db, colPath('schedules'), targetLink.targetDate);
      const snap = await getDoc(ref);
      const periods = snap.exists() ? (snap.data().periods || {}) : {};
      const pKey = targetLink.targetPeriod
        ? String(targetLink.targetPeriod)
        : String(targetLink.targetId).replace(/.*_/, '');

      let item = periods[pKey];
      if (!item) {
        item = { subject: '', content: '', memo: '', supplies: '', linkedItems: [] };
      } else if (typeof item === 'string') {
        item = { subject: item, content: '', memo: '', supplies: '', linkedItems: [] };
      }

      const next = applyReverseLink(item.linkedItems, sourceMeta, options);
      if (next) {
        item.linkedItems = next;
        periods[pKey] = item;
        await setDoc(ref, { periods, updatedAt: Date.now() }, { merge: true });
      }
    } else if (targetLink.targetType === 'memo') {
      const ref = doc(db, colPath('tasks'), targetLink.targetId);
      const snap = await getDoc(ref);
      if (snap.exists()) {
        const next = applyReverseLink(snap.data().linkedItems, sourceMeta, options);
        if (next) {
          await setDoc(ref, { linkedItems: next, updatedAt: Date.now() }, { merge: true });
        }
      }
    }
  } catch (err) {
    console.warn('addReverseLink error:', err);
  }
};

/**
 * 저장할 때 새로 담긴 링크만 골라 상대 쪽에도 역링크를 넣는다.
 * 기록·메모를 "고쳐" 저장하는 길에는 이 처리가 아예 없어서, 링크 추가 팝업에서
 * 고른 항목이 내 쪽에만 붙고 상대 쪽에는 안 붙었다.
 */
export const syncReverseLinks = async (
  previousLinks: any[] | undefined,
  nextLinks: any[] | undefined,
  sourceMeta: SelectedLinkItem,
  activeFId: string
) => {
  if (!Array.isArray(nextLinks) || nextLinks.length === 0) return;
  const before = new Set((previousLinks || []).map(linkIdOf));
  const added = nextLinks.filter((l) => !before.has(linkIdOf(l)));
  for (const link of added) {
    await addReverseLink(link, sourceMeta, activeFId);
  }
};
