// src/lib/photoDiagnosis.ts
//
// 사진이 안 붙었을 때, 어디서 끊겼는지 한 줄로 말해 준다.
//
// 처음에는 '사진 없는 학생 25명'이라고만 냈다. 그런데 그 한마디로는
//   · 아직 사진을 안 올린 것인지
//   · 폴더를 못 읽은 것인지
//   · 파일 이름이 규칙과 다른 것인지
// 를 가릴 수가 없다. 폴더를 연결하고도 사진이 안 붙는 일이 실제로 있었고,
// 화면만 봐서는 까닭을 알 수 없어 드라이브를 열어 뒤져야 했다.
//
// 진단은 화면에서 떼어 둔다. 무엇을 말할지 정하는 셈이 화면 코드에 섞이면
// 눈으로 하나씩 열어 보는 수밖에 없다.
import type { PhotoScan } from './studentPhotos';

export type DiagnosisTone = 'ok' | 'warn' | 'error';

export interface PhotoDiagnosis {
  tone: DiagnosisTone;
  /** 무슨 일이 일어났는가 */
  message: string;
  /** 무엇을 하면 되는가 (없을 수 있다) */
  hint?: string;
  /** '폴더 다시 고르기'를 내밀어야 하는가 */
  offerRepick: boolean;
}

export interface DiagnoseArgs {
  scan: PhotoScan | null;
  /** '2026-3-1' */
  className: string;
  /** 명단에 있는 학생 수 (재학·전출 모두) */
  studentCount: number;
  /** 사진이 붙은 학생 수 */
  matchedCount: number;
}

/** 보기 좋게 몇 개만 나열한다 */
function samples(names: string[], upTo = 3): string {
  const head = names.slice(0, upTo).join(', ');
  return names.length > upTo ? `${head} 외 ${names.length - upTo}개` : head;
}

export function diagnosePhotos({
  scan,
  className,
  studentCount,
  matchedCount,
}: DiagnoseArgs): PhotoDiagnosis {
  if (!scan) {
    return { tone: 'warn', message: '사진을 불러오는 중...', offerRepick: false };
  }

  // ── 사진을 찾을 곳을 아예 못 잡은 경우 ──────────────────────
  if (!scan.folderId) {
    if (scan.rootEmpty) {
      return {
        tone: 'error',
        message: '고른 폴더 안이 비어 보입니다.',
        hint:
          '구글 권한 때문에, 고른 폴더의 하위 폴더까지는 앱에 보이지 않을 수 있습니다. ' +
          `'폴더 다시 고르기'로 ${className} 폴더를 바로 골라 주세요.`,
        offerRepick: true,
      };
    }
    if (scan.subfolderNames.length > 0) {
      return {
        tone: 'error',
        message: `고른 폴더 안에 '${className}' 폴더가 없습니다. (보이는 폴더: ${samples(
          scan.subfolderNames
        )})`,
        hint: `폴더 이름을 ${className} 로 맞추시거나, '폴더 다시 고르기'로 그 폴더를 바로 골라 주세요.`,
        offerRepick: true,
      };
    }
    return {
      tone: 'error',
      message: '고른 폴더 안에 사진 파일이 없습니다. (png · jpg · jpeg · webp만 읽습니다)',
      hint: `'폴더 다시 고르기'로 ${className} 폴더를 바로 골라 보세요.`,
      offerRepick: true,
    };
  }

  // ── 폴더는 잡았다 ───────────────────────────────────────────
  const where = scan.source === 'root' ? '고른 폴더' : `${className} 폴더`;

  if (scan.files.length === 0) {
    return {
      tone: 'warn',
      message: `${where}는 찾았는데 사진 파일이 없습니다. 빈 칸을 눌러 올려 주세요.`,
      offerRepick: false,
    };
  }

  if (matchedCount === 0) {
    return {
      tone: 'error',
      message: `${where}에서 사진 ${scan.files.length}장을 찾았지만, 이름이 명단과 맞는 것이 없습니다. (${samples(
        scan.files.map((f) => f.name)
      )})`,
      hint: `파일 이름은 ${className}-번호-이름 이어야 합니다. 번호 없이 ${className}-이름 이어도 찾습니다.`,
      offerRepick: false,
    };
  }

  if (matchedCount < studentCount) {
    return {
      tone: 'warn',
      message: `사진 ${matchedCount}/${studentCount}명 — 없는 학생은 빈 칸을 눌러 바로 올릴 수 있습니다.`,
      offerRepick: false,
    };
  }

  return {
    tone: 'ok',
    message: `모든 학생의 사진이 연결되었습니다. (${matchedCount}명)`,
    offerRepick: false,
  };
}
