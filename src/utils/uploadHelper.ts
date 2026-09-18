// src/utils/uploadHelper.ts
//
// ⚠️ 지금은 아무도 부르지 않는다. 첨부와 캡처 이미지는 전부 구글 드라이브로
//    올라간다(lib/driveApi). 그런데도 지우지 않고 둔다.
//
//    드라이브에 올린 이미지를 화면에 펼쳐 보여줄 때 쓰는 thumbnail 주소는 공식
//    문서에 있는 경로가 아니라, 구글이 바꾸면 그림이 안 보이게 될 수 있다.
//    그때는 이미지만 다시 Storage로 되돌리게 되는데, 그 되돌리는 길을 여기
//    남겨 둔다. 지워 버리면 급할 때 다시 짜야 한다.
//
//    되돌릴 일이 없다고 판단되면 그때 지운다.

import { ref, uploadBytes, getDownloadURL } from 'firebase/storage';
import { storage } from '../lib/firebase';

/**
 * 이미지 파일을 지정된 최대 너비에 맞게 압축합니다. (V3 호환 로직)
 */
export const compressImage = (file: File, maxWidth = 1200): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    reader.onload = (event) => {
      if (!event.target?.result) {
        return reject(new Error('파일 읽기 실패'));
      }
      const img = new Image();
      img.src = event.target.result as string;
      img.onload = () => {
        let { width, height } = img;
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
        const canvas = document.createElement('canvas');
        canvas.width = width;
        canvas.height = height;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context 가져오기 실패'));
        
        ctx.drawImage(img, 0, 0, width, height);
        canvas.toBlob((blob) => {
          if (!blob) return reject(new Error('Blob 생성 실패'));
          resolve(new File([blob], file.name, { type: 'image/jpeg', lastModified: Date.now() }));
        }, 'image/jpeg', 0.8);
      };
      img.onerror = () => reject(new Error('이미지 로드 실패'));
    };
    reader.onerror = () => reject(new Error('파일 읽기 에러'));
  });
};

/**
 * 이미지를 압축하여 Firebase Storage에 업로드하고 다운로드 URL을 반환합니다.
 */
export const uploadImage = async (file: File, userId: string, folderName = 'uploads'): Promise<string> => {
  try {
    const compressedFile = await compressImage(file);
    // V3 경로 구조와 유사하게 구성: folderName/userId/timestamp_filename
    const filePath = `${folderName}/${userId}/${Date.now()}_${compressedFile.name}`;
    const storageRef = ref(storage, filePath);
    
    await uploadBytes(storageRef, compressedFile);
    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
  } catch (error) {
    console.error('이미지 업로드 오류:', error);
    throw error;
  }
};

/**
 * 일반 파일(문서 등)을 압축 없이 원본 그대로 Firebase Storage에 업로드하고 다운로드 URL을 반환합니다.
 */
export const uploadFile = async (file: File, userId: string, folderName = 'uploads'): Promise<string> => {
  try {
    const filePath = `${folderName}/${userId}/${Date.now()}_${file.name}`;
    const storageRef = ref(storage, filePath);
    
    await uploadBytes(storageRef, file);
    const downloadURL = await getDownloadURL(storageRef);
    return downloadURL;
  } catch (error) {
    console.error('파일 업로드 오류:', error);
    throw error;
  }
};
