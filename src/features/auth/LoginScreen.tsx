import React from 'react';
import { useAuth } from './useAuth';

export default function LoginScreen() {
  const { loginWithGoogle } = useAuth();

  return (
    <div className="fixed inset-0 bg-bg-body z-[9999] flex flex-col items-center justify-center">
      <div className="bg-white p-12 rounded-2xl shadow-lg text-center">
        <h1 className="mb-3 text-3xl md:text-4xl text-primary font-bold whitespace-nowrap overflow-hidden">SP4</h1>
        <p className="text-slate-500 text-lg mb-10">나만의 데이터를 안전하게 동기화하기 위해<br/>구글 계정으로 시작해주세요.</p>
        <button onClick={loginWithGoogle} className="bg-[#4285F4] text-white border-none py-3 px-6 text-lg rounded-lg cursor-pointer font-bold flex items-center gap-3 mx-auto shadow-md transition-all hover:bg-blue-600">
          Google 계정으로 로그인
        </button>
      </div>
    </div>
  );
}
