// src/components/AccountMismatchBanner.tsx
//
// V3와 V4가 서로 다른 구글 계정으로 로그인되어 있으면 알려 준다.
// 이 경우 V4는 아무 잘못 없이도 텅 빈 화면을 보여 준다. 일정도 라벨도
// 시간표 설정도 전부 users/{uid} 아래에 있기 때문이다. 화면에는 '저장한 것이
// 전부 사라졌다'로 보이지만 데이터는 멀쩡히 다른 계정에 남아 있다.
import { useEffect, useState } from 'react';
import { auth } from '../lib/firebase';
import { readV3Account, accountsDiffer, type PeerAccount } from '../lib/peerAccount';
import { useAuth } from '../features/auth/useAuth';

export default function AccountMismatchBanner() {
  const { user, logout } = useAuth();
  const [v3, setV3] = useState<PeerAccount | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    if (!user) return;
    let alive = true;
    const apiKey = (auth.app.options as any).apiKey as string;
    readV3Account(apiKey).then((acc) => { if (alive) setV3(acc); });
    return () => { alive = false; };
  }, [user?.uid]);

  if (dismissed || !accountsDiffer(user?.uid, v3)) return null;

  return (
    <div className="bg-amber-50 border-b-2 border-amber-300 px-4 py-3 text-amber-900">
      <div className="max-w-5xl mx-auto flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-lg leading-none">⚠️</span>
        <div className="flex-1 min-w-[16rem] text-2xs leading-relaxed">
          <strong className="font-bold">V3와 다른 계정으로 로그인되어 있습니다.</strong>
          <br />
          이 화면(V4)은 <b>{user?.email || '(알 수 없음)'}</b>, V3는 <b>{v3?.email || '(알 수 없음)'}</b> 계정입니다.
          일정·라벨·시간표 설정은 계정마다 따로 저장되므로, 이대로는 저장해 두신 내용이
          보이지 않습니다. <b>로그아웃한 뒤 V3와 같은 계정으로 다시 들어오세요.</b>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => { void logout(); }}
            className="px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-2xs hover:bg-amber-700"
          >
            로그아웃하고 계정 바꾸기
          </button>
          <button
            onClick={() => setDismissed(true)}
            className="px-2 py-1.5 rounded-lg text-amber-700 font-bold text-2xs hover:bg-amber-100"
            title="이 알림 닫기"
          >
            닫기
          </button>
        </div>
      </div>
    </div>
  );
}
