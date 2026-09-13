import {
  onSnapshot,
  getDocFromServer,
  type DocumentReference,
  type DocumentData,
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
      if (cancelled) return;
      if (snap.exists()) {
        recheckDone = true; // 한 번이라도 내용을 받았으면 재확인이 필요 없다
        onData(snap.data());
        return;
      }
      onData(null);
      if (snap.metadata.fromCache && !recheckDone) {
        recheckDone = true;
        getDocFromServer(ref)
          .then((serverSnap) => {
            if (!cancelled && serverSnap.exists()) onData(serverSnap.data());
          })
          .catch(() => {
            /* 오프라인 등 - 캐시 결과를 그대로 둔다 */
          });
      }
    },
    (error) => {
      if (!cancelled) onError?.(error);
    }
  );

  return () => {
    cancelled = true;
    unsub();
  };
}
