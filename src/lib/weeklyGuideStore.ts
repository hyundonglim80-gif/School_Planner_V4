// src/lib/weeklyGuideStore.ts
//
// 주간학습안내 (ROADMAP 12-2) - 그 주의 수업·알림장 문서를 읽기만 한다. 셈은 lib/weeklyGuide.
//
//   {공간}/schedules/{날짜}   periods { 교시: { subject, memo|content, supplies } | '과목' }
//   {공간}/notices/{날짜}     lines [알림장 줄]
import { collection, documentId, getDocs, query, where } from 'firebase/firestore';
import { db } from './firebase';
import { periodsFromDoc, type GuideDay } from './weeklyGuide';

const col = (uid: string, groupId: string | null, name: 'schedules' | 'notices') =>
  groupId ? collection(db, 'groups', groupId, name) : collection(db, 'users', uid, name);

/** 그 날짜들의 수업·알림장. 없는 날은 빈 날로. 못 읽으면 던진다 */
export async function loadGuideWeek(uid: string, groupId: string | null, dates: string[]): Promise<GuideDay[]> {
  if (dates.length === 0) return [];
  const first = dates[0];
  const last = dates[dates.length - 1];
  const range = (name: 'schedules' | 'notices') =>
    getDocs(query(col(uid, groupId, name), where(documentId(), '>=', first), where(documentId(), '<=', last)));
  const [sched, notices] = await Promise.all([range('schedules'), range('notices')]);
  const periodsBy = new Map<string, GuideDay['periods']>();
  sched.forEach((d) => periodsBy.set(d.id, periodsFromDoc(d.data()?.periods)));
  const noticesBy = new Map<string, string[]>();
  notices.forEach((d) => {
    const lines = d.data()?.lines;
    noticesBy.set(d.id, Array.isArray(lines) ? lines.map((l: unknown) => String(l ?? '').trim()).filter(Boolean) : []);
  });
  return dates.map((date) => ({ date, periods: periodsBy.get(date) || {}, notices: noticesBy.get(date) || [] }));
}
