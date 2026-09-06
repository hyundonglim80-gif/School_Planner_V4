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
