// src/lib/hashLabels.ts
//
// 메모·기록 글의 첫 줄·마지막 줄 '#라벨' (19번 U10, 첫 줄은 2026-10-07 사용자 요청).
// 저장할 때 첫 줄이나 마지막 줄(비지 않은 줄)이 '#이름'들로만 되어 있으면(띄어쓰기로 여럿, 예 '#111 #555') 그 이름들을 라벨로 붙이고
// 그 줄을 글에서 지운다 - 남겨 두면 칩으로 뗀 라벨이 다시 저장할 때 또 붙는다.
// '#26040305'(숫자 8자리)는 학생 태그(lib/studentTag)라 라벨로 보지 않고 그 줄에 남긴다.
// 줄을 지우고 나서 글이 비면 그대로 둔다(글이 비면 안 되므로).

/** 라벨 이름 길이 한도 */
export const HASH_LABEL_MAX = 20;
const STUDENT_TAG = /^#\d{8}$/;
/** 이름 끝에서 떼는 문장 부호 */
const TRAILING_PUNCT = /[.,!?;:…·、。，！？)\]}'"]+$/u;

export interface HashLabelResult {
  /** 줄을 지운(또는 학생 태그만 남긴) 글. 라벨이 없으면 받은 글 그대로 */
  text: string;
  /** 붙일 라벨 이름 (첫 줄 → 마지막 줄 차례, 중복 없이) */
  names: string[];
}

/** 한 줄 → '#이름'들뿐이면 { names, keep(학생 태그) }, 아니면 null */
function parseHashLine(line: string): { names: string[]; keep: string[] } | null {
  const tokens = line.trim().split(/\s+/);
  if (!tokens.every((t) => t.startsWith('#'))) return null;
  const names: string[] = [];
  const keep: string[] = [];
  for (const t of tokens) {
    if (STUDENT_TAG.test(t)) {
      keep.push(t);
      continue;
    }
    const name = t.slice(1).replace(TRAILING_PUNCT, '').slice(0, HASH_LABEL_MAX).trim();
    // '#' 만 있거나 문장 부호뿐인 것이 끼어 있으면 라벨 줄로 보지 않는다
    if (!name || name.includes('#')) return null;
    if (!names.includes(name)) names.push(name);
  }
  return names.length > 0 ? { names, keep } : null;
}

/** 글 → 첫 줄·마지막 줄의 '#라벨'과 그것을 뗀 글 */
export function takeHashLabels(text: string): HashLabelResult {
  const none = { text, names: [] };
  const lines = String(text || '').split('\n');
  const filled = lines.map((l, i) => (l.trim() ? i : -1)).filter((i) => i >= 0);
  if (filled.length < 2) return none;
  const targets = [filled[0], filled[filled.length - 1]];
  const names: string[] = [];
  const out = [...lines];
  for (const i of targets) {
    const hit = parseHashLine(lines[i]);
    if (!hit) continue;
    for (const n of hit.names) if (!names.includes(n)) names.push(n);
    out[i] = hit.keep.length > 0 ? hit.keep.join(' ') : '\u0000';
  }
  if (names.length === 0) return none;
  const kept = out.filter((l) => l !== '\u0000');
  // 줄을 지우고 나니 글이 비면(라벨 줄만 있었다) 그대로
  if (!kept.some((l) => l.trim())) return none;
  // 지운 첫 줄 뒤의 빈 줄, 끝의 빈 줄도 정리한다
  return { text: kept.join('\n').replace(/^\s*\n/, '').replace(/\s+$/, ''), names };
}

/** 예전 이름 (마지막 줄만 보던 때) - 이제 첫 줄도 본다 */
export const takeTrailingHashLabels = takeHashLabels;
