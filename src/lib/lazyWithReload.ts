// src/lib/lazyWithReload.ts
//
// 배포가 새로 나가면 자산 파일 이름이 바뀐다(SettingsModal-BwZ9B8To.js -> 다른 해시).
// 그런데 이미 열어 둔 탭은 옛 이름을 기억하고 있다. 그 상태에서 팝업을 열면
// 없는 파일을 받으러 가서 404가 나고, 화면이 하얗게 된다.
//   Failed to load resource: 404 (SettingsModal-BwZ9B8To.js)
//   Uncaught TypeError: Failed to fetch dynamically imported module
// F5를 누르면 새 이름을 받아오므로 그때는 잘 된다. 사용자가 그걸 알 리가 없다.
//
// 그래서 받아오기에 실패하면 한 번만 새로고침해 새 이름을 받아온다.
// 무한 새로고침을 막으려고 표시를 남긴다. 표시가 있는데 또 실패하면
// 새로고침으로 풀리는 문제가 아니므로 그대로 오류를 올린다.
import { lazy, type ComponentType } from 'react';

const RELOAD_MARK = 'sp4-chunk-reloaded';

function looksLikeStaleChunk(err: unknown): boolean {
  const msg = String((err as any)?.message || err || '');
  return (
    msg.includes('Failed to fetch dynamically imported module') ||
    msg.includes('error loading dynamically imported module') ||
    msg.includes('Importing a module script failed')
  );
}

export function lazyWithReload<T extends ComponentType<any>>(
  load: () => Promise<{ default: T }>
) {
  return lazy(async () => {
    try {
      const mod = await load();
      // 한 번 제대로 받아왔으면 표시를 지운다 (다음 배포 때 다시 쓸 수 있게)
      try {
        sessionStorage.removeItem(RELOAD_MARK);
      } catch {
        /* 무시 */
      }
      return mod;
    } catch (err) {
      if (!looksLikeStaleChunk(err)) throw err;

      let already = false;
      try {
        already = sessionStorage.getItem(RELOAD_MARK) === '1';
        sessionStorage.setItem(RELOAD_MARK, '1');
      } catch {
        /* 세션 저장소를 못 쓰면 새로고침은 한 번만 시도한다 */
      }
      if (already) throw err;

      window.location.reload();
      // 새로고침이 시작되었으므로 이 약속은 끝내지 않는다
      return new Promise<{ default: T }>(() => {});
    }
  });
}
