// src/lib/shareText.ts
//
// 공유 창(휴대폰·윈도우의 '공유하기')으로 글을 보낸다 (로드맵 6-7, 알림장 공유).
// 카카오톡·문자·메일 같은 앱을 사용자가 고른다. 공유 창이 없는 브라우저에서는 단추를 보이지 않는다.

/** 이 브라우저에 공유 창이 있나 */
export const canShare = (): boolean => typeof navigator !== 'undefined' && typeof navigator.share === 'function';

/**
 * 공유 창으로 보낸다. 사용자가 창을 닫으면(AbortError) 그만이고, 그 밖의 이유로 막히면
 * (권한·일부 브라우저) fallback(대개 복사)으로 대신한다. 어떻게 끝났는지 돌려준다.
 */
export async function shareText(
  title: string,
  text: string,
  fallback: (text: string) => Promise<void> | void
): Promise<'shared' | 'cancelled' | 'fallback'> {
  try {
    await navigator.share({ title, text });
    return 'shared';
  } catch (e) {
    if ((e as { name?: string } | null)?.name === 'AbortError') return 'cancelled';
    await fallback(text);
    return 'fallback';
  }
}
