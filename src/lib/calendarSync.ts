// src/lib/calendarSync.ts
//
// 일정·수업·기록을 구글 캘린더로 내보낸다. V3의 js/modules/syncCalendar.js를 옮겨 왔다.
//
// V3와 같은 캘린더에, 같은 표시(app=SchoolPlannerV3)를 달아 넣는다. 표시를 다르게
// 하면 V3가 만들어 둔 일정을 V4가 남남으로 보고 전부 다시 만들어 두 벌이 된다.
//
//   SP(work)        일정
//   SP(class)       수업
//   SP(commentary)  기록
//
// 같은 것을 두 번 넣지 않으려고, 이미 올라가 있는 일정과 하나씩 맞춰 본다.
// 맞는 것이 있으면 고치고, 없으면 새로 넣는다. '교체'로 돌리면 맞지 않은
// 나머지를 지운다.
import { doc, getDoc } from 'firebase/firestore';
import { db } from './firebase';
import { googleFetch, fetchAllGoogleEvents, getOrCreateCalendarByName } from './googleApi';
import { readEventList, eventContentOf } from './eventText';

export type SyncMode = 'merge' | 'overwrite';
export type SyncKind = 'event' | 'class' | 'journal';

/** V3가 쓰는 표시. 바꾸면 V3가 만든 일정을 못 알아본다. */
export const APP_TAG = 'SchoolPlannerV3';

const CALENDAR_NAME: Record<SyncKind, string> = {
  event: 'SP(work)',
  class: 'SP(class)',
  journal: 'SP(commentary)',
};

export interface LabelDef {
  id?: string;
  name: string;
}

export interface GoogleEventPayload {
  summary: string;
  description: string;
  start: { date: string };
  end: { date: string };
  extendedProperties: { private: Record<string, string> };
}

// ── 날짜 ───────────────────────────────────────────────────────────────

/**
 * 종일 일정의 끝 날짜는 '다음 날'이다.
 * 구글은 end.date를 포함하지 않는 것으로 보기 때문에, 같은 날을 넣으면
 * 길이가 0인 일정이 되어 달력에 뜨지 않는다.
 */
export function nextDayStr(dateStr: string): string {
  const [y, m, d] = dateStr.split('-').map(Number);
  const next = new Date(y, m - 1, d + 1);
  return `${next.getFullYear()}-${String(next.getMonth() + 1).padStart(2, '0')}-${String(next.getDate()).padStart(2, '0')}`;
}

export function dateRange(startStr: string, endStr: string): string[] {
  const out: string[] = [];
  let cur = startStr;
  // 시작이 끝보다 늦으면 빈 목록이다
  for (let guard = 0; cur <= endStr && guard < 800; guard++) {
    out.push(cur);
    cur = nextDayStr(cur);
  }
  return out;
}

// ── 표시용 ─────────────────────────────────────────────────────────────

/**
 * 구글 캘린더는 같은 날 안에서 제목 순으로 늘어놓는다. 그대로 두면 순서가
 * 뒤섞이므로, 보이지 않는 글자(폭 없는 문자)를 앞에 붙여 순서를 고정한다.
 */
export function invisiblePrefix(seq: number): string {
  return seq.toString(2).padStart(5, '0').replace(/0/g, '‌').replace(/1/g, '‍');
}

/** 앞에 붙은 보이지 않는 글자와 완료 표시를 떼고 제목만 남긴다 */
export function bareSummary(summary: string): string {
  return (summary || '')
    .replace(/^[‌‍]+/, '')
    .replace(/^✅\s*/, '')
    .trim();
}

/**
 * 구글 캘린더에 올릴 제목.
 *
 * 라벨을 내용 뒤에 붙인다. 앞에 두면 달력의 좁은 칸에서 라벨만 보이고 정작
 * 내용이 잘려 무슨 일인지 알 수 없었다. 완료 표시(✅)는 짧으니 앞에 둔다.
 */
export function composeSummary(seq: number, completed: boolean, content: string, labelStr: string): string {
  return `${invisiblePrefix(seq)}${completed ? '✅ ' : ''}${content} [${labelStr}]`;
}

/**
 * 같은 항목인지 제목으로 맞춰 볼 때 쓰는 알맹이.
 *
 * 우리가 붙인 id가 없는 옛 일정은 제목으로 맞출 수밖에 없는데, 라벨을 앞에 두던
 * 시절에 올라간 것들이 이미 있다. 앞이든 뒤든 [묶음]은 떼어내고 알맹이만 본다.
 * 그래야 '[회의] 학년 협의회'와 '학년 협의회 [회의]'를 같은 것으로 본다.
 */
export function summaryCore(summary: string): string {
  const bare = bareSummary(summary);
  let core = bare;
  let prev = '';
  while (core && core !== prev) {
    prev = core;
    core = core
      .replace(/^\[[^\]]*\]\s*/, '')
      .replace(/\s*\[[^\]]*\]$/, '')
      .trim();
  }
  // 내용이 통째로 [묶음]이었다면 떼어낼 것이 아니다
  return core || bare;
}

/**
 * 사람이 읽을 수 없는 내부 식별자인지.
 *
 * 라벨은 이름('회의')으로 담기기도 하고 식별자('lbl_ev_mtitpq5d_2Ou1v')로
 * 담기기도 한다. 식별자가 등록된 라벨 목록에 없으면 이름을 알 길이 없는데,
 * 예전에는 그럴 때 식별자를 그대로 제목에 찍어서
 *   [lbl_ev_mtitpq5d_2Ou1v] 아침 빙고
 * 같은 제목이 구글 캘린더에 올라갔다.
 */
export function isInternalId(key: string): boolean {
  return /^(lbl|ev|jr|j|mem|task)_/i.test(key) || /^[a-z]+_[a-z0-9]{6,}_/i.test(key);
}

/**
 * 항목에 달린 라벨을 이름으로 바꾼다. 담기는 자리가 제각각이라 모두 훑는다.
 *
 * 이름을 찾지 못한 것은
 *   식별자처럼 생겼으면  버린다 (제목에 찍혀 봐야 읽을 수 없다)
 *   사람이 읽을 수 있으면 그대로 둔다 (설정에서 지운 라벨일 수 있다)
 */
export function labelNamesOf(item: any, master: LabelDef[]): string[] {
  const keys: string[] = [];
  if (Array.isArray(item?.labelIds)) keys.push(...item.labelIds.map((k: any) => String(k ?? '').trim()));
  if (Array.isArray(item?.labels)) keys.push(...item.labels.map((k: any) => String(k ?? '').trim()));
  if (item?.label) keys.push(...String(item.label).split(',').map((k) => k.trim()));

  const names: string[] = [];
  for (const key of keys) {
    if (!key) continue;
    const found = master.find((l) => l.id === key || l.name === key);
    const name = found ? found.name : isInternalId(key) ? null : key;
    if (name && !names.includes(name)) names.push(name);
  }
  return names;
}

// ── 보낼 것 만들기 ─────────────────────────────────────────────────────

interface BuildArgs {
  dateStr: string;
  eventData?: any;
  scheduleData?: any;
  journalData?: any;
  eventLabels: LabelDef[];
  journalLabels: LabelDef[];
  periodNames: string[];
}

/** 하루치를 종류별 payload 목록으로 바꾼다 */
export function buildPayloads(args: BuildArgs): Record<SyncKind, GoogleEventPayload[]> {
  const { dateStr, eventData, scheduleData, journalData, eventLabels, journalLabels, periodNames } = args;
  const endStr = nextDayStr(dateStr);
  const out: Record<SyncKind, GoogleEventPayload[]> = { event: [], class: [], journal: [] };
  let seq = 1;

  // 1) 일정
  if (eventData) {
    const list = readEventList(eventData).filter((e: any) => {
      const content = eventContentOf(e);
      // 구글에서 가져온 것과 공휴일은 도로 올리지 않는다
      return content && content.trim() !== '' && e.source !== 'google_primary' && e.source !== 'holiday';
    });

    for (const e of list) {
      const names = labelNamesOf(e, eventLabels);
      const labelStr = names.length > 0 ? names.join(', ') : '일정';
      const content = eventContentOf(e);
      out.event.push({
        summary: composeSummary(seq++, !!e.completed, content, labelStr),
        description: '📌 School Planner에서 관리되는 일정입니다.',
        start: { date: dateStr },
        end: { date: endStr },
        extendedProperties: {
          private: {
            app: APP_TAG,
            dateStr,
            type: 'event',
            labelStr,
            completed: e.completed ? 'true' : 'false',
            sp_id: e.id || '',
            sp_forwardChainId: e.forwardChainId || '',
          },
        },
      });
    }
  }

  // 2) 수업
  if (scheduleData?.periods) {
    const periods = scheduleData.periods;
    for (let i = 1; i <= periodNames.length; i++) {
      const p = periods[i];
      const subject = p?.subject?.trim();
      // 'X'는 수업 없음 표시다
      if (!subject || subject.toUpperCase() === 'X') continue;

      out.class.push({
        summary: composeSummary(seq++, false, subject, periodNames[i - 1] || `${i}교시`),
        description: '🎒 [수업]',
        start: { date: dateStr },
        end: { date: endStr },
        extendedProperties: {
          private: { app: APP_TAG, dateStr, type: 'class', period: String(i) },
        },
      });
    }
  }

  // 3) 기록
  if (journalData?.entries) {
    for (const j of journalData.entries) {
      if (!j?.content || j.content.trim() === '') continue;
      const names = labelNamesOf(j, journalLabels);
      const labelStr = names.length > 0 ? names.join(', ') : '기록';
      // 제목이 너무 길면 달력에서 읽기 어렵다. 전체 내용은 설명에 넣는다.
      const shown = j.content.length > 25 ? `${j.content.slice(0, 25)}...` : j.content;

      out.journal.push({
        summary: composeSummary(seq++, !!j.completed, shown, labelStr),
        description: `📝 [전체 기록 내용]\n${j.content}`,
        start: { date: dateStr },
        end: { date: endStr },
        extendedProperties: {
          private: {
            app: APP_TAG,
            dateStr,
            type: 'journal',
            labelStr,
            completed: j.completed ? 'true' : 'false',
            sp_id: j.id || '',
          },
        },
      });
    }
  }

  return out;
}

// ── 이미 올라가 있는 것과 맞춰 보기 ────────────────────────────────────

/** 구글에 있는 일정 하나가 이 payload와 같은 것인지 */
export function isSameItem(existing: any, payload: GoogleEventPayload): boolean {
  const ePriv = existing?.extendedProperties?.private;
  const pPriv = payload.extendedProperties.private;
  if (!ePriv) return false;
  if (ePriv.type !== pPriv.type) return false;
  if (ePriv.dateStr !== pPriv.dateStr) return false;

  // 수업은 교시가 곧 신원이다
  if (pPriv.type === 'class') return ePriv.period === pPriv.period;
  // 우리가 붙인 id가 양쪽에 다 있으면 그것으로 본다
  if (ePriv.sp_id && pPriv.sp_id) return ePriv.sp_id === pPriv.sp_id;
  // 옛날에 올라간 것은 id가 없다. 제목의 알맹이로 맞춰 본다.
  return summaryCore(existing.summary) === summaryCore(payload.summary);
}

/** 고쳐야 할 내용이 있는지 */
export function needsUpdate(existing: any, payload: GoogleEventPayload): boolean {
  return (
    existing.summary !== payload.summary ||
    existing.description !== payload.description ||
    existing.extendedProperties?.private?.completed !== payload.extendedProperties.private.completed
  );
}

// ── 실제로 보내기 ──────────────────────────────────────────────────────

async function pushToCalendar(
  token: string,
  calId: string,
  payloads: GoogleEventPayload[],
  existing: any[],
  mode: SyncMode
) {
  const base = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events`;
  const matched = new Set<string>();

  for (const payload of payloads) {
    const hit = existing.find((ev) => !matched.has(ev.id) && isSameItem(ev, payload));
    if (hit) {
      matched.add(hit.id);
      if (needsUpdate(hit, payload)) {
        try {
          await googleFetch(`${base}/${hit.id}`, 'PUT', token, payload);
        } catch (e) {
          console.warn('구글 일정 수정 실패:', e);
        }
      }
    } else {
      try {
        await googleFetch(base, 'POST', token, payload);
      } catch (e) {
        console.warn('구글 일정 추가 실패:', e);
      }
    }
  }

  // '교체'는 우리 표시가 붙은 것 중 이번에 짝을 못 찾은 것을 지운다.
  // 사용자가 구글에서 직접 만든 일정에는 이 표시가 없으므로 건드리지 않는다.
  if (mode === 'overwrite') {
    for (const ev of existing.filter((e) => !matched.has(e.id))) {
      try {
        await googleFetch(`${base}/${ev.id}`, 'DELETE', token);
      } catch (e) {
        console.warn('구글 일정 삭제 실패:', e);
      }
    }
  }
}

export interface ExportArgs {
  token: string;
  startStr: string;
  endStr: string;
  mode: SyncMode;
  include: Record<SyncKind, boolean>;
  /** 개인/그룹에 따라 컬렉션 경로를 정해 준다 */
  colPathOf: (col: 'events' | 'schedules' | 'journals') => string;
  periodNames: string[];
  eventLabels: LabelDef[];
  journalLabels: LabelDef[];
  onProgress?: (msg: string, percent: number) => void;
}

export interface ExportResult {
  days: number;
  counts: Record<SyncKind, number>;
}

export async function exportCalendarData(args: ExportArgs): Promise<ExportResult> {
  const { token, startStr, endStr, mode, include, colPathOf, onProgress } = args;
  const kinds = (['event', 'class', 'journal'] as SyncKind[]).filter((k) => include[k]);
  if (kinds.length === 0) throw new Error('보낼 대상을 하나 이상 골라 주세요.');

  const timeMin = new Date(`${startStr}T00:00:00+09:00`).toISOString();
  const timeMax = new Date(`${endStr}T23:59:59+09:00`).toISOString();

  onProgress?.('캘린더를 확인하는 중...', 5);
  const calIds = {} as Record<SyncKind, string>;
  for (const kind of kinds) {
    calIds[kind] = await getOrCreateCalendarByName(token, CALENDAR_NAME[kind]);
  }

  onProgress?.('이미 올라가 있는 일정을 확인하는 중...', 15);
  const existingByKind = {} as Record<SyncKind, Record<string, any[]>>;
  await Promise.all(
    kinds.map(async (kind) => {
      const byDate: Record<string, any[]> = {};
      const events = await fetchAllGoogleEvents(token, calIds[kind], timeMin, timeMax, {
        privateExtendedProperty: `app=${APP_TAG}`,
      });
      for (const ev of events) {
        const d = ev.extendedProperties?.private?.dateStr;
        if (!d) continue;
        (byDate[d] ||= []).push(ev);
      }
      existingByKind[kind] = byDate;
    })
  );

  const days = dateRange(startStr, endStr);
  const counts: Record<SyncKind, number> = { event: 0, class: 0, journal: 0 };
  let touched = 0;

  for (let i = 0; i < days.length; i++) {
    const dateStr = days[i];
    onProgress?.(`구글 캘린더에 반영하는 중... (${dateStr})`, 20 + (75 * (i + 1)) / days.length);

    const [eventSnap, scheduleSnap, journalSnap] = await Promise.all([
      include.event ? getDoc(doc(db, colPathOf('events'), dateStr)) : Promise.resolve(null),
      include.class ? getDoc(doc(db, colPathOf('schedules'), dateStr)) : Promise.resolve(null),
      include.journal ? getDoc(doc(db, colPathOf('journals'), dateStr)) : Promise.resolve(null),
    ]);

    const payloads = buildPayloads({
      dateStr,
      eventData: eventSnap?.exists() ? eventSnap.data() : undefined,
      scheduleData: scheduleSnap?.exists() ? scheduleSnap.data() : undefined,
      journalData: journalSnap?.exists() ? journalSnap.data() : undefined,
      eventLabels: args.eventLabels,
      journalLabels: args.journalLabels,
      periodNames: args.periodNames,
    });

    for (const kind of kinds) {
      const existing = existingByKind[kind][dateStr] || [];
      // 보낼 것도 없고 지울 것도 없으면 건너뛴다
      if (payloads[kind].length === 0 && existing.length === 0) continue;
      await pushToCalendar(token, calIds[kind], payloads[kind], existing, mode);
      counts[kind] += payloads[kind].length;
      touched++;
    }
  }

  onProgress?.('완료', 100);
  return { days: touched > 0 ? days.length : 0, counts };
}
