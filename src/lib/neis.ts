// src/lib/neis.ts
//
// 나이스 교육정보 개방 포털(open.neis.go.kr) - 학교 찾기·급식·학사일정 (docs/ROADMAP.md 4번).
//
// - 브라우저에서 바로 부른다 (응답에 Access-Control-Allow-Origin: *).
// - 키: 개발자 키를 Firestore sharedConfig/neis에서 읽는다 (로그인하면 읽기, 개발자만 쓰기 - firestore.rules).
//   admin/config는 개발자만 읽으므로 따로 둔다. 학교마다 자료가 달라 공휴일처럼 개발자가 받아 둘 수 없다.
// - 키가 없거나(규칙 배포 전·키 저장 전) 못 읽으면 키 없이 부른다. 키 없이는 한 번에 5건만 오므로,
//   받은 것이 list_total_count보다 적으면 기간을 반으로 나눠 다시 받는다 (빠짐없이).
// - 학사일정은 표시만 한다 (V3와 함께 쓰는 일정 문서에 쓰지 않는다). 공휴일·토요휴업일은 뺀다 - 공휴일은 따로 보인다.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';
import { addDays, daysBetween } from './dateUtils';

const BASE = 'https://open.neis.go.kr/hub/';
/** 키 없이 한 번에 오는 건수 */
export const KEYLESS_ROWS = 5;
/** 키가 있을 때 한 번에 받는 건수 (나이스 최대) */
const KEYED_ROWS = 1000;
/** 키 없이 기간을 나눠 받을 때 한 번에 부르는 횟수의 끝 (한 해 학사일정도 이 안에 든다) */
const MAX_SPLIT_CALLS = 120;

export interface NeisSchool {
  /** 시도교육청 코드 (ATPT_OFCDC_SC_CODE) */
  officeCode: string;
  officeName: string;
  /** 표준 학교 코드 (SD_SCHUL_CODE) */
  schoolCode: string;
  name: string;
  /** 초등학교 / 중학교 / 고등학교 ... */
  kind: string;
  address: string;
}

export interface NeisDish {
  name: string;
  /** 알레르기 번호 (1 난류 … 19 잣) */
  allergies: number[];
}

export interface NeisMeal {
  /** YYYY-MM-DD */
  date: string;
  /** 조식 / 중식 / 석식 */
  kind: string;
  dishes: NeisDish[];
  calories?: string;
}

export interface NeisScheduleItem {
  /** YYYY-MM-DD */
  date: string;
  name: string;
  content?: string;
  /** 해당 학년 (비어 있으면 전 학년) */
  grades: number[];
  /** 휴업일 / 해당없음 ... (SBTR_DD_SC_NM) */
  dayKind: string;
}

// ── 키 ──────────────────────────────────────────────────────────────
const keyRef = () => doc(db, 'sharedConfig', 'neis');
let keyTask: Promise<string> | null = null;

/** 개발자 키. 없거나 못 읽으면 '' (키 없이 부른다). 한 번 읽은 것을 함께 쓴다 */
export function loadNeisKey(): Promise<string> {
  if (!keyTask) {
    keyTask = getDoc(keyRef())
      .then((snap) => (snap.exists() ? String(snap.data()?.key || '').trim() : ''))
      .catch((e) => {
        console.warn('sharedConfig/neis를 읽지 못했습니다 (규칙 배포 전이면 키 없이 부릅니다).', e);
        return '';
      });
  }
  return keyTask;
}

/** 개발자 설정: 이 키로 나이스가 답하는지 본다 (키 없이 물러서지 않는다). 안 되면 던진다 */
export async function testNeisKey(key: string): Promise<number> {
  const page = await callHub('schoolInfo', { SCHUL_NM: '서울' }, key.trim());
  return page.total;
}

/** 개발자 설정에서 키를 저장한다 */
export async function saveNeisKey(key: string): Promise<void> {
  await setDoc(keyRef(), { key: key.trim(), updatedAt: Date.now(), updatedBy: auth.currentUser?.email || '' }, { merge: true });
  keyTask = null;
}

// ── 부르기 ──────────────────────────────────────────────────────────
const ymd = (dateStr: string) => dateStr.replace(/-/g, '');
const fromYmd = (s: string) => `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;

interface HubPage {
  rows: Record<string, any>[];
  total: number;
}

export class NeisError extends Error {
  code: string;
  constructor(code: string, message?: string) {
    super(`나이스: ${message || code}`);
    this.code = code;
  }
}

/** 키 탓인 오류 - 틀린 키(ERROR-290)·하루 한도(ERROR-337)·사용 제한(INFO-300) */
const isKeyProblem = (e: unknown) => e instanceof NeisError && /^(ERROR-290|ERROR-337|INFO-300)$/.test(e.code);

/**
 * 키로 해 보고, 키 탓에 막히면 이 탭에서는 키 없이 한다.
 * 개발자 키가 만료되거나 한도에 걸려도 모두의 급식·학사일정이 멈추지 않게.
 */
async function withKey<T>(run: (key: string) => Promise<T>): Promise<T> {
  const key = await loadNeisKey();
  try {
    return await run(key);
  } catch (e) {
    if (!key || !isKeyProblem(e)) throw e;
    console.warn('나이스 키로 부르지 못해 키 없이 부릅니다:', e);
    keyTask = Promise.resolve('');
    return run('');
  }
}

/** 한 번 부른다. 자료가 없으면(INFO-200) 빈 목록, 그 밖의 오류는 던진다 */
async function callHub(service: string, params: Record<string, string>, key: string, pIndex = 1): Promise<HubPage> {
  const q = new URLSearchParams({
    Type: 'json',
    pIndex: String(pIndex),
    pSize: String(key ? KEYED_ROWS : KEYLESS_ROWS),
    ...(key ? { KEY: key } : {}),
    ...params,
  });
  const res = await fetch(`${BASE}${service}?${q}`);
  if (!res.ok) throw new Error(`나이스 응답 오류 (${res.status})`);
  const json = await res.json();
  if (json?.RESULT) {
    if (json.RESULT.CODE === 'INFO-200') return { rows: [], total: 0 };
    throw new NeisError(String(json.RESULT.CODE), json.RESULT.MESSAGE);
  }
  const block = json?.[service];
  if (!Array.isArray(block)) throw new Error('나이스 응답을 읽지 못했습니다.');
  const head = block[0]?.head || [];
  const total = Number(head[0]?.list_total_count) || 0;
  const code = head[1]?.RESULT?.CODE;
  if (code && code !== 'INFO-000') throw new NeisError(String(code), head[1]?.RESULT?.MESSAGE);
  return { rows: Array.isArray(block[1]?.row) ? block[1].row : [], total };
}

/**
 * 기간(YYYY-MM-DD ~ YYYY-MM-DD)의 행을 빠짐없이 받는다.
 * 키가 있으면 쪽(pIndex)을 넘기며, 없으면 받은 것이 모자랄 때 기간을 반으로 나눠 다시 받는다.
 */
async function fetchRange(
  service: string,
  params: Record<string, string>,
  fromParam: string,
  toParam: string,
  from: string,
  to: string,
  key: string
): Promise<Record<string, any>[]> {
  const ranged = (a: string, b: string) => ({ ...params, [fromParam]: ymd(a), [toParam]: ymd(b) });
  if (key) {
    const rows: Record<string, any>[] = [];
    for (let p = 1; ; p++) {
      const page = await callHub(service, ranged(from, to), key, p);
      rows.push(...page.rows);
      if (!page.rows.length || rows.length >= page.total) return rows;
    }
  }
  let calls = 0;
  const walk = async (a: string, b: string): Promise<Record<string, any>[]> => {
    calls++;
    const page = await callHub(service, ranged(a, b), '');
    // 하루치가 5건을 넘거나 너무 많이 불렀으면 받은 만큼만 (끝없이 나누지 않는다)
    if (page.rows.length >= page.total || a === b || calls >= MAX_SPLIT_CALLS) return page.rows;
    const mid = addDays(a, Math.floor(daysBetween(a, b) / 2));
    // 두 쪽을 함께 부른다 (차례로 부르면 한 달에 열 번 남짓을 기다린다)
    const [left, right] = await Promise.all([walk(a, mid), walk(addDays(mid, 1), b)]);
    return [...left, ...right];
  };
  return walk(from, to);
}

// ── 읽기 ────────────────────────────────────────────────────────────
/** 'DDISH_NM' 한 줄 → 이름과 알레르기 번호. '무말랭이무침(완제) (5.6.9.18)' */
export function parseDish(raw: string): NeisDish | null {
  const text = raw.replace(/&amp;/g, '&').trim();
  if (!text) return null;
  const m = /^(.*?)\s*\(([\d.\s]+)\)\s*$/.exec(text);
  if (!m) return { name: text, allergies: [] };
  const allergies = m[2]
    .split('.')
    .map((n) => Number(n.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);
  return { name: m[1].trim() || text, allergies };
}

export function parseMealRow(row: Record<string, any>): NeisMeal {
  const dishes = String(row.DDISH_NM || '')
    .split(/<br\s*\/?>/i)
    .map(parseDish)
    .filter((d): d is NeisDish => !!d);
  return {
    date: fromYmd(String(row.MLSV_YMD || '')),
    kind: String(row.MMEAL_SC_NM || '급식'),
    dishes,
    ...(row.CAL_INFO ? { calories: String(row.CAL_INFO).trim() } : {}),
  };
}

const GRADE_FIELDS = [
  'ONE_GRADE_EVENT_YN',
  'TW_GRADE_EVENT_YN',
  'THREE_GRADE_EVENT_YN',
  'FR_GRADE_EVENT_YN',
  'FIV_GRADE_EVENT_YN',
  'SIX_GRADE_EVENT_YN',
] as const;

/** 공휴일(따로 보인다)·토요휴업일(주말)은 뺀다 */
export function isSkippedScheduleRow(row: Record<string, any>): boolean {
  const name = String(row.EVENT_NM || '').trim();
  return !name || row.SBTR_DD_SC_NM === '공휴일' || /^(토요휴업일|일요일|토요일)$/.test(name);
}

export function parseScheduleRow(row: Record<string, any>): NeisScheduleItem {
  const grades = GRADE_FIELDS.map((f, i) => (row[f] === 'Y' ? i + 1 : 0)).filter(Boolean);
  const content = String(row.EVENT_CNTNT || '').trim();
  return {
    date: fromYmd(String(row.AA_YMD || '')),
    name: String(row.EVENT_NM || '').trim(),
    ...(content ? { content } : {}),
    // 모든 학년이면 비워 둔다 (거르지 않는다)
    grades: grades.length === 0 || grades.length === GRADE_FIELDS.length ? [] : grades,
    dayKind: String(row.SBTR_DD_SC_NM || ''),
  };
}

// ── 화면이 부르는 것 ────────────────────────────────────────────────
/** 학교 이름으로 찾기. 결과가 다 오지 않았으면 more: true (이름을 더 적게 한다) */
export async function searchSchools(name: string): Promise<{ schools: NeisSchool[]; more: boolean }> {
  const q = name.trim();
  if (!q) return { schools: [], more: false };
  const page = await withKey((key) => callHub('schoolInfo', { SCHUL_NM: q }, key));
  const schools = page.rows.map((r) => ({
    officeCode: String(r.ATPT_OFCDC_SC_CODE || ''),
    officeName: String(r.ATPT_OFCDC_SC_NM || ''),
    schoolCode: String(r.SD_SCHUL_CODE || ''),
    name: String(r.SCHUL_NM || ''),
    kind: String(r.SCHUL_KND_SC_NM || ''),
    address: String(r.ORG_RDNMA || '').trim(),
  }));
  return { schools, more: page.total > schools.length };
}

export interface SchoolRef {
  officeCode: string;
  schoolCode: string;
}

// 학교·달마다 받은 것을 이 탭에서 잠시 담아 둔다 (화면을 오가며 다시 부르지 않게)
const CACHE_MS = 6 * 60 * 60 * 1000;
const cache = new Map<string, { at: number; task: Promise<unknown> }>();
function cached<T>(id: string, load: () => Promise<T>): Promise<T> {
  const hit = cache.get(id);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.task as Promise<T>;
  const task = load().catch((e) => {
    cache.delete(id); // 실패는 담아 두지 않는다
    throw e;
  });
  cache.set(id, { at: Date.now(), task });
  return task;
}

/** 시험용: 담아 둔 것과 키를 비운다 */
export function clearNeisCache() {
  cache.clear();
  keyTask = null;
}

const monthRange = (month: string) => {
  const from = `${month}-01`;
  const [y, m] = month.split('-').map(Number);
  const last = new Date(y, m, 0).getDate();
  return { from, to: `${month}-${String(last).padStart(2, '0')}` };
};

/** 한 달(YYYY-MM) 급식 */
export function loadMonthMeals(school: SchoolRef, month: string): Promise<NeisMeal[]> {
  return cached(`meal:${school.officeCode}:${school.schoolCode}:${month}`, async () => {
    const { from, to } = monthRange(month);
    const params = { ATPT_OFCDC_SC_CODE: school.officeCode, SD_SCHUL_CODE: school.schoolCode };
    const rows = await withKey((key) => fetchRange('mealServiceDietInfo', params, 'MLSV_FROM_YMD', 'MLSV_TO_YMD', from, to, key));
    return rows.map(parseMealRow).sort((a, b) => a.date.localeCompare(b.date));
  });
}

/** 한 달(YYYY-MM) 학사일정 (공휴일·토요휴업일 뺌) */
export function loadMonthSchedule(school: SchoolRef, month: string): Promise<NeisScheduleItem[]> {
  return cached(`sched:${school.officeCode}:${school.schoolCode}:${month}`, async () => {
    const { from, to } = monthRange(month);
    const params = { ATPT_OFCDC_SC_CODE: school.officeCode, SD_SCHUL_CODE: school.schoolCode };
    const rows = await withKey((key) => fetchRange('SchoolSchedule', params, 'AA_FROM_YMD', 'AA_TO_YMD', from, to, key));
    const seen = new Set<string>();
    return rows
      .filter((r) => !isSkippedScheduleRow(r))
      .map(parseScheduleRow)
      .filter((it) => {
        const id = `${it.date}|${it.name}`;
        if (seen.has(id)) return false;
        seen.add(id);
        return true;
      })
      .sort((a, b) => a.date.localeCompare(b.date));
  });
}
