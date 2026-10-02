// src/components/roster/drivePhotoPick.ts
//
// '☁️ 드라이브에서' - 구글 드라이브에 이미 있는 학생 사진을 골라 붙인다 (2026-10-02 사용자 요청).
// 명렬표 관리(빈 칸·크게 보기·여러 장)와 학급 화면이 같이 쓴다. 고른 사진은 받아서 기기에서 고른 것과
// 같은 길(useStudentPhotos.upload / 여러 장 올리기)로 넘긴다 - 줄이고 이름을 맞춰 학급 폴더에 넣는다.
import { pickPhotosFromDrive } from '../../lib/studentPhotos';
import { showErrorToast, showToast } from '../../utils/toast';

/** 한 학생의 사진을 드라이브에서 하나 골라 올린다. 올렸으면 true */
export async function pickStudentPhotoFromDrive(
  student: { num: number; name: string },
  upload: (file: File) => Promise<void>
): Promise<boolean> {
  try {
    const files = await pickPhotosFromDrive(
      { title: `${student.num}번 ${student.name} 사진을 골라 주세요` },
      (done, total) => {
        if (done === 0 && total > 0) showToast('☁️ 드라이브에서 사진을 받는 중...', 2000);
      }
    );
    if (files.length === 0) return false;
    await upload(files[0]);
    return true;
  } catch (e: any) {
    showErrorToast(e?.message || '드라이브에서 사진을 가져오지 못했습니다.');
    return false;
  }
}

/** 여러 장을 드라이브에서 골라 받는다. 고르지 않았으면 빈 배열 (받은 뒤 짝짓기·올리기는 부르는 쪽) */
export async function pickManyPhotosFromDrive(onProgress?: (done: number, total: number) => void): Promise<File[]> {
  try {
    return await pickPhotosFromDrive(
      { multiple: true, title: '학생 사진을 여러 장 골라 주세요 (파일 이름으로 학생을 짝짓습니다)' },
      onProgress
    );
  } catch (e: any) {
    showErrorToast(e?.message || '드라이브에서 사진을 가져오지 못했습니다.');
    return [];
  }
}
