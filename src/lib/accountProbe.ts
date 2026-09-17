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
import { noteFirestoreError } from './firestoreRecovery';

export type AccountProbe =
  | { state: 'empty'; detail: string }
  | { state: 'has-data'; recent: string[]; todayThere: boolean; detail: string }
  | { state: 'disagree'; detail: string }   // 조회 방식에 따라 답이 다르다 = 읽는 길이 깨졌다
  | { state: 'error'; code: string };

/**
 * 같은 컬렉션을 서로 다른 두 가지 방식으로 서버에 물어본다.
 *
 * 실제로 이런 일이 있었다. 같은 계정, 같은 컬렉션인데
 *   limit(1)만 건 조회            -> 문서가 있다
 *   문서 이름 역순 정렬 조회       -> 하나도 없다
 * 두 답이 갈렸다. 그러면 둘 중 하나는 거짓이고, 화면이 비는 이유도 그것이다.
 * 그래서 한쪽 답만 믿지 않고 둘 다 물어 본 뒤, 어긋나면 어긋났다고 말한다.
 */
export async function probeAccountHasEvents(docPath: string): Promise<AccountProbe> {
  const parts = docPath.split('/');
  const wanted = parts[parts.length - 1];
  const colPath = parts.slice(0, -1).join('/');
  const col = collection(db, colPath);
  try {
    const [plain, ordered] = await Promise.all([
      getDocsFromServer(query(col, limit(3))),
      getDocsFromServer(query(col, orderBy(documentId(), 'desc'), limit(5))),
    ]);
    const detail = `그냥조회 ${plain.size}건 / 이름순조회 ${ordered.size}건`;

    if (plain.empty && ordered.empty) return { state: 'empty', detail };
    if (plain.empty !== ordered.empty) return { state: 'disagree', detail };

    const recent = ordered.docs.map((d) => d.id);
    return { state: 'has-data', recent, todayThere: recent.includes(wanted), detail };
  } catch (err: any) {
    // 저장소를 못 잡은 것이면 여기서 앱이 스스로 되살아난다
    noteFirestoreError(err);
    return { state: 'error', code: String(err?.code || err?.message || err) };
  }
}

/** 경로에서 uid만 뽑는다 (users/{uid}/events/... 또는 groups/{gid}/events/...) */
export function ownerOfPath(docPath: string): string {
  const parts = docPath.split('/');
  return parts[1] || '(알 수 없음)';
}
