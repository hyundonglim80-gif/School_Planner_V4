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
  /** '이 학급 폴더 고르기'를 내밀어야 하는가 */
  offerPickClass: boolean;
  /** '위쪽 폴더 다시 고르기'를 내밀어야 하는가 (옛 방식을 쓰던 경우에만) */
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
  /** 예전 방식으로 '위쪽 폴더'를 따로 골라 둔 적이 있는가 */
  hasLegacyRoot?: boolean;
  /** 이 학급을 위해 직접 골라 둔 폴더의 이름 */
  pickedFolderName?: string;
}

/** 앱이 맡아 두는 자리를 사람에게 보여 줄 때 쓰는 이름 */
export const MANAGED_PATH = 'School_Planner / Students_Poto';

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
  hasLegacyRoot = false,
  pickedFolderName,
}: DiagnoseArgs): PhotoDiagnosis {
  if (!scan) {
    return {
      tone: 'warn',
      message: '사진을 불러오는 중...',
      offerPickClass: false,
      offerRepick: false,
    };
  }

  /**
   * 구글 권한이 손자까지 안 닿는다는 이야기.
   *
   * drive.file 권한에서는 앱이 만들었거나 사용자가 선택창에서 고른 것만 앱에
   * 열린다. 선생님이 손수 만든 위쪽 폴더를 고르면 그 아래 학급 폴더까지는
   * 보이지만, 그 안의 사진은 손자라 안 보인다. 목록이 빈 채로 오고 오류도
   * 나지 않아 '사진을 안 올렸다'와 구별되지 않는다.
   */
  const grandchildHint =
    `구글 권한이 폴더 안쪽까지 닿지 않아 안 보이는 것일 수 있습니다. ` +
    `'이 학급 폴더 고르기'로 ${className} 폴더를 직접 골라 주세요.`;

  // ── 사진을 찾을 곳을 아예 못 잡은 경우 ──────────────────────
  if (!scan.folderId) {
    // 옛 방식으로 고른 폴더가 없다면, 그냥 아직 아무것도 안 올린 것이다
    if (!hasLegacyRoot) {
      return {
        tone: 'warn',
        message: `아직 이 학급에 올린 사진이 없습니다.`,
        hint:
          `빈 칸을 누르시면 ${MANAGED_PATH} / ${className} 에 담깁니다. ` +
          `드라이브에 이미 사진이 있다면 '이 학급 폴더 고르기'로 그 폴더를 골라 주세요.`,
        offerPickClass: true,
        offerRepick: false,
      };
    }
    if (scan.rootEmpty) {
      return {
        tone: 'error',
        message: '고른 폴더 안이 비어 보입니다.',
        hint: grandchildHint,
        offerPickClass: true,
        offerRepick: true,
      };
    }
    if (scan.subfolderNames.length > 0) {
      return {
        tone: 'error',
        message: `고른 폴더 안에 '${className}' 폴더가 없습니다. (보이는 폴더: ${samples(
          scan.subfolderNames
        )})`,
        hint: `폴더 이름을 ${className} 로 맞추시거나, 그 폴더를 직접 골라 주세요.`,
        offerPickClass: true,
        offerRepick: true,
      };
    }
    return {
      tone: 'error',
      message: '고른 폴더 안에 사진 파일이 없습니다. (png · jpg · jpeg · webp만 읽습니다)',
      hint: grandchildHint,
      offerPickClass: true,
      offerRepick: true,
    };
  }

  // ── 폴더는 잡았다 ───────────────────────────────────────────
  const where =
    scan.source === 'managed'
      ? `${MANAGED_PATH} / ${className}`
      : scan.source === 'picked'
        ? `고르신 '${pickedFolderName || '폴더'}'`
        : scan.source === 'root'
          ? '고른 폴더'
          : `${className} 폴더`;

  if (scan.files.length === 0) {
    // 앱이 맡은 자리나 직접 골라 준 폴더가 비었다면 권한 탓이 아니다.
    if (scan.source === 'picked') {
      // 엉뚱한 폴더를 고른 경우가 잦다. 무엇을 골랐는지 되비쳐 주고,
      // 어느 폴더를 골라야 하는지 다시 못 박는다.
      return {
        tone: 'error',
        message: `${where} 폴더 안에 사진이 없습니다.`,
        hint:
          `사진이 '바로 아래' 들어 있는 폴더를 고르셔야 합니다. ` +
          `위쪽 폴더 말고 ${className} 폴더 자체를 골라 주세요.`,
        offerPickClass: true,
        offerRepick: false,
      };
    }
    if (scan.source === 'managed') {
      return {
        tone: 'warn',
        message: `${where} 에 사진이 없습니다. 빈 칸을 눌러 올려 주세요.`,
        offerPickClass: true,
        offerRepick: false,
      };
    }
    return {
      tone: 'error',
      message: `${where}는 보이는데 그 안의 사진이 보이지 않습니다.`,
      hint: grandchildHint,
      offerPickClass: true,
      offerRepick: false,
    };
  }

  if (matchedCount === 0) {
    return {
      tone: 'error',
      message: `${where} 에서 사진 ${scan.files.length}장을 찾았지만, 이름이 명단과 맞는 것이 없습니다. (${samples(
        scan.files.map((f) => f.name)
      )})`,
      hint: `파일 이름은 ${className}-번호-이름 이어야 합니다. 번호 없이 ${className}-이름 이어도 찾습니다.`,
      offerPickClass: false,
      offerRepick: false,
    };
  }

  if (matchedCount < studentCount) {
    return {
      tone: 'warn',
      message: `사진 ${matchedCount}/${studentCount}명 — 없는 학생은 빈 칸을 눌러 바로 올릴 수 있습니다.`,
      offerPickClass: false,
      offerRepick: false,
    };
  }

  return {
    tone: 'ok',
    message: `모든 학생의 사진이 연결되었습니다. (${matchedCount}명)`,
    offerPickClass: false,
    offerRepick: false,
  };
}
