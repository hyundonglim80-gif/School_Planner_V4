// src/components/GoogleLoginPrompt.tsx
//
// '구글 로그인이 필요합니다' 창. 구글 토큰이 만료됐는데 브라우저가 로그인 창을 막을 때(파일 고르기 창에서
// 파일을 고른 뒤 등) googleApi가 이 창을 연다. 여기 단추를 누르는 것이 '방금 누른 것'이라 로그인 창이 막히지 않는다.
// 상태는 lib/googleLoginPrompt. Layout에 하나 둔다.
import { useEffect, useState } from 'react';
import ModalShell from './ModalShell';
import { renewGoogleToken } from '../lib/googleApi';
import { finishGoogleLogin, registerGoogleLoginHost, useGoogleLoginPrompt } from '../lib/googleLoginPrompt';

export default function GoogleLoginPrompt() {
  const open = useGoogleLoginPrompt((s) => s.open);
  const reason = useGoogleLoginPrompt((s) => s.reason);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => registerGoogleLoginHost(), []);

  /** 창을 닫으며 답한다. 다음에 열 때 지난 안내가 남지 않게 지운다. */
  const finish = (token: string | null) => {
    setBusy(false);
    setError('');
    finishGoogleLogin(token);
  };

  const login = () => {
    setBusy(true);
    setError('');
    // ⚠️ 누른 자리에서 곧바로 부른다. 앞에 await를 두면 브라우저가 로그인 창을 다시 막는다.
    renewGoogleToken()
      .then((token) => {
        if (token) finish(token);
        else setError('구글 권한을 받지 못했습니다. 다시 눌러 주세요.');
      })
      .catch((e) => setError(e?.message || '구글 로그인을 하지 못했습니다.'))
      .finally(() => setBusy(false));
  };

  const cancel = () => finish(null);

  return (
    <ModalShell
      isOpen={open}
      onClose={cancel}
      onBackdropClose={cancel}
      width="sm"
      title="구글 로그인이 필요합니다"
      footer={
        <>
          <button
            type="button"
            onClick={cancel}
            className="px-4 py-2 bg-slate-200 hover:bg-slate-300 text-slate-700 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            취소
          </button>
          <button
            type="button"
            data-google-login
            onClick={login}
            disabled={busy}
            className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-60 text-white rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            {busy ? '로그인 창을 여는 중…' : '구글 로그인'}
          </button>
        </>
      }
    >
      <div className="space-y-2 text-sm text-slate-700" data-google-login-prompt>
        {reason ? (
          <p data-google-login-reason>{reason}</p>
        ) : (
          <p>
            구글 로그인이 만료되었습니다. 파일 첨부·학생 사진·백업처럼 <b>구글 드라이브</b>를 쓰는 일을 하려면 다시
            로그인해야 합니다.
          </p>
        )}
        <p className="text-xs text-slate-500">
          <b>구글 로그인</b>을 누르고 <b>지금 쓰는 계정</b>을 고르세요. 권한을 물으면 모두 허용합니다. 로그인하면 하던 일을
          이어서 합니다.
        </p>
        {error && (
          <p className="text-xs font-bold text-red-600" role="alert">
            {error}
          </p>
        )}
      </div>
    </ModalShell>
  );
}
