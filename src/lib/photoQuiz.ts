// src/lib/photoQuiz.ts
//
// 사진을 보고 이름을 맞히는 판의 차례를 정한다. 드라이브도 Firestore도
// 부르지 않는 순수한 셈만 둔다.
//
// 규칙은 두 가지다.
//   · ✕ 를 누른 학생은 무게가 올라가 다음 판에서 더 자주, 더 앞쪽에 나온다.
//   · ○ 가 잇따라 두 번이면 그 판에서는 빠진다. 이미 외운 얼굴을 스물다섯
//     번씩 다시 보는 것은 시간 낭비다.
//
// 굳이 SM-2 같은 간격 반복을 쓰지 않는다. 그것은 며칠에 걸쳐 나눠 보는
// 공부를 위한 것이고, 여기서는 한 자리에 앉아 한 반을 몇 바퀴 도는 일이
// 대부분이다. 날짜가 아니라 '이 판에서 몇 번 틀렸나'가 차례를 정한다.

/** 학생 한 명의 누적 성적. Firestore에 그대로 담기는 모양이다. */
export interface QuizRecord {
  /** 맞힌 횟수(누적) */
  o: number;
  /** 틀린 횟수(누적) */
  x: number;
  /** 지금 잇따라 맞힌 횟수. ✕ 를 누르면 0으로 돌아간다. */
  streak: number;
  /** 마지막으로 본 때 (ms). 같은 무게일 때 오래된 쪽을 앞세운다. */
  seenAt?: number;
}

export type QuizRecords = Record<string, QuizRecord>;

export const EMPTY_RECORD: QuizRecord = { o: 0, x: 0, streak: 0 };

/** 연속 몇 번 맞히면 이 판에서 빼는가 */
export const MASTERED_STREAK = 2;

/** 기록이 없는 학생도 안전하게 읽는다 */
export function recordOf(records: QuizRecords, key: string): QuizRecord {
  const r = records[key];
  if (!r) return { ...EMPTY_RECORD };
  return {
    o: Number(r.o) || 0,
    x: Number(r.x) || 0,
    streak: Number(r.streak) || 0,
    seenAt: typeof r.seenAt === 'number' ? r.seenAt : undefined,
  };
}

/**
 * 이 학생을 얼마나 앞세울 것인가. 클수록 먼저·자주 나온다.
 *
 * 한 번도 안 본 학생(1.5)을 맞힌 적 있는 학생(1)보다 앞세운다. 처음 도는
 * 바퀴에서 아직 안 본 얼굴이 뒤로 밀리면 판이 지루해진다.
 * 틀린 횟수는 그대로 더한다 — 세 번 틀린 학생은 한 번 틀린 학생보다
 * 두 배 넘게 자주 나온다.
 */
export function weightOf(rec: QuizRecord): number {
  const seen = rec.o + rec.x;
  if (seen === 0) return 1.5;
  return 1 + rec.x * 1.5 - Math.min(rec.streak, MASTERED_STREAK) * 0.25;
}

/** 이 판에서 뺄 학생인가 (연속으로 다 맞힌 얼굴) */
export function isMastered(rec: QuizRecord): boolean {
  return rec.streak >= MASTERED_STREAK;
}

export interface QuizCandidate {
  /** 기록을 찾는 열쇠. 학급키 + 번호 + 이름으로 만든다. */
  key: string;
}

export interface BuildDeckOptions {
  /** 틀린 학생을 더 자주 보여주는가 (환경설정의 체크) */
  weighted?: boolean;
  /** 이미 외운 학생을 빼는가 */
  dropMastered?: boolean;
  /** 섞는 데 쓸 0~1 난수. 테스트에서 고정하려고 밖에서 받는다. */
  random?: () => number;
}

/**
 * 이번 판에 돌릴 차례를 만든다.
 *
 * 무게만으로 줄을 세우면 판을 다시 시작할 때마다 똑같은 차례가 나온다.
 * 그러면 이름이 아니라 차례를 외우게 된다. 그래서 무게에 난수를 곱한다
 * (무게가 큰 학생이 앞에 설 가능성이 높되, 늘 같지는 않게).
 */
export function buildDeck<T extends QuizCandidate>(
  candidates: T[],
  records: QuizRecords,
  opts: BuildDeckOptions = {}
): T[] {
  const { weighted = true, dropMastered = true, random = Math.random } = opts;

  let pool = candidates;
  if (dropMastered) {
    const left = pool.filter((c) => !isMastered(recordOf(records, c.key)));
    // 모두가 '외운' 상태면 판이 비어 버린다. 그럴 때는 다 같이 한 바퀴 더 돈다.
    pool = left.length > 0 ? left : pool;
  }

  return pool
    .map((c) => {
      const rec = recordOf(records, c.key);
      const w = weighted ? weightOf(rec) : 1;
      return { c, sort: w * (0.25 + random() * 0.75) };
    })
    .sort((a, b) => b.sort - a.sort)
    .map((x) => x.c);
}

/** O/X 를 누른 뒤의 기록 */
export function applyAnswer(rec: QuizRecord, known: boolean, now = Date.now()): QuizRecord {
  return known
    ? { o: rec.o + 1, x: rec.x, streak: rec.streak + 1, seenAt: now }
    : { o: rec.o, x: rec.x + 1, streak: 0, seenAt: now };
}

/** '되돌리기'를 눌렀을 때. 방금 더한 것을 도로 뺀다. */
export function undoAnswer(rec: QuizRecord, known: boolean, prevStreak: number): QuizRecord {
  return known
    ? { o: Math.max(0, rec.o - 1), x: rec.x, streak: prevStreak, seenAt: rec.seenAt }
    : { o: rec.o, x: Math.max(0, rec.x - 1), streak: prevStreak, seenAt: rec.seenAt };
}

/** 기록을 찾는 열쇠. 번호가 밀려도 이름이 같으면 성적이 이어지게 이름을 쓴다. */
export function quizKey(
  cls: { year: number | string; grade: string; classNum: string },
  name: string
): string {
  return `${cls.year}-${cls.grade}-${cls.classNum}-${(name || '').replace(/\s+/g, '')}`;
}

/**
 * 한 판의 차례 - 출제 수를 정할 때 (2026-10-07 사용자 요청 '전체 학생 출력 수 설정, 0 = 계속').
 *
 * count가 0이면 한 바퀴(buildDeck 그대로) - '계속'은 판 끝에서 extendDeck으로 이어 붙인다.
 * count가 후보보다 많으면 섞은 바퀴를 이어 붙여 채운다. 바퀴 사이에 같은 학생이 잇따르지 않게 한다.
 */
export function buildRound<T extends QuizCandidate>(
  candidates: T[],
  records: QuizRecords,
  opts: BuildDeckOptions & { count?: number } = {}
): T[] {
  const { count = 0, ...deckOpts } = opts;
  const first = buildDeck(candidates, records, deckOpts);
  if (count <= 0 || first.length === 0) return first;
  let deck = first;
  while (deck.length < count) deck = extendDeck(deck, candidates, records, deckOpts);
  return deck.slice(0, count);
}

/** 판 끝에 한 바퀴를 더 붙인다 ('계속'). 앞 바퀴의 마지막 학생이 곧바로 다시 나오지 않게 한다. */
export function extendDeck<T extends QuizCandidate>(
  deck: T[],
  candidates: T[],
  records: QuizRecords,
  opts: BuildDeckOptions = {}
): T[] {
  // 이어 붙이는 바퀴는 외운 학생도 함께 (출제 수를 채우거나 계속 돌 때 얼굴이 모자라지 않게)
  const more = buildDeck(candidates, records, { ...opts, dropMastered: deck.length === 0 ? opts.dropMastered : false });
  const last = deck[deck.length - 1];
  if (last && more.length > 1 && more[0].key === last.key) more.push(more.shift() as T);
  return [...deck, ...more];
}

/** 암기 설정 - 이 기기에만 (2026-10-07) */
export interface QuizSettings {
  /** 자동 넘김 (초). 0이면 끔 - 문제를 이 시간 보여 준 뒤 이름, 다시 이 시간 뒤 다음 */
  auto: number;
  /** 한 판의 출제 수. 0이면 계속 (판 끝 없이 이어서) */
  count: number;
  /** 함께 외울 학급 (학급키 year_grade_classNum). 비면 지금 학급만 */
  classes: string[];
}

export const QUIZ_SETTINGS_KEY = 'sp4-photo-quiz';
export const DEFAULT_QUIZ_SETTINGS: QuizSettings = { auto: 0, count: 0, classes: [] };

export function sanitizeQuizSettings(raw: unknown): QuizSettings {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof QuizSettings, unknown>>;
  const int = (v: unknown, max: number) => {
    const n = Math.floor(Number(v));
    return Number.isFinite(n) && n > 0 ? Math.min(n, max) : 0;
  };
  return {
    auto: int(r.auto, 60),
    count: int(r.count, 999),
    classes: Array.isArray(r.classes) ? r.classes.filter((k): k is string => typeof k === 'string' && /^\d+_.+_.+$/.test(k)) : [],
  };
}

export function readQuizSettings(): QuizSettings {
  try {
    return sanitizeQuizSettings(JSON.parse(localStorage.getItem(QUIZ_SETTINGS_KEY) || '{}'));
  } catch {
    return { ...DEFAULT_QUIZ_SETTINGS };
  }
}

export function saveQuizSettings(s: QuizSettings) {
  try {
    localStorage.setItem(QUIZ_SETTINGS_KEY, JSON.stringify(sanitizeQuizSettings(s)));
  } catch {
    /* 못 적어도 이번에는 그대로 쓴다 */
  }
}
