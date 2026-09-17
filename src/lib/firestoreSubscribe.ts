import { markFirestoreAlive } from './firestoreRecovery';
import {
  onSnapshot,
  getDoc,
  getDocFromServer,
  type DocumentReference,
  type DocumentData,
  type DocumentSnapshot,
} from 'firebase/firestore';

/**
 * 문서를 구독하되, 오프라인 캐시가 "문서 없음"이라고 답하면 서버에 한 번 직접 확인한다.
 *
 * 💡 Firestore는 캐시에 없는 문서를 오프라인/동기화 지연 상태에서 "없음"으로
 * 돌려준다. 그대로 믿으면 서버에 멀쩡히 있는 데이터가 통째로 가려진다.
 * 실제로 이것 때문에 일정이 하루치 통째로 안 보였고, 라벨 설정이 안 읽혀서
 * 사용자 라벨이 기본값으로 되돌아가 라벨 칩이 전부 사라지기도 했다.
 *
 * 서버 확인은 문서당 한 번만 하며, 오프라인이면 조용히 캐시 결과를 유지한다.
 */
export function subscribeDocWithServerFallback(
  ref: DocumentReference<DocumentData>,
  onData: (data: DocumentData | null) => void,
  onError?: (error: unknown) => void
): () => void {
  let cancelled = false;
  let recheckDone = false;

  const unsub = onSnapshot(
    ref,
    (snap) => {
      markFirestoreAlive(); // Firestore가 살아서 답을 준다는 신호
      if (cancelled) return;
      if (snap.exists()) {
        recheckDone = true; // 한 번이라도 내용을 받았으면 재확인이 필요 없다
        onData(snap.data());
        return;
      }
      onData(null);
      // ⚠️ '문서 없음'은 fromCache가 아닐 때도 거짓일 수 있다.
      //    사이트 데이터를 지운 직후에는 캐시가 비어 있고 로그인도 막 끝난
      //    참이라, 서버에 멀쩡히 있는 문서를 '없다'고 답하는 일이 생긴다.
      //    예전에는 fromCache일 때만 다시 물어봐서, 그 경우 라벨이 통째로
      //    기본값에 갇히고 아무도 다시 확인하지 않았다.
      //    '없다'는 답은 데이터가 통째로 사라져 보이는 답이므로, 캐시에서
      //    왔든 아니든 서버에 한 번은 직접 확인한다. (문서당 딱 한 번)
      if (!recheckDone) {
        recheckDone = true;
        getDocFromServer(ref)
          .then((serverSnap) => {
            if (!cancelled && serverSnap.exists()) onData(serverSnap.data());
          })
          .catch((err) => {
            // 오프라인이면 캐시 결과를 그대로 두는 것이 맞다. 다만 조용히 삼키면
            // '서버에 있는데 화면에는 없다'가 영영 드러나지 않는다. 알려는 준다.
            onError?.(err);
          });
      }
    },
    (error) => {
      // ⚠️ 여기서 끝내면 안 된다. onSnapshot은 한 번 오류가 나면 더 이상
      //    콜백을 부르지 않는다. 그대로 두면 화면은 '아무것도 없음'에 머문 채
      //    영영 복구되지 않는다. 라벨이 그래서 기본값에 갇혔다.
      //    서버에 한 번 더 직접 물어본다.
      if (cancelled) return;
      getDocFromServer(ref)
        .then((serverSnap) => {
          if (cancelled) return;
          if (serverSnap.exists()) onData(serverSnap.data());
          else onError?.(error);
        })
        .catch(() => {
          if (!cancelled) onError?.(error);
        });
    }
  );

  return () => {
    cancelled = true;
    unsub();
  };
}


/**
 * '서버에 물어보고, 안 되면 캐시라도' 읽기.
 *
 * 그냥 getDoc을 쓰면 기기 캐시가 비어 있을 때 "그런 문서 없다"고 답한다.
 * 서버에는 멀쩡히 있는데도 그렇다. 화면을 그리는 구독 쪽은 그 답을 의심하게
 * 고쳤지만, 딱 한 번만 도는 작업(예: 앱 시작할 때의 이월)에서 이 답을 믿으면
 * 그 판은 통째로 틀린 채 끝난다. 다시 물어볼 기회도 없다.
 */
export async function getDocTrustingServer<T>(
  ref: DocumentReference<T>
): Promise<{ snap: DocumentSnapshot<T>; fromServer: boolean }> {
  try {
    return { snap: await getDocFromServer(ref), fromServer: true };
  } catch {
    // 오프라인 등 - 캐시 답이라도 받아 온다. 다만 '서버가 답한 것은 아니다'를 함께 알린다.
    return { snap: await getDoc(ref), fromServer: false };
  }
}
