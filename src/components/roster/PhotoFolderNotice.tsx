// src/components/roster/PhotoFolderNotice.tsx
//
// 사진 폴더가 아직 연결되지 않았거나, 연결은 되었는데 읽지 못할 때 내는 안내.
//
// 그냥 '사진이 없습니다'라고만 하면 선생님은 사진을 안 올린 줄 알고 드라이브를
// 열어 확인하러 간다. 실제로는 앱 권한 때문에 안 보이는 것이므로, 무엇을
// 하면 되는지까지 적는다.
import React, { useState } from 'react';
import { showErrorToast, showToast } from '../../utils/toast';
import { PHOTO_ROOT_FOLDER_NAME } from '../../lib/studentPhotoNames';

interface PhotoFolderNoticeProps {
  /** 연결은 되었으나 읽지 못한 경우의 사연. 없으면 '아직 연결 안 함'으로 본다. */
  error?: string;
  onConnect: () => Promise<unknown>;
  /** 연결을 건너뛰고 사진 없이 쓰기 (관리 탭에서만 뜻이 있다) */
  onSkip?: () => void;
  skipLabel?: string;
}

function FolderIcon() {
  return (
    <svg
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.8"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="13" r="3" />
    </svg>
  );
}

export default function PhotoFolderNotice({
  error,
  onConnect,
  onSkip,
  skipLabel = '사진 없이 쓰기',
}: PhotoFolderNoticeProps) {
  const [busy, setBusy] = useState(false);

  const connect = async () => {
    setBusy(true);
    try {
      const picked = await onConnect();
      if (picked) showToast('✅ 사진 폴더를 연결했습니다.');
    } catch (e: any) {
      showErrorToast(e?.message || '폴더를 연결하지 못했습니다.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col items-center gap-2.5 py-8 text-center">
      <div
        className={`w-14 h-14 rounded-2xl border flex items-center justify-center ${
          error ? 'bg-red-50 border-red-200 text-red-500' : 'bg-amber-50 border-amber-200 text-amber-600'
        }`}
      >
        <FolderIcon />
      </div>

      <h3 className="text-base font-black text-slate-800">
        {error ? '사진 폴더를 읽지 못했습니다' : '사진 폴더를 아직 연결하지 않았습니다'}
      </h3>

      <p className="text-xs text-slate-500 leading-relaxed max-w-135">
        {error ? (
          error
        ) : (
          <>
            구글이 정한 권한 때문에, 드라이브에 이미 있는 폴더는 한 번 직접 골라 주셔야 앱이 읽을 수
            있습니다. 한 번 고르면 그 폴더만 기억하고, 드라이브의 다른 자료는 보지 않습니다.
          </>
        )}
      </p>

      <div className="flex flex-col gap-1.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-left min-w-135">
        <div className="text-2xs font-extrabold text-slate-400 tracking-wide">앱이 찾는 이름 규칙</div>
        <div className="flex items-baseline gap-2 text-xs">
          <span className="text-slate-500 font-bold w-12 shrink-0">폴더</span>
          <code className="font-mono text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded px-1.5 py-0.5">
            {PHOTO_ROOT_FOLDER_NAME} / 2026-3-2
          </code>
        </div>
        <div className="flex items-baseline gap-2 text-xs">
          <span className="text-slate-500 font-bold w-12 shrink-0">사진</span>
          <code className="font-mono text-xs font-bold text-slate-800 bg-white border border-slate-200 rounded px-1.5 py-0.5">
            2026-3-2-8-배유나.png
          </code>
        </div>
        <div className="flex items-baseline gap-2">
          <span className="w-12 shrink-0" />
          <span className="text-2xs text-slate-400 font-semibold">
            학년도-학년-반-번호-이름 · png / jpg / jpeg / webp 모두 인식합니다
          </span>
        </div>
      </div>

      <div className="flex gap-1.5 pt-1">
        <button
          type="button"
          onClick={connect}
          disabled={busy}
          className="px-5 py-2.5 bg-primary hover:bg-primary/90 text-white rounded-xl text-xs font-extrabold transition-colors cursor-pointer disabled:opacity-60 flex items-center gap-1.5"
        >
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2.2"
            strokeLinecap="round"
            strokeLinejoin="round"
            aria-hidden="true"
          >
            <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
          </svg>
          {busy ? '선택창을 여는 중...' : error ? '폴더 다시 고르기' : '드라이브에서 폴더 고르기'}
        </button>
        {onSkip && (
          <button
            type="button"
            onClick={onSkip}
            className="px-4 py-2.5 bg-white border border-slate-300 rounded-xl text-xs font-bold text-slate-700 hover:bg-slate-50 transition-colors cursor-pointer"
          >
            {skipLabel}
          </button>
        )}
      </div>

      <div className="flex items-center gap-1.5 text-2xs text-slate-400 font-semibold">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.2"
          strokeLinejoin="round"
          aria-hidden="true"
        >
          <path d="M12 3l7 3v6c0 4.4-3 8.2-7 9-4-.8-7-4.6-7-9V6z" />
        </svg>
        학생 사진은 공개 링크로 바뀌지 않습니다. 선생님 계정으로만 불러옵니다.
      </div>
    </div>
  );
}
