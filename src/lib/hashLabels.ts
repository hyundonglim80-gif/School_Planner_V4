// src/lib/hashLabels.ts
//
// 메모·기록 글의 마지막 줄 '#라벨' (19번 U10, docs/ROADMAP-REFINE.md).
// 저장할 때 마지막 비지 않은 줄이 '#이름'들로만 되어 있으면(띄어쓰기로 여럿, 예 '#111 #555') 그 이름들을 라벨로 붙이고
// 그 줄을 글에서 지운다 - 남겨 두면 칩으로 뗀 라벨이 다시 저장할 때 또 붙는다.
// '#26040305'(숫자 8자리)는 학생 태그(lib/studentTag)라 라벨로 보지 않고 그 줄에 남긴다.
// 글이 그 줄 하나뿐이면 글로 둔다(글이 비면 안 되므로).

/** 라벨 이름 길이 한도 */
export const HASH_LABEL_MAX = 20;
const STUDENT_TAG = /^#\d{8}$/;
/** 이름 끝에서 떼는 문장 부호 */
const TRAILING_PUNCT = /[.,!?;:…·、。，！？)\]}'"]+$/u;

export interface HashLabelResult {
  /** 줄을 지운(또는 학생 태그만 남긴) 글. 라벨이 없으면 받은 글 그대로 */
  text: string;
  /** 붙일 라벨 이름 (차례대로, 중복 없이) */
  names: string[];
}

/** 글 → 마지막 줄의 '#라벨'과 그것을 뗀 글 */
export function takeTrailingHashLabels(text: string): HashLabelResult {
  const none = { text, names: [] };
  const lines = String(text || '').split('\n');
  let last = lines.length - 1;
  while (last >= 0 && !lines[last].trim()) last--;
  if (last < 0) return none;
  // 그 위에 글이 한 줄도 없으면 그대로 (글이 비지 않게)
  if (!lines.slice(0, last).some((l) => l.trim())) return none;
  const tokens = lines[last].trim().split(/\s+/);
  if (!tokens.every((t) => t.startsWith('#'))) return none;
  const names: string[] = [];
  const keep: string[] = [];
  for (const t of tokens) {
    if (STUDENT_TAG.test(t)) {
      keep.push(t);
      continue;
    }
    const name = t.slice(1).replace(TRAILING_PUNCT, '').slice(0, HASH_LABEL_MAX).trim();
    // '#' 만 있거나 문장 부호뿐인 것이 끼어 있으면 라벨 줄로 보지 않는다
    if (!name || name.includes('#')) return none;
    if (!names.includes(name)) names.push(name);
  }
  if (names.length === 0) return none;
  const before = lines.slice(0, last);
  if (keep.length > 0) before.push(keep.join(' '));
  return { text: before.join('\n').replace(/\s+$/, ''), names };
}
