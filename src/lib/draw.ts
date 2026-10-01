// src/lib/draw.ts
//
// 발표자 뽑기 (ROADMAP 8-3) - 순수 셈. 저장은 lib/seatingStore(학급 허브 v4_classHub/{학급키}.draw).
//
//   - 한 판 = 재학생 모두를 한 번씩. 이번 판에 안 뽑힌 학생 중에서 뽑는다.
//   - 오늘 결석한 학생은 뽑지 않는다(판에는 안 뽑힌 채 남는다).
//   - 나올 수 있는(결석 아닌) 학생이 모두 뽑혔으면 새 판을 열고 그 첫 학생을 뽑는다.
//   - 학생은 번호로 가리킨다(출석부·자리표와 같다). 뽑힌 차례대로 picked에 쌓인다.

/** 학급 허브에 저장하는 이번 판 */
export interface DrawState {
  /** 이번 판에 뽑힌 번호 (뽑힌 차례) */
  picked: number[];
  /** 몇 번째 판 (1부터) */
  round: number;
}

export const EMPTY_DRAW: DrawState = { picked: [], round: 1 };

export function sanitizeDraw(raw: any): DrawState {
  const picked: number[] = [];
  if (Array.isArray(raw?.picked)) {
    for (const v of raw.picked) {
      const n = Number(v);
      if (Number.isInteger(n) && n > 0 && !picked.includes(n)) picked.push(n);
    }
  }
  const round = Number(raw?.round);
  return { picked, round: Number.isInteger(round) && round >= 1 ? round : 1 };
}

export interface DrawStatus {
  /** 오늘 나올 수 있는 학생 (재학 - 결석) */
  pool: number[];
  /** 그중 이번 판에 아직 안 뽑힌 학생 */
  remaining: number[];
  /** 오늘 결석이라 빼는 재학생 */
  absent: number[];
  /** 재학생 중 이번 판에 뽑힌 수 */
  done: number;
  /** 재학생 수 */
  total: number;
}

/**
 * 이번 판의 형편.
 * @param activeNums 재학생 번호
 * @param absentNums 오늘 결석한 번호
 */
export function drawStatus(activeNums: number[], absentNums: Iterable<number>, state: DrawState): DrawStatus {
  const absentSet = new Set(absentNums);
  const pickedSet = new Set(state.picked);
  const nums = [...new Set(activeNums)].sort((a, b) => a - b);
  const pool = nums.filter((n) => !absentSet.has(n));
  return {
    pool,
    remaining: pool.filter((n) => !pickedSet.has(n)),
    absent: nums.filter((n) => absentSet.has(n)),
    done: nums.filter((n) => pickedSet.has(n)).length,
    total: nums.length,
  };
}

export interface DrawPick {
  num: number;
  /** 이번 판을 다 뽑아 새 판을 열고 뽑았다 */
  newRound: boolean;
}

/**
 * 다음 학생을 뽑는다. 나올 수 있는 학생이 없으면 null.
 * @param rand 0 이상 1 미만 (시험에서 정해 준다)
 */
export function pickNext(
  activeNums: number[],
  absentNums: Iterable<number>,
  state: DrawState,
  rand: () => number = Math.random
): DrawPick | null {
  const { pool, remaining } = drawStatus(activeNums, absentNums, state);
  if (pool.length === 0) return null;
  const newRound = remaining.length === 0;
  const from = newRound ? pool : remaining;
  const i = Math.min(from.length - 1, Math.floor(rand() * from.length));
  return { num: from[i], newRound };
}

/** 뽑은 뒤의 판 (저장과 같은 셈 - 화면이 서버 답을 기다리지 않고 쓴다) */
export function afterPick(state: DrawState, pick: DrawPick): DrawState {
  if (pick.newRound) return { picked: [pick.num], round: state.round + 1 };
  return state.picked.includes(pick.num) ? state : { ...state, picked: [...state.picked, pick.num] };
}

/** 굴리는 동안 보여 줄 번호들 (마지막이 뽑힌 학생). 후보가 하나면 그것만 */
export function rollSequence(candidates: number[], finalNum: number, steps: number, rand: () => number = Math.random): number[] {
  const others = candidates.filter((n) => n !== finalNum);
  if (others.length === 0 || steps <= 1) return [finalNum];
  const seq: number[] = [];
  let prev = -1;
  for (let i = 0; i < steps - 1; i++) {
    // 같은 번호가 잇달아 나오지 않게 (멈춘 것처럼 보인다)
    let n = others[Math.min(others.length - 1, Math.floor(rand() * others.length))];
    if (n === prev && others.length > 1) n = others[(others.indexOf(n) + 1) % others.length];
    seq.push(n);
    prev = n;
  }
  seq.push(finalNum);
  return seq;
}
