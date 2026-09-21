// src/components/roster/StudentPhoto.tsx
//
// 학생 사진 한 칸. 명렬표의 32px 동그라미부터 암기 판의 큰 카드까지 같은
// 것을 쓴다. 사진이 없으면 눌러서 바로 올릴 수 있는 빈 칸이 된다.
import React, { useRef } from 'react';

export type PhotoShape = 'circle' | 'card';

interface StudentPhotoProps {
  url?: string;
  name: string;
  shape?: PhotoShape;
  /** circle일 때 지름(px). card일 때는 폭을 부모가 정하므로 쓰지 않는다. */
  size?: number;
  /** 사진을 올릴 수 있는가. 폴더가 연결되지 않았으면 끈다. */
  canUpload?: boolean;
  uploading?: boolean;
  onUpload?: (file: File) => void;
  /** 번호는 안 맞고 이름만으로 되찾은 사진 (번호가 밀렸다는 신호) */
  loose?: boolean;
  /**
   * 사진이 있을 때 눌렀을 때 할 일 (크게 띄우기).
   *
   * ⚠️ 이것을 주면 사진 위의 카메라 단추는 그리지 않는다. 단추가 사진의
   *    오른쪽 위를 덮고 있어서, 얼굴을 보려고 눌렀는데 파일 고르는 창이
   *    열리는 일이 있었다. 바꾸는 것은 크게 띄운 창의 아래에서 한다.
   */
  onOpen?: () => void;
  className?: string;
}

function CameraIcon({ size = 20 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M3 8a2 2 0 0 1 2-2h2l1.5-2h7L17 6h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
      <circle cx="12" cy="12.5" r="3.5" />
    </svg>
  );
}

export default function StudentPhoto({
  url,
  name,
  shape = 'circle',
  size = 32,
  canUpload = false,
  uploading = false,
  onUpload,
  loose = false,
  onOpen,
  className = '',
}: StudentPhotoProps) {
  const inputRef = useRef<HTMLInputElement>(null);

  const pick = () => {
    if (!canUpload || uploading) return;
    inputRef.current?.click();
  };

  const onFile = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    // 같은 파일을 두 번 고를 수 있게 값을 비운다 (안 그러면 change가 안 난다)
    e.target.value = '';
    if (file && onUpload) onUpload(file);
  };

  const isCircle = shape === 'circle';
  const box = isCircle
    ? 'rounded-full overflow-hidden shrink-0'
    : 'rounded-xl overflow-hidden w-full aspect-[4/5]';
  const style = isCircle ? { width: size, height: size } : undefined;

  const hidden = (
    <input
      type="file"
      accept="image/png,image/jpeg,image/webp"
      ref={inputRef}
      onChange={onFile}
      className="hidden"
    />
  );

  if (url) {
    return (
      <div
        className={`relative ${box} bg-slate-100 ${onOpen ? 'cursor-zoom-in' : ''} ${className}`}
        style={style}
        onClick={onOpen ? (e) => { e.stopPropagation(); onOpen(); } : undefined}
        title={onOpen ? `${name} 사진 크게 보기` : undefined}
      >
        <img
          src={url}
          alt={`${name} 사진`}
          className="w-full h-full object-cover"
          draggable={false}
        />
        {loose && (
          <span
            className="absolute bottom-0 inset-x-0 bg-amber-400/90 text-amber-950 text-2xs font-bold text-center leading-tight"
            title="파일 이름의 번호가 지금 번호와 다릅니다. 이름으로 찾았습니다."
          >
            번호 다름
          </span>
        )}
        {/* 크게 띄우는 길이 있으면 사진 위에 단추를 얹지 않는다.
            바꾸는 것은 띄운 창의 아래에서 한다. */}
        {canUpload && !isCircle && !onOpen && (
          <>
            <button
              type="button"
              onClick={pick}
              disabled={uploading}
              title="사진 바꾸기"
              className="absolute top-1.5 right-1.5 w-6 h-6 flex items-center justify-center rounded-lg bg-white/90 text-slate-600 hover:bg-white hover:text-slate-900 shadow-2xs transition-colors cursor-pointer disabled:opacity-50"
            >
              <CameraIcon size={13} />
            </button>
            {hidden}
          </>
        )}
      </div>
    );
  }

  // 사진이 없는 칸
  const empty = (
    <div
      className={`${box} border border-dashed border-slate-300 bg-slate-50 flex flex-col items-center justify-center gap-1 text-slate-400 ${
        canUpload ? 'hover:border-blue-400 hover:text-blue-500 hover:bg-blue-50/50 cursor-pointer' : ''
      } transition-colors ${className}`}
      style={style}
    >
      {uploading ? (
        <span className="text-2xs font-bold text-blue-600">올리는 중</span>
      ) : (
        <>
          <CameraIcon size={isCircle ? Math.round(size * 0.42) : 22} />
          {!isCircle && canUpload && <span className="text-2xs font-bold">사진 올리기</span>}
        </>
      )}
    </div>
  );

  if (!canUpload) return empty;

  return (
    <>
      <button
        type="button"
        onClick={pick}
        disabled={uploading}
        title={`${name} 사진 올리기`}
        className={isCircle ? 'shrink-0 cursor-pointer' : 'w-full cursor-pointer'}
      >
        {empty}
      </button>
      {hidden}
    </>
  );
}
