// src/lib/accountProbe.ts
//
// '오늘 일정이 안 보인다'와 '이 계정에는 원래 아무것도 없다'는 화면에서 똑같이
// 비어 보인다. 그런데 원인은 정반대다. 앞은 읽기가 잘못된 것이고, 뒤는
// 엉뚱한 계정으로 들어온 것이다.
//
// V3와 V4는 파이어베이스 앱 이름이 달라 로그인 세션이 따로 논다. 게다가 둘 다
// prompt: 'select_account'로 로그인해서, 쿠키를 지우고 나면 매번 계정 선택창이
// 뜬다. 계정이 여럿이면 앱마다 다른 계정을 고를 수 있다. 그런데 사용 기록을
// 지우면 V3의 로그인 기록도 함께 사라지므로, V3와 견주어 알아내는 방법은
// 바로 그 상황에서 쓸 수가 없다.
//
// 그래서 계정 자체에 물어본다. 이 계정에 일정이 단 한 건이라도 있는가.
// 한 건도 없다면 새 계정이거나 남의 계정이다.
import { collection, query, limit, orderBy, documentId, getDocsFromServer } from 'firebase/firestore';
import { db } from './firebase';

export type AccountProbe =
  | { state: 'empty' }        // 이 계정에는 일정이 하나도 없다
  | { state: 'has-data'; recent: string[]; todayThere: boolean }
  | { state: 'error'; code: string };

/**
 * 하루 일정 문서 경로(users/{uid}/events/2026-09-17)를 받아
 * 그 컬렉션에 무엇이든 들어 있는지 서버에 직접 물어본다.
 */
export async function probeAccountHasEvents(docPath: string): Promise<AccountProbe> {
  const parts = docPath.split('/');
  const wanted = parts[parts.length - 1];
  const colPath = parts.slice(0, -1).join('/');
  try {
    // 날짜가 곧 문서 이름이므로, 이름 역순으로 몇 개만 받아 보면
    // '오늘 문서가 서버에 정말 없는지'를 눈으로 확인할 수 있다.
    // 문서 하나만 읽는 길과 목록으로 읽는 길은 서로 다른 통로라서,
    // 한쪽은 없다고 하고 다른 쪽엔 있는 경우를 이걸로 잡아낸다.
    const snap = await getDocsFromServer(
      query(collection(db, colPath), orderBy(documentId(), 'desc'), limit(5))
    );
    if (snap.empty) return { state: 'empty' };
    const recent = snap.docs.map((d) => d.id);
    return { state: 'has-data', recent, todayThere: recent.includes(wanted) };
  } catch (err: any) {
    return { state: 'error', code: String(err?.code || err?.message || err) };
  }
}

/** 경로에서 uid만 뽑는다 (users/{uid}/events/... 또는 groups/{gid}/events/...) */
export function ownerOfPath(docPath: string): string {
  const parts = docPath.split('/');
  return parts[1] || '(알 수 없음)';
}
