import { useCallback, useRef, useState } from 'react';
import type React from 'react';
import { auth } from '../lib/firebase';
import { uploadFile } from '../utils/uploadHelper';

export interface PastedImage {
  name: string;
  url: string;
  size: number;
  mimeType: string;
}

const EXT_BY_MIME: Record<string, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
};

// 캡처한 이미지를 Ctrl+V로 붙여넣었을 때 쓸 파일명. 클립보드 이미지는 이름이 없거나
// 전부 "image.png"라서, 그대로 두면 업로드 경로가 겹쳐 구분이 안 된다.
function buildPastedName(index: number, mimeType: string): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
  const suffix = index > 0 ? `_${index + 1}` : '';
  const ext = EXT_BY_MIME[mimeType] || 'png';
  return `붙여넣은_이미지_${stamp}${suffix}.${ext}`;
}

export function extractImageFiles(clipboardData: DataTransfer | null): File[] {
  if (!clipboardData) return [];
  const files: File[] = [];
  for (let i = 0; i < clipboardData.items.length; i++) {
    const item = clipboardData.items[i];
    if (item.kind === 'file' && item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) files.push(file);
    }
  }
  return files;
}

/**
 * 텍스트 입력창에 캡처 이미지를 Ctrl+V 로 붙여넣으면 업로드한 뒤 콜백으로 넘겨준다.
 * 이미지가 아닌 일반 텍스트 붙여넣기는 건드리지 않고 기본 동작에 맡긴다.
 */
export function usePasteImageUpload(onUploaded: (images: PastedImage[]) => void) {
  const [pasting, setPasting] = useState(false);
  const onUploadedRef = useRef(onUploaded);
  onUploadedRef.current = onUploaded;

  const handlePaste = useCallback(async (e: React.ClipboardEvent) => {
    const files = extractImageFiles(e.clipboardData);
    if (files.length === 0) return; // 텍스트 붙여넣기는 그대로 통과

    e.preventDefault();

    const user = auth.currentUser;
    if (!user) {
      alert('로그인이 필요합니다.');
      return;
    }

    try {
      setPasting(true);
      const uploaded: PastedImage[] = [];
      for (let i = 0; i < files.length; i++) {
        const mimeType = files[i].type || 'image/png';
        const name = buildPastedName(i, mimeType);
        const renamed = new File([files[i]], name, { type: mimeType });
        // 💡 uploadImage(압축)가 아니라 uploadFile(원본)을 쓴다.
        // 붙여넣는 이미지는 글자가 있는 화면 캡처가 대부분인데, 1200px로 축소하고
        // JPEG로 재인코딩하면 글자가 뭉개져 읽기 어려워진다.
        const url = await uploadFile(renamed, user.uid);
        uploaded.push({ name, url, size: files[i].size, mimeType });
      }
      onUploadedRef.current(uploaded);
    } catch (err) {
      console.error('붙여넣은 이미지 업로드 실패:', err);
      alert('이미지 업로드에 실패했습니다.');
    } finally {
      setPasting(false);
    }
  }, []);

  return { handlePaste, pasting };
}
