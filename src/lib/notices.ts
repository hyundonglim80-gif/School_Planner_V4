// src/lib/notices.ts
//
// 알림장. 날짜마다 한 장, 줄마다 한 항목.
//
// 저장 자리: users/{uid}/notices/{날짜}  (공유 그룹이면 groups/{gid}/notices/{날짜})
// 일정·기록과 같이 지금 보고 있는 공간을 따른다.
//
// 저장하면 그날 기록 칸에도 '알림장' 라벨 항목을 남긴다 (lib/autoJournal).
import { collection, doc, documentId, getDocs, query, setDoc, where } from 'firebase/firestore';
import { db, auth } from './firebase';
import { getDocTrustingServer } from './firestoreSubscribe';
import { readEventList } from './eventText';
import { isHolidayEvent } from './holiday';
import { addDays, parseDateStr } from './dateUtils';
import { autoJournalId, upsertAutoJournal } from './autoJournal';

export interface NoticeDoc {
  date: string;
  lines: string[];
  updatedAt?: number;
}

const DAY_NAMES = ['일', '월', '화', '수', '목', '금', '토'];

function noticesCol(groupId: string | null) {
  const uid = auth.currentUser?.uid;
  if (!uid) throw new Error('로그인이 필요합니다.');
  return groupId ? collection(db, 'groups', groupId, 'notices') : collection(db, 'users', uid, 'notices');
}

/** 입력칸의 글을 항목 줄로 나눈다. 앞에 붙은 '1.' '2)' '-' 같은 번호는 뗀다. */
export function splitNoticeLines(text: string): string[] {
  return String(text || '')
    .split('\n')
    .map((l) => l.replace(/^\s*(\d+\s*[.)]|[-•·*])\s*/, '').trim())
    .filter(Boolean);
}

/** 1. … 2. … 꼴로 (복사·기록에 쓴다) */
export function numberedNotice(lines: string[]): string {
  return lines.map((l, i) => `${i + 1}. ${l}`).join('\n');
}

/** '9/29(화)' */
export function shortDateLabel(dateStr: string): string {
  const d = parseDateStr(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY_NAMES[d.getDay()]})`;
}

export async function loadNotice(groupId: string | null, dateStr: string): Promise<NoticeDoc | null> {
  const { snap } = await getDocTrustingServer(doc(noticesCol(groupId), dateStr));
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return { date: dateStr, lines: Array.isArray(data.lines) ? data.lines : [], updatedAt: data.updatedAt };
}

/**
 * 알림장을 저장하고, 그날 기록 칸의 '알림장' 라벨 항목도 맞춘다.
 * 알림장 문서는 그 날짜만의 것이라 통째로 쓴다.
 */
export async function saveNotice(groupId: string | null, dateStr: string, lines: string[]): Promise<void> {
  await setDoc(doc(noticesCol(groupId), dateStr), { date: dateStr, lines, updatedAt: Date.now() });
  await upsertAutoJournal({
    kind: 'notice',
    groupId,
    dateStr,
    entryId: autoJournalId('notice', dateStr),
    // 머리글('[알림장]')은 달지 않는다. 라벨 칩이 이미 '알림장'이고, 기록 카드가
    // 접혔을 때 첫 줄만 보이므로 머리글이 있으면 내용이 하나도 안 보인다.
    content: lines.length ? numberedNotice(lines) : '',
  });
}

/** 기간 안의 알림장 (최근 것부터) */
export async function listNotices(groupId: string | null, start: string, end: string): Promise<NoticeDoc[]> {
  const snap = await getDocs(query(noticesCol(groupId), where(documentId(), '>=', start), where(documentId(), '<=', end)));
  return snap.docs
    .map((d) => {
      const data = d.data() as any;
      return { date: d.id, lines: Array.isArray(data.lines) ? data.lines : [], updatedAt: data.updatedAt };
    })
    .filter((n) => n.lines.length > 0)
    .sort((a, b) => b.date.localeCompare(a.date));
}

/**
 * 다음 수업일. 주말·공휴일·방학은 건너뛴다. 2주 안에 없으면 null.
 * @param isOffDay 공휴일·방학 여부를 알려 주는 함수
 */
export function nextClassDay(dateStr: string, isOffDay: (d: string) => boolean): string | null {
  for (let i = 1; i <= 14; i++) {
    const d = addDays(dateStr, i);
    const dow = parseDateStr(d).getDay();
    if (dow === 0 || dow === 6) continue;
    if (isOffDay(d)) continue;
    return d;
  }
  return null;
}

/**
 * 그날의 준비물과 일정으로 알림장 초안 줄을 만든다.
 *   '국어 준비물: 색연필'
 *   '현장체험학습 동의서 제출'
 * 수업 메모는 교사용이라 넣지 않는다. 완료한 일정과 공휴일 표시용 일정도 뺀다.
 */
export function draftLinesFrom(schedulesData: any, eventsData: any): string[] {
  const lines: string[] = [];
  const periods = schedulesData?.periods || {};
  for (const p of Object.keys(periods).map(Number).sort((a, b) => a - b)) {
    const v = periods[p];
    if (!v || typeof v !== 'object') continue;
    const supplies = String(v.supplies || '').trim();
    if (!supplies) continue;
    const subject = String(v.subject || '').trim();
    lines.push(subject ? `${subject} 준비물: ${supplies}` : `준비물: ${supplies}`);
  }
  for (const ev of eventsData ? readEventList(eventsData) : []) {
    if ((ev as any).completed || isHolidayEvent(ev)) continue;
    const text = String((ev as any).content || (ev as any).text || '').replace(/^\[(.*?)\]\s*/, '').trim();
    if (text) lines.push(text);
  }
  return lines;
}

/** 그날의 수업·일정 문서를 읽어 초안 줄을 만든다 */
export async function loadDraftLines(groupId: string | null, dateStr: string): Promise<string[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const base = groupId ? ['groups', groupId] : ['users', uid];
  const [sch, ev] = await Promise.all([
    getDocTrustingServer(doc(db, base[0], base[1], 'schedules', dateStr)),
    getDocTrustingServer(doc(db, base[0], base[1], 'events', dateStr)),
  ]);
  return draftLinesFrom(sch.snap.exists() ? sch.snap.data() : null, ev.snap.exists() ? ev.snap.data() : null);
}
