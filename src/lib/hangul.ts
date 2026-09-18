// src/lib/hangul.ts
//
// 이름을 초성으로 찾기 위한 것들.
//
// 선생님이 스물다섯 명 중 누구를 찾을 때 이름 전체를 치는 일은 드물다.
// 'ㄱㅈㅇ'만 쳐도 김지우가 나와야 쓸모가 있다.
//
// 한글 음절은 유니코드에서 가나다 순으로 빈틈없이 붙어 있다(AC00~D7A3).
// 그래서 코드값 하나만 빼고 나누면 초성이 몇 번째인지 바로 나온다.
// 표를 따로 들고 다닐 필요가 없다.

const SYLLABLE_BASE = 0xac00;
const SYLLABLE_LAST = 0xd7a3;
/** 한 초성이 거느리는 음절 수 = 중성 21 × 종성 28 */
const PER_CHOSEONG = 21 * 28;

/** 초성 19자. 순서가 유니코드 순서와 같아야 한다. */
const CHOSEONG = [
  'ㄱ', 'ㄲ', 'ㄴ', 'ㄷ', 'ㄸ', 'ㄹ', 'ㅁ', 'ㅂ', 'ㅃ',
  'ㅅ', 'ㅆ', 'ㅇ', 'ㅈ', 'ㅉ', 'ㅊ', 'ㅋ', 'ㅌ', 'ㅍ', 'ㅎ',
];

/**
 * 겹자음을 홑자음으로 본다.
 *
 * 자판에서 'ㄲ'을 치려면 Shift를 눌러야 한다. 찾으려고 치는 사람이 거기까지
 * 신경 쓰지는 않는다. 'ㄱㅅ'으로 김싸피를 찾을 수 있어야 한다.
 * 반대로 'ㄲ'을 친 사람에게 'ㄱ' 이름을 보여주는 것도 손해가 없다.
 */
const DOUBLE_TO_SINGLE: Record<string, string> = {
  'ㄲ': 'ㄱ', 'ㄸ': 'ㄷ', 'ㅃ': 'ㅂ', 'ㅆ': 'ㅅ', 'ㅉ': 'ㅈ',
};

function foldConsonant(ch: string): string {
  return DOUBLE_TO_SINGLE[ch] || ch;
}

/** 이 글자가 홀로 쓰인 자음인가 (초성만 친 상태) */
export function isChoseongChar(ch: string): boolean {
  // ㄱ(3131) ~ ㅎ(314e) 사이의 자음 낱자
  const code = ch.charCodeAt(0);
  if (code < 0x3131 || code > 0x314e) return false;
  return CHOSEONG.includes(foldConsonant(ch));
}

/** 친 글자가 전부 자음 낱자인가 (= 초성 검색으로 다뤄야 하는가) */
export function isChoseongQuery(query: string): boolean {
  const q = query.replace(/\s+/g, '');
  if (!q) return false;
  return [...q].every(isChoseongChar);
}

/** '김지우' -> 'ㄱㅈㅇ'. 한글이 아닌 글자는 그대로 둔다. */
export function toChoseong(text: string): string {
  let out = '';
  for (const ch of text) {
    const code = ch.charCodeAt(0);
    if (code >= SYLLABLE_BASE && code <= SYLLABLE_LAST) {
      out += CHOSEONG[Math.floor((code - SYLLABLE_BASE) / PER_CHOSEONG)];
    } else {
      out += ch;
    }
  }
  return out;
}

/**
 * 이름이 찾는 말과 맞는가.
 *
 * 친 글자가 전부 자음이면 초성끼리 견주고, 아니면 이름 그대로 견준다.
 * 어느 쪽이든 '어디든 들어 있으면' 맞는 것으로 본다. 성을 빼고 '지우'만
 * 치는 일이 잦기 때문이다.
 */
export function matchesName(name: string, query: string): boolean {
  const q = query.replace(/\s+/g, '');
  if (!q) return true;
  const n = (name || '').replace(/\s+/g, '');
  if (!n) return false;

  if (isChoseongQuery(q)) {
    const folded = [...q].map(foldConsonant).join('');
    return [...toChoseong(n)].map(foldConsonant).join('').includes(folded);
  }
  return n.includes(q);
}

/**
 * 이름에서 찾는 말과 맞아떨어진 자리.
 *
 * 화면에서 그 부분에만 노란 칠을 하려고 쓴다. 초성으로 찾았을 때는 초성이
 * 맞은 자리가 곧 음절 자리이므로, 글자 수만큼 그대로 쓰면 된다.
 * 맞는 자리가 없으면 null.
 */
export function matchRange(name: string, query: string): { start: number; end: number } | null {
  const q = query.replace(/\s+/g, '');
  if (!q) return null;
  const n = name || '';
  if (!n) return null;

  if (isChoseongQuery(q)) {
    const folded = [...q].map(foldConsonant).join('');
    const cho = [...toChoseong(n)].map(foldConsonant).join('');
    const at = cho.indexOf(folded);
    return at < 0 ? null : { start: at, end: at + folded.length };
  }
  const at = n.indexOf(q);
  return at < 0 ? null : { start: at, end: at + q.length };
}
