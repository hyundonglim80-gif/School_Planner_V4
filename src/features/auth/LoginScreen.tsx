import React from 'react';
import { useAuth } from './useAuth';

export default function LoginScreen() {
  const { loginWithGoogle, signingIn } = useAuth();

  return (
    <div className="fixed inset-0 bg-bg-body z-[9999] flex flex-col items-center justify-center">
      <div className="bg-white p-12 rounded-2xl shadow-lg text-center">
        <h1 className="mb-3 text-3xl md:text-4xl text-primary font-bold whitespace-nowrap overflow-hidden">SP4</h1>
        <p className="text-slate-500 text-lg mb-10">나만의 데이터를 안전하게 동기화하기 위해<br/>구글 계정으로 시작해주세요.</p>
        {/* 누른 뒤 아무 반응이 없으면 한 번 더 누르게 된다. 그러면 앞의 요청이
            취소되어 둘 다 실패한다. 진행 중임을 보여 주고 다시 못 누르게 막는다. */}
        <button
          onClick={loginWithGoogle}
          disabled={signingIn}
          className="bg-[#4285F4] text-white border-none py-3 px-6 text-lg rounded-lg cursor-pointer font-bold flex items-center gap-3 mx-auto shadow-md transition-all hover:bg-blue-600 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {signingIn ? '로그인 창을 여는 중...' : 'Google 계정으로 로그인'}
        </button>
        {signingIn && (
          <p className="text-slate-400 text-sm mt-4">
            구글 로그인 창이 열립니다. 창이 안 보이면 팝업 차단을 확인해 주세요.
          </p>
        )}
      </div>
    </div>
  );
}
