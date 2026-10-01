// src/lib/mention.ts
//
// 기록에서 '@이름'으로 학생 태그 넣기 (ROADMAP 10-1) - 순수 셈. 화면은 components/StudentMention.
//
//   '@김지' → 학생 목록 → 고르면 '@김지'가 '#26040305 '로 바뀐다(커서 자리에서).
//   이름은 어디든 들어 있으면 맞고, 자음만 치면 초성으로 찾는다(lib/hangul.matchesName). '@5'는 번호.
//   '@'는 줄 처음이나 빈칸 뒤에서만 - 메일 주소(teacher@school)에서 목록이 뜨지 않게.
import type { ClassRoster, Student } from '../hooks/useRoster';
import { matchesName } from './hangul';
import { makeStudentTag, tagOfStudent } from './studentTag';
import { classKeyOf } from './attendance';

export interface Mention {
  /** '@'의 자리 */
  start: number;
  /** '@' 뒤에 친 글자 */
  query: string;
}

/** '@' 뒤로 칠 수 있는 길이 (그보다 길면 이름을 찾는 게 아니다) */
const MAX_QUERY = 10;

/** 커서 바로 앞의 '@찾는말'. 없으면 null */
export function findMention(text: string, caret: number): Mention | null {
  const before = text.slice(0, Math.max(0, caret));
  const m = /(^|[\s(])@([^\s@#]*)$/.exec(before);
  if (!m) return null;
  const query = m[2];
  if (query.length > MAX_QUERY) return null;
  return { start: before.length - query.length - 1, query };
}

export interface MentionCandidate {
  cls: ClassRoster;
  student: Student;
  tag: string;
}

/**
 * 찾는말에 맞는 재학생. 앞에 둘 학급(prefer)·올해 학년도 학급이 먼저, 학급 안에서는 번호 차례.
 * 찾는말이 숫자면 번호로(그 학급들에서), 비었으면 앞에 둘 학급의 학생들.
 */
export function matchMentionStudents(
  rosters: ClassRoster[],
  query: string,
  opts: { preferClassKey?: string | null; schoolYear?: number; limit?: number } = {}
): MentionCandidate[] {
  const limit = opts.limit ?? 8;
  const q = query.trim();
  const rank = (c: ClassRoster) =>
    (opts.preferClassKey && classKeyOf(c) === opts.preferClassKey ? 0 : 2) + (Number(c.year) === opts.schoolYear ? 0 : 1);
  const classes = [...rosters].filter((c) => (c.students || []).length > 0).sort((a, b) => rank(a) - rank(b));
  // 비었으면 맨 앞 학급만 (모든 학급을 늘어놓으면 고를 수 없다)
  const pool = q ? classes : classes.slice(0, 1);
  const out: MentionCandidate[] = [];
  for (const cls of pool) {
    const students = [...(cls.students || [])]
      .filter((s) => s.isActive !== false)
      .sort((a, b) => Number(a.num) - Number(b.num));
    for (const s of students) {
      const hit = !q || (/^\d+$/.test(q) ? Number(s.num) === Number(q) : matchesName(String(s.name || ''), q));
      if (!hit) continue;
      out.push({ cls, student: s, tag: makeStudentTag(tagOfStudent(cls, s)) });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

/** '@찾는말'을 태그로 바꾼 글과 그 뒤 커서 자리. 태그 뒤에는 빈칸 하나(이미 있으면 그대로) */
export function applyMention(text: string, mention: Mention, tag: string): { text: string; caret: number } {
  const end = mention.start + 1 + mention.query.length;
  const after = text.slice(end);
  const insert = /^\s/.test(after) ? tag : `${tag} `;
  const next = text.slice(0, mention.start) + insert + after;
  const caret = mention.start + insert.length + (/^\s/.test(after) ? 1 : 0);
  return { text: next, caret };
}
