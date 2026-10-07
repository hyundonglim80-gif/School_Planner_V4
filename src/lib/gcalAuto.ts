// src/lib/gcalAuto.ts
//
// 일정 라벨 속성 '구글 캘린더' (19번 U11, docs/ROADMAP-REFINE.md). 켠 라벨의 일정을 V4에서 만들기·고치기·완료·옮기기·지우기를 하면
// 구글 캘린더(SP(work))에도 반영한다. 수동 '구글 캘린더로 보내기'(lib/calendarSync)와 같은 캘린더·같은 글 모양·같은 sp_id.
//
// 자료 (V4 전용 - V3와 같이 쓰는 라벨 객체에 칸을 더하지 않는다):
//   users/{uid}/settings/v4_gcal       { labels: { [일정 라벨 id]: true }, used? } - used: 일정 칸에서 일정 하나라도 켠 적이 있다(라벨을 다 꺼도 보낸다)
//   일정 항목의 gcal(true/false, 없거나 null이면 라벨을 따름) - 일정 칸 속성 줄에서 고친다(2026-10-07)
//   users/{uid}/v4_gcalQueue/{날짜}     { date, at, fails? } - 보낼 날짜. 계정에 있어 다른 기기에서도 보낸다.
// 흐름: 일정 날짜 문서 쓰기(lib/gcalNote.setEventDoc) → 그 날짜를 큐에 → 조용한 토큰이 있으면 곧바로 보낸다(flushGcalQueue).
//   보낼 때 그날 일정을 서버에서 다시 읽어 구글의 그날 것과 맞춘다(lib/gcalPlan) - 무엇을 바꿨는지 따로 들고 다니지 않는다.
// 토큰이 없으면(로그인이 만료) 큐에 남고 머리줄에 '📅 못 보낸 날 N' - 누르면 로그인 창을 열고 보낸다(누른 때라 창이 막히지 않는다).
// 개인 공간 일정만(1차). 클라우드 컨테이너는 googleapis를 막아 점검은 fetch를 흉내 낸다 - 실제 확인은 사용자 PC에서.
import { useEffect, useState } from 'react';
import { collection, doc, getDocFromServer, getDocsFromServer, onSnapshot, runTransaction, setDoc } from 'firebase/firestore';
import { auth, db } from './firebase';
import { onEventDocWrite } from './gcalNote';
import { APP_TAG, type LabelDef } from './calendarSync';
import { autoPayloads, planDateSync } from './gcalPlan';
import { forgetGoogleToken, getGoogleTokenQuietly, getOrCreateCalendarByName, getValidGoogleToken, googleFetch } from './googleApi';
import { readEventList } from './eventText';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';
import { showErrorToast, showToast } from '../utils/toast';

const CALENDAR = 'SP(work)';
const API = 'https://www.googleapis.com/calendar/v3';
/** 일정을 쓰고 이만큼 모였다가 보낸다 (한 번에 여러 날을 쓰는 이월·기간 일정) */
const DEBOUNCE_MS = 1200;
/** 같은 날을 이만큼 못 보내면 한 번 알린다 */
const FAIL_NOTICE = 3;

const state = {
  uid: '' as string,
  enabled: new Set<string>(),
  settingsLoaded: false,
  /** 일정 칸에서 '구글 캘린더'를 켠 적이 있다 - 켠 라벨이 없어도 날짜를 큐에 넣는다 */
  used: false,
  eventLabels: [] as LabelDef[],
  pending: new Set<string>(),
  timer: null as ReturnType<typeof setTimeout> | null,
  flushing: false,
  rerun: false,
  rerunForce: false,
  calId: '' as string,
};
const listeners = new Set<() => void>();
const notify = () => listeners.forEach((fn) => fn());

const queueCol = (uid: string) => collection(db, 'users', uid, 'v4_gcalQueue');
const settingsRef = (uid: string) => doc(db, 'users', uid, 'settings', 'v4_gcal');

/** '구글 캘린더'를 켠 라벨 id들을 저장한다 (라벨 관리 창) */
export async function saveGcalLabels(ids: string[]): Promise<void> {
  const uid = auth.currentUser?.uid;
  if (!uid) return;
  const turnedOff = [...state.enabled].some((id) => !ids.includes(id));
  // merge로 쓰면 끈 라벨이 지도에 남는다 - 문서를 통째로 쓴다(이 문서에는 이것뿐)
  await setDoc(settingsRef(uid), {
    labels: Object.fromEntries(ids.map((id) => [id, true])),
    ...(state.used ? { used: true } : {}),
    updatedAt: Date.now(),
  });
  // 라벨에서 끄면 그 라벨로 보낸 일정도 구글에서 지운다(2026-10-07) - 어느 날인지 모르므로 구글에 자동으로 보낸 날을 모두 큐에 넣고 맞춘다
  if (turnedOff) {
    state.enabled = new Set(ids);
    void queueSentDates();
  }
}

/**
 * 구글에 자동으로 보낸(sp_auto) 일정이 있는 날을 모두 큐에 넣고 보낸다. 조용한 토큰이 없으면 하지 않는다
 * (그 날 일정을 다음에 저장할 때 맞춰진다). 라벨을 모두 꺼도 보내도록 force.
 */
async function queueSentDates(): Promise<void> {
  const uid = state.uid;
  if (!uid) return;
  try {
    const token = await getGoogleTokenQuietly();
    if (!token) return;
    if (!state.calId) state.calId = await getOrCreateCalendarByName(token, CALENDAR);
    const dates = new Set<string>();
    let pageToken = '';
    do {
      const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250' });
      params.append('privateExtendedProperty', `app=${APP_TAG}`);
      params.append('privateExtendedProperty', 'sp_auto=true');
      if (pageToken) params.append('pageToken', pageToken);
      const res = await googleFetch<any>(`${API}/calendars/${encodeURIComponent(state.calId)}/events?${params}`, 'GET', token);
      for (const ev of res?.items || []) {
        const d = ev?.extendedProperties?.private?.dateStr;
        if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d)) dates.add(d);
      }
      pageToken = res?.nextPageToken || '';
    } while (pageToken);
    if (dates.size === 0) return;
    await Promise.all([...dates].map((date) => setDoc(doc(queueCol(uid), date), { date, at: Date.now() }, { merge: true })));
    void flushGcalQueue(false, true);
  } catch (e) {
    console.warn('라벨을 끈 일정을 구글 캘린더에서 지우지 못했습니다:', e);
  }
}

/** 일정 칸에서 '구글 캘린더'를 켰다 - 처음 한 번 계정에 적는다(다른 기기에서도 날짜를 큐에 넣게) */
export function markGcalUsed() {
  const uid = auth.currentUser?.uid;
  if (!uid || state.used) return;
  state.used = true;
  setDoc(settingsRef(uid), { used: true, updatedAt: Date.now() }, { merge: true }).catch((e) =>
    console.warn("'구글 캘린더' 사용 표시를 적지 못했습니다:", e)
  );
}

/** 보낼 일이 있을 수 있나 (켠 라벨이 있거나 일정에서 켠 적이 있다) */
const active = () => state.enabled.size > 0 || state.used;

/** '구글 캘린더'를 켠 라벨 id들 (라벨 관리 창이 열 때 읽는다) */
export async function readGcalLabels(): Promise<string[]> {
  const uid = auth.currentUser?.uid;
  if (!uid) return [];
  const snap = await getDocFromServer(settingsRef(uid));
  const labels = snap.exists() ? snap.data().labels || {} : {};
  return Object.keys(labels).filter((k) => labels[k]);
}

/** 일정 날짜 문서가 바뀌었다 → 큐에 (켠 라벨이 있거나, 일정에서 켠 적이 있거나, 이 목록에 켠 일정이 있을 때만) */
function noteDate(date: string, list?: any[]) {
  if (!state.uid) return;
  if (!active() && !(list || []).some((e) => e?.gcal === true)) return;
  state.pending.add(date);
  if (state.timer) clearTimeout(state.timer);
  state.timer = setTimeout(() => void commitPending(), DEBOUNCE_MS);
}

async function commitPending() {
  state.timer = null;
  const uid = state.uid;
  const dates = [...state.pending];
  state.pending.clear();
  if (!uid || dates.length === 0) return;
  try {
    await Promise.all(dates.map((date) => setDoc(doc(queueCol(uid), date), { date, at: Date.now() }, { merge: true })));
  } catch (e) {
    console.warn('구글 캘린더 보낼 날짜를 적지 못했습니다:', e);
    return;
  }
  void flushGcalQueue(false);
}

const isAuthError = (e: unknown) => /\((401|403)\)/.test(String((e as any)?.message || e));
const isGone = (e: unknown) => /\((404|410)\)/.test(String((e as any)?.message || e));

/** 우리 표시가 붙은 그날 구글 일정 (실패하면 던진다 - 빈 목록으로 알면 두 벌을 넣는다) */
async function listDay(token: string, calId: string, date: string): Promise<any[]> {
  const out: any[] = [];
  let pageToken = '';
  do {
    const params = new URLSearchParams({ singleEvents: 'true', maxResults: '250' });
    params.append('privateExtendedProperty', `app=${APP_TAG}`);
    params.append('privateExtendedProperty', `dateStr=${date}`);
    if (pageToken) params.append('pageToken', pageToken);
    const res = await googleFetch<any>(`${API}/calendars/${encodeURIComponent(calId)}/events?${params}`, 'GET', token);
    out.push(...(res?.items || []));
    pageToken = res?.nextPageToken || '';
  } while (pageToken);
  return out;
}

/** 하루를 맞춘다: 그날 V4 일정(서버) ↔ 구글의 그날 것 */
async function syncDate(token: string, calId: string, uid: string, date: string): Promise<number> {
  const snap = await getDocFromServer(doc(db, 'users', uid, 'events', date));
  const list = snap.exists() ? readEventList(snap.data()) : [];
  const payloads = autoPayloads(date, list, state.eventLabels, state.enabled);
  const existing = await listDay(token, calId, date);
  // '구글 캘린더'를 끈 일정도 구글에서 지운다(2026-10-07 사용자 요청). 다만 라벨 설정·일정 라벨 목록을 아직 못 받았으면
  // 라벨로 켠 일정을 '끈 것'으로 잘못 알 수 있다 - 그때는 그날 V4에 있는 일정을 남기고 V4에서 빠진 것만 지운다.
  const canJudge = state.settingsLoaded && (state.enabled.size === 0 || state.eventLabels.length > 0);
  const keepIds = canJudge ? new Set<string>() : new Set(list.map((e: any) => String(e?.id || '')).filter(Boolean));
  const plan = planDateSync(existing, payloads, keepIds);
  const base = `${API}/calendars/${encodeURIComponent(calId)}/events`;
  for (const p of plan.post) await googleFetch(base, 'POST', token, p);
  for (const { id, payload } of plan.put) await googleFetch(`${base}/${id}`, 'PUT', token, payload);
  for (const id of plan.del) {
    try {
      await googleFetch(`${base}/${id}`, 'DELETE', token);
    } catch (e) {
      if (!isGone(e)) throw e;
    }
  }
  return plan.post.length + plan.put.length + plan.del.length;
}

/**
 * 일정 칸에서 '구글 캘린더' 일정을 저장한 뒤 부른다 (2026-10-07 사용자 요청): 구글 로그인이 없으면(만료) 로그인을 묻는다.
 * 저장 단추를 누른 직후라 브라우저가 로그인 창을 열어 주고, 막히면 '구글 로그인이 필요합니다' 창의 단추로 연다.
 * 로그인하면 쌓인 날을 곧바로 보낸다. 닫으면 큐에 남아 머리줄 '📅 못 보낸 날 N'으로 나중에 보낸다.
 */
export async function ensureGcalLogin(): Promise<void> {
  if (!state.uid) return;
  if (await getGoogleTokenQuietly()) return; // 로그인돼 있다 - 큐가 알아서 보낸다
  try {
    const token = await getValidGoogleToken('구글 캘린더 속성을 켠 일정을 구글 캘린더(SP(work))에 반영하려면 구글 로그인이 필요합니다. 로그인하면 바로 보냅니다.');
    if (!token) return;
    // 큐에 아직 안 들어갔으면(1.2초 모으는 중) 들어간 뒤 commitPending이 보낸다
    await flushGcalQueue(false);
  } catch {
    showToast('구글 로그인을 하지 않아 구글 캘린더에 아직 보내지 않았습니다. 맨 위 📅 못 보낸 날 단추로 나중에 보냅니다.');
  }
}

export type FlushResult = 'done' | 'no-token' | 'busy' | 'empty' | 'off';

/**
 * 큐의 날짜를 보낸다. interactive면 토큰이 없을 때 로그인 창을 연다(단추를 누른 때만).
 * 보낸 날은 큐에서 지운다 - 그새 다시 쌓였으면(at이 바뀜) 남긴다. 실패는 큐에 남기고 다음에 다시.
 */
export async function flushGcalQueue(interactive: boolean, force = false): Promise<FlushResult> {
  const uid = state.uid;
  if (!uid) return 'empty';
  if (state.flushing) {
    state.rerun = true;
    if (force) state.rerunForce = true;
    return 'busy';
  }
  state.flushing = true;
  notify();
  try {
    // 단추로 부르면 토큰부터 - 누른 직후라야 로그인 창이 막히지 않는다
    let token = interactive ? await getValidGoogleToken() : null;
    const queued = await getDocsFromServer(queueCol(uid));
    if (queued.empty) return 'empty';
    // 라벨을 모두 껐고 일정에서 켠 적도 없으면 보내지 않는다(쌓인 것은 다시 켜면 보낸다)
    // force: 라벨을 끈 뒤 지우기 (queueSentDates)
    if (!active() && !force) return 'off';
    if (!token) token = await getGoogleTokenQuietly();
    if (!token) return 'no-token';
    if (!state.calId) state.calId = await getOrCreateCalendarByName(token, CALENDAR);
    let changed = 0;
    for (const d of queued.docs) {
      const q = d.data();
      const date = String(q.date || d.id);
      try {
        changed += await syncDate(token, state.calId, uid, date);
        await runTransaction(db, async (tx) => {
          const fresh = await tx.get(d.ref);
          if (fresh.exists() && fresh.data().at === q.at) tx.delete(d.ref);
        });
      } catch (e) {
        if (isAuthError(e)) {
          // 만료된 토큰 - 잊고 단추로 다시 받게 한다
          forgetGoogleToken();
          return 'no-token';
        }
        if (/\(404\)/.test(String((e as any)?.message))) state.calId = ''; // 캘린더를 지웠다 - 다음에 다시 만든다
        const fails = Number(q.fails || 0) + 1;
        await setDoc(d.ref, { fails }, { merge: true }).catch(() => {});
        console.warn(`구글 캘린더에 ${date} 일정을 보내지 못했습니다:`, e);
        if (fails === FAIL_NOTICE) showErrorToast(`구글 캘린더에 ${date} 일정을 ${FAIL_NOTICE}번 보내지 못했습니다. 다음에 다시 보냅니다.`, e);
      }
    }
    if (interactive) showToast(changed > 0 ? `📅 구글 캘린더에 보냈습니다 (${changed}건 반영).` : '📅 구글 캘린더가 이미 맞습니다.');
    return 'done';
  } catch (e) {
    if (interactive) throw e;
    console.warn('구글 캘린더 보내기 실패:', e);
    return 'done';
  } finally {
    state.flushing = false;
    notify();
    if (state.rerun) {
      const force = state.rerunForce;
      state.rerun = false;
      state.rerunForce = false;
      void flushGcalQueue(false, force);
    }
  }
}

/**
 * Layout에서 한 번 쓴다. '구글 캘린더' 라벨 설정·큐 수를 듣고, 일정 쓰기를 큐에 넣고, 앱을 열 때·탭으로 돌아올 때 보낸다.
 * pending: 큐에 남은 날 수 (보내는 중이면 0으로 보인다), sendNow: 단추 - 로그인 창을 열 수 있다.
 */
export function useGcalAuto(eventLabels: LabelDef[]) {
  const uid = auth.currentUser?.uid || '';
  const [queued, setQueued] = useState(0);
  const [, setTick] = useState(0);
  state.eventLabels = eventLabels;

  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);

  useEffect(() => {
    state.uid = uid;
    state.calId = '';
    state.enabled = new Set();
    state.settingsLoaded = false;
    state.used = false;
    if (!uid) return;
    const offWrite = onEventDocWrite(noteDate);
    const offSettings = subscribeDocWithServerFallback(settingsRef(uid), (data) => {
      const labels = data?.labels && typeof data.labels === 'object' ? data.labels : {};
      state.enabled = new Set(Object.keys(labels).filter((k) => labels[k]));
      state.used = !!data?.used;
      const first = !state.settingsLoaded;
      state.settingsLoaded = true;
      notify();
      // 앱을 열 때 (설정을 처음 받은 뒤) 쌓인 것을 조용히 보낸다
      if (first && active()) void flushGcalQueue(false);
    });
    const offQueue = onSnapshot(
      queueCol(uid),
      (snap) => setQueued(snap.size),
      () => setQueued(0)
    );
    const onVisible = () => {
      if (document.visibilityState === 'visible' && active()) void flushGcalQueue(false);
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      offWrite();
      offSettings();
      offQueue();
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [uid]);

  const sendNow = async () => {
    try {
      const r = await flushGcalQueue(true);
      if (r === 'off') showToast("'구글 캘린더'를 켠 일정 라벨이 없습니다. 라벨 관리에서 켜면 보냅니다.");
    } catch (e) {
      showErrorToast('구글 캘린더에 보내지 못했습니다.', e);
    }
  };
  return { pending: state.flushing ? 0 : queued, flushing: state.flushing, enabled: state.enabled, sendNow };
}

/** '구글 캘린더'를 켠 라벨 id들 (일정 칸이 '구글 캘린더로 보냄'을 보일 때) - Layout의 useGcalAuto가 받아 둔 것 */
export function useGcalEnabled(): Set<string> {
  const [, setTick] = useState(0);
  useEffect(() => {
    const fn = () => setTick((t) => t + 1);
    listeners.add(fn);
    return () => {
      listeners.delete(fn);
    };
  }, []);
  return state.enabled;
}

/** 테스트용 */
export function _gcalState() {
  return state;
}
