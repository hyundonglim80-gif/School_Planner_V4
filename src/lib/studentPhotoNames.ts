// src/lib/studentPhotoNames.ts
//
// 학생 사진의 폴더·파일 이름 규칙. 드라이브를 부르지 않는 순수한 셈만 둔다
// (그래야 테스트로 규칙을 못 박아 둘 수 있다).
//
//   폴더  School_Planner_Students_Poto / 2026-3-2
//   파일  2026-3-2-8-배유나.png        (학년도-학년-반-번호-이름)
//
// ⚠️ 번호를 이름에 넣기로 한 것에는 한 가지 값이 따라온다. 학기 중에 전입생이
//    들어오면 뒷번호가 한 칸씩 밀린다. 그러면 파일 이름의 번호와 명단의 번호가
//    어긋나 사진이 통째로 사라져 보인다.
//    그래서 찾을 때는 두 번 찾는다. 먼저 번호가 든 이름으로 찾고, 없으면
//    번호를 뺀 '2026-3-2-배유나'로 한 번 더 찾는다. 번호가 밀려도 이름만
//    같으면 사진이 남고, 예전에 번호 없이 올려 둔 사진도 그대로 보인다.
//    올릴 때는 늘 번호를 넣은 이름으로 올린다.

export const PHOTO_ROOT_FOLDER_NAME = 'School_Planner_Students_Poto';

/** 드라이브에서 사진으로 받아들일 확장자 */
export const PHOTO_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp'] as const;

export interface ClassKey {
  year: number | string;
  grade: string;
  classNum: string;
}

/** '2026-3-2' — 학급 하나의 폴더 이름 */
export function classFolderName(cls: ClassKey): string {
  return `${cls.year}-${cls.grade}-${cls.classNum}`;
}

/** '2026-3-2-8-배유나' — 올릴 때 쓰는, 확장자 없는 이름 */
export function photoBaseName(cls: ClassKey, num: number | string, name: string): string {
  return `${classFolderName(cls)}-${num}-${normalizeName(name)}`;
}

/** 올릴 파일의 온전한 이름. 원본 확장자를 따르되 아는 것이 아니면 png로 둔다. */
export function photoFileName(
  cls: ClassKey,
  num: number | string,
  name: string,
  originalFileName: string
): string {
  const ext = extensionOf(originalFileName);
  const safe = (PHOTO_EXTENSIONS as readonly string[]).includes(ext) ? ext : 'png';
  return `${photoBaseName(cls, num, name)}.${safe}`;
}

/** 파일 이름에서 확장자만 소문자로. 없으면 빈 문자열. */
export function extensionOf(fileName: string): string {
  const at = fileName.lastIndexOf('.');
  return at < 0 ? '' : fileName.slice(at + 1).toLowerCase();
}

/** 확장자를 뗀 이름 */
export function stripExtension(fileName: string): string {
  const at = fileName.lastIndexOf('.');
  return at < 0 ? fileName : fileName.slice(0, at);
}

/** 사진으로 볼 파일인가 */
export function isPhotoFile(fileName: string): boolean {
  return (PHOTO_EXTENSIONS as readonly string[]).includes(extensionOf(fileName));
}

/**
 * 견줄 때 쓰는 이름 다듬기.
 *
 * 사람이 손으로 올린 파일에는 공백이 섞이기 쉽다('배 유나.png'). 견줄 때만
 * 공백을 걷어내고, 대소문자도 맞춘다(영문 이름 학생).
 */
export function normalizeName(name: string): string {
  return (name || '').replace(/\s+/g, '').toLowerCase();
}

export interface PhotoCandidate {
  /** 드라이브 파일 id */
  id: string;
  /** 드라이브에 적힌 파일 이름 */
  name: string;
}

export interface MatchedPhoto {
  id: string;
  name: string;
  /** 번호까지 맞았는가. 아니면 이름만으로 되찾은 것이다. */
  exact: boolean;
}

/**
 * 한 학생의 사진을 폴더 목록에서 찾는다.
 *
 * 1) 번호까지 맞는 것  2) 없으면 이름만 맞는 것
 * 확장자는 PHOTO_EXTENSIONS 순서를 따른다(png를 jpg보다 먼저 고른다).
 * 어느 쪽도 없으면 null.
 */
export function findPhotoFor(
  files: PhotoCandidate[],
  cls: ClassKey,
  num: number | string,
  name: string
): MatchedPhoto | null {
  const wantName = normalizeName(name);
  if (!wantName) return null;

  const withNum = `${classFolderName(cls)}-${num}-${wantName}`;
  const withoutNum = `${classFolderName(cls)}-${wantName}`;

  const exact = pickByBase(files, withNum);
  if (exact) return { ...exact, exact: true };

  const loose = pickByBase(files, withoutNum);
  return loose ? { ...loose, exact: false } : null;
}

function pickByBase(files: PhotoCandidate[], base: string): PhotoCandidate | null {
  const hits = files.filter(
    (f) => isPhotoFile(f.name) && normalizeName(stripExtension(f.name)) === base
  );
  if (hits.length === 0) return null;
  // 같은 이름이 확장자만 달리 여럿 있으면 정해진 차례로 하나를 고른다.
  // (그렇지 않으면 드라이브가 주는 차례에 따라 사진이 오락가락한다)
  hits.sort(
    (a, b) =>
      PHOTO_EXTENSIONS.indexOf(extensionOf(a.name) as any) -
      PHOTO_EXTENSIONS.indexOf(extensionOf(b.name) as any)
  );
  return hits[0];
}

/**
 * 학급 전체의 사진을 한 번에 맞춘다.
 * 돌려주는 열쇠는 학생의 번호다(명단 안에서는 번호가 겹치지 않는다).
 */
export function matchClassPhotos(
  files: PhotoCandidate[],
  cls: ClassKey,
  students: { num: number; name: string }[]
): Map<number, MatchedPhoto> {
  const out = new Map<number, MatchedPhoto>();
  for (const st of students) {
    const hit = findPhotoFor(files, cls, st.num, st.name);
    if (hit) out.set(st.num, hit);
  }
  return out;
}
