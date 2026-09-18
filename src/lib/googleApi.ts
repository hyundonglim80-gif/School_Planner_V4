// src/lib/googleApi.ts
//
// 구글 API를 부를 때 쓰는 최소한의 것들. V3의 js/api/googleApi.js를 옮겨 왔다.
import { signInWithPopup, GoogleAuthProvider } from 'firebase/auth';
import { auth, googleProvider } from './firebase';
import { useAppStore } from '../store/useAppStore';

export async function googleFetch<T = any>(
  url: string,
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  token: string,
  body?: unknown
): Promise<T | null> {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!res.ok) {
    let message = '알 수 없는 오류';
    try {
      const err = await res.json();
      message = err?.error?.message || message;
    } catch {
      /* 본문이 JSON이 아닐 수 있다 */
    }
    throw new Error(`구글 API 오류 (${res.status}): ${message}`);
  }
  if (res.status === 204) return null;
  return (await res.json()) as T;
}

/** 캘린더 하나의 일정을 모두 받아온다 (한 번에 250개씩) */
export async function fetchAllGoogleEvents(
  token: string,
  calId: string,
  timeMin: string,
  timeMax: string,
  extraParams: Record<string, string> = {}
): Promise<any[]> {
  const all: any[] = [];
  let pageToken = '';

  do {
    const params = new URLSearchParams({
      timeMin,
      timeMax,
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250',
      ...extraParams,
    });
    if (pageToken) params.append('pageToken', pageToken);

    try {
      const res = await googleFetch<any>(
        `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calId)}/events?${params}`,
        'GET',
        token
      );
      if (res?.items) all.push(...res.items);
      pageToken = res?.nextPageToken || '';
    } catch (e) {
      console.warn('구글 기존 일정 조회 실패:', e);
      break;
    }
  } while (pageToken);

  return all;
}

/** 이름으로 캘린더를 찾고, 없으면 만든다 */
export async function getOrCreateCalendarByName(token: string, summary: string): Promise<string> {
  const list = await googleFetch<any>('https://www.googleapis.com/calendar/v3/users/me/calendarList', 'GET', token);
  const existing = (list?.items || []).find((c: any) => c.summary === summary);
  if (existing) return existing.id;

  const created = await googleFetch<any>('https://www.googleapis.com/calendar/v3/calendars', 'POST', token, {
    summary,
    description: 'School Planner에서 동기화된 캘린더입니다.',
    timeZone: 'Asia/Seoul',
  });
  return created.id;
}

/**
 * 쓸 수 있는 토큰을 돌려준다.
 *
 * 구글 액세스 토큰은 한 시간쯤 지나면 만료된다. 만료된 토큰으로 부르면 401이
 * 나는데, 예전에는 그걸 "로그아웃 후 다시 로그인하세요"로만 안내했다.
 * 여기서 확인하고, 필요하면 권한 창을 다시 띄워 받아온다. (V3와 같은 방식)
 */
export async function getValidGoogleToken(): Promise<string | null> {
  const quiet = await getGoogleTokenQuietly();
  if (quiet) return quiet;
  return renewGoogleToken();
}

/**
 * 쓸 수 있는 토큰이 이미 있으면 준다. 없으면 null — 창을 띄우지 않는다.
 *
 * ⚠️ 사용자가 시키지 않은 일 때문에 로그인 창이 튀어나오면 안 된다.
 *    명렬표 팝업은 열리자마자 사진을 찾으려고 토큰을 본다. 그때 만료돼
 *    있으면 getValidGoogleToken이 권한 창을 띄운다. 명렬표를 여는 것만으로
 *    로그인을 강요받는 셈이라, 실제로 그렇게 됐다.
 *    화면에 그리려고 부르는 자리에서는 이쪽을 쓰고, 사용자가 단추를 눌러
 *    시킨 일(폴더 고르기·사진 올리기)에서만 위의 것을 쓴다.
 */
export async function getGoogleTokenQuietly(): Promise<string | null> {
  const stored =
    useAppStore.getState().googleAccessToken || sessionStorage.getItem('google_api_token') || '';
  if (!stored) return null;

  try {
    const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${stored}`);
    return res.ok ? stored : null;
  } catch {
    // 물어보지 못했으면 있는 것으로 치고 써 본다. 정말 못 쓰는 토큰이면
    // 그 다음 호출이 401로 떨어지고, 그때 화면에 사연이 뜬다.
    return stored;
  }
}

/** 권한 창을 다시 띄워 토큰을 받아온다 */
export async function renewGoogleToken(): Promise<string | null> {
  try {
    const result = await signInWithPopup(auth, googleProvider);
    const credential = GoogleAuthProvider.credentialFromResult(result);
    const token = credential?.accessToken || null;
    if (token) {
      useAppStore.getState().setGoogleAccessToken(token);
      try {
        sessionStorage.setItem('google_api_token', token);
      } catch {
        /* 시크릿 모드 등 */
      }
    }
    return token;
  } catch (e: any) {
    if (e?.code === 'auth/popup-blocked') {
      throw new Error("팝업이 차단되었습니다. 주소창 오른쪽에서 '팝업 허용'을 눌러 주세요.");
    }
    throw new Error('구글 권한을 받지 못했습니다. 로그아웃 후 다시 로그인해 주세요.');
  }
}
