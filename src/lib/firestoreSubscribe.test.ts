import { describe, it, expect, vi, beforeEach } from 'vitest';
import { onSnapshot, getDocFromServer } from 'firebase/firestore';
import { subscribeDocWithServerFallback } from './firestoreSubscribe';

const ref = {} as any;
const snapOf = (data: any, fromCache = false) => ({
  exists: () => data !== null,
  data: () => data,
  metadata: { fromCache },
});

beforeEach(() => vi.clearAllMocks());

describe('문서 구독 - 실패해도 조용히 멈추지 않는다', () => {
  it('구독이 끊기면 서버에 다시 물어 값을 되살린다', async () => {
    // onSnapshot은 한 번 오류가 나면 다시는 콜백을 부르지 않는다.
    // 그대로 두면 라벨이 기본값에 갇혀 화면에서 라벨 칩이 전부 사라진다.
    (onSnapshot as any).mockImplementation((_r: any, _next: any, onErr: any) => {
      setTimeout(() => onErr(new Error('연결 끊김')), 0);
      return () => {};
    });
    (getDocFromServer as any).mockResolvedValue(snapOf({ eventLabels: [{ name: '회의' }] }));

    const seen: any[] = [];
    subscribeDocWithServerFallback(ref, (d) => seen.push(d));
    await new Promise((r) => setTimeout(r, 20));

    expect(getDocFromServer).toHaveBeenCalled();
    expect(seen.at(-1)).toEqual({ eventLabels: [{ name: '회의' }] });
  });

  it('서버로도 못 살리면 오류를 알린다 (조용히 넘기지 않는다)', async () => {
    (onSnapshot as any).mockImplementation((_r: any, _next: any, onErr: any) => {
      setTimeout(() => onErr(new Error('권한 없음')), 0);
      return () => {};
    });
    (getDocFromServer as any).mockRejectedValue(new Error('오프라인'));

    const onError = vi.fn();
    subscribeDocWithServerFallback(ref, () => {}, onError);
    await new Promise((r) => setTimeout(r, 20));

    expect(onError).toHaveBeenCalled();
  });

  it('캐시가 "없음"이라고 해도 서버에 확인한다', async () => {
    (onSnapshot as any).mockImplementation((_r: any, next: any) => {
      next(snapOf(null, true));
      return () => {};
    });
    (getDocFromServer as any).mockResolvedValue(snapOf({ eventLabels: [{ name: 'ToDo' }] }));

    const seen: any[] = [];
    subscribeDocWithServerFallback(ref, (d) => seen.push(d));
    await new Promise((r) => setTimeout(r, 20));

    expect(seen[0]).toBeNull();
    expect(seen.at(-1)).toEqual({ eventLabels: [{ name: 'ToDo' }] });
  });

  it('값을 받은 뒤에는 서버에 또 묻지 않는다', async () => {
    (onSnapshot as any).mockImplementation((_r: any, next: any) => {
      next(snapOf({ eventLabels: [] }));
      return () => {};
    });

    subscribeDocWithServerFallback(ref, () => {});
    await new Promise((r) => setTimeout(r, 20));

    expect(getDocFromServer).not.toHaveBeenCalled();
  });
});

// 사이트 데이터를 지운 직후에는 캐시가 비어 있고 로그인도 막 끝난 참이라,
// 서버에 멀쩡히 있는 문서를 '없다'고 답하는 일이 생긴다. 예전에는 fromCache일
// 때만 다시 물어봐서, 그 경우 라벨이 통째로 기본값에 갇혔다.
describe('문서 없음 - 캐시에서 온 것이 아니어도 서버에 확인한다', () => {
  it('fromCache가 아니어도 한 번은 서버에 물어본다', async () => {
    (onSnapshot as any).mockImplementation((_r: any, next: any) => {
      next(snapOf(null, false)); // fromCache = false 인데 '없음'
      return () => {};
    });
    (getDocFromServer as any).mockResolvedValue(snapOf({ eventLabels: [{ name: '회의' }] }));

    const seen: any[] = [];
    subscribeDocWithServerFallback(ref, (d) => seen.push(d));
    await new Promise((r) => setTimeout(r, 20));

    expect(getDocFromServer).toHaveBeenCalled();
    expect(seen.at(-1)).toEqual({ eventLabels: [{ name: '회의' }] });
  });

  it('서버에도 정말 없으면 없는 대로 둔다', async () => {
    (onSnapshot as any).mockImplementation((_r: any, next: any) => {
      next(snapOf(null, false));
      return () => {};
    });
    (getDocFromServer as any).mockResolvedValue(snapOf(null));

    const seen: any[] = [];
    subscribeDocWithServerFallback(ref, (d) => seen.push(d));
    await new Promise((r) => setTimeout(r, 20));

    expect(seen).toEqual([null]);
  });
});
