// src/components/MovedToV5Banner.tsx
//
// 'V5로 옮겼습니다' 띠 (2026-10-14 V5 P9-4 - 사용자가 '이 기기에서 닫기 가능'을 고름).
// V4는 그대로 쓸 수 있지만(고칠 일이 있을 때) 새 주소를 권한다. 닫으면 이 기기에서만 다시 뜨지 않는다.
import { useState } from 'react';

export const V5_URL = 'https://schoolplanner-v5.web.app/';
export const MOVED_BANNER_KEY = 'sp4-moved-to-v5-closed';

function readClosed(): boolean {
  try {
    return localStorage.getItem(MOVED_BANNER_KEY) === '1';
  } catch {
    return false;
  }
}

export default function MovedToV5Banner() {
  const [closed, setClosed] = useState(readClosed);
  if (closed) return null;
  const close = () => {
    try {
      localStorage.setItem(MOVED_BANNER_KEY, '1');
    } catch {
      // 저장소가 막혀도 이번에는 닫는다
    }
    setClosed(true);
  };
  return (
    <div
      role="status"
      data-moved-v5-banner
      className="mb-3 flex items-center gap-2 flex-wrap rounded-xl border border-sky-200 bg-sky-50 px-3 py-2 text-xs text-sky-900"
    >
      <span className="font-bold">🚚 School Planner가 V5로 옮겼습니다.</span>
      <span className="text-sky-700">새 주소에서 써 주세요. V4는 보기만 권합니다(여기서 고친 것은 V5에 들어가지 않습니다).</span>
      <span className="ml-auto flex items-center gap-1.5">
        <a
          href={V5_URL}
          data-moved-v5-open
          className="px-2.5 py-1 rounded-lg bg-sky-600 hover:bg-sky-700 text-white font-bold"
        >
          V5 열기
        </a>
        <button
          type="button"
          onClick={close}
          data-moved-v5-close
          title="이 기기에서 띠 닫기"
          className="px-2 py-1 rounded-lg hover:bg-sky-100 font-bold text-sky-800"
        >
          닫기
        </button>
      </span>
    </div>
  );
}
