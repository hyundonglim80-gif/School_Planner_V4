// src/hooks/useStudentDraw.ts
//
// 발표자 뽑기 (ROADMAP 8-3). 셈은 lib/draw, 저장은 lib/seatingStore(학급 허브의 draw).
//
// 뽑기를 누르면 곧바로 저장하고(창을 닫아도 판에 남게), 화면에서는 이름을 잠깐 굴리다 멈춘다.
// 이번 판은 학급 허브 구독(draw)이 들고 있다 - 다른 기기에서 뽑은 것도 곧 보이고, 이어 뽑는다.
import { useEffect, useMemo, useRef, useState } from 'react';
import { drawStatus, pickNext, rollSequence, type DrawState } from '../lib/draw';
import { restoreDrawState, saveDrawPick, startNewDrawRound, undoDrawPick } from '../lib/seatingStore';
import { showUndoToast } from '../lib/undoToast';
import { showErrorToast, showToast } from '../utils/toast';

/** 굴리는 번호 수 (마지막이 뽑힌 학생) */
const ROLL_STEPS = 14;

/** 굴릴 때 번호마다 머무는 시간 - 점점 느려지다 멈춘다 (모두 더해 1초 남짓) */
const rollDelay = (i: number, steps: number) => 40 + Math.round(160 * (i / Math.max(1, steps - 1)) ** 2);

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  } catch {
    return false;
  }
}

interface Options {
  uid: string | undefined;
  classKey: string | null;
  /** 재학생 번호 */
  activeNums: number[];
  /** 오늘 결석한 번호 */
  absentNums: number[];
  /** 학급 허브의 이번 판 */
  draw: DrawState;
  /** '15번 홍길동' */
  nameOf: (num: number) => string;
}

export function useStudentDraw({ uid, classKey, activeNums, absentNums, draw, nameOf }: Options) {
  /** 지금 보이는 번호 (굴리는 중이면 지나가는 번호, 멈추면 뽑힌 학생) */
  const [shown, setShown] = useState<number | null>(null);
  const [rolling, setRolling] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stopTimer = () => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
  };

  // 학급을 바꾸면 보이던 학생을 걷는다
  useEffect(() => {
    stopTimer();
    setShown(null);
    setRolling(false);
  }, [classKey]);
  useEffect(() => stopTimer, []);

  const status = useMemo(() => drawStatus(activeNums, absentNums, draw), [activeNums, absentNums, draw]);

  const roll = (seq: number[]) => {
    stopTimer();
    if (seq.length <= 1) {
      setShown(seq[0] ?? null);
      setRolling(false);
      return;
    }
    setRolling(true);
    let i = 0;
    const step = () => {
      setShown(seq[i]);
      if (i === seq.length - 1) {
        timer.current = null;
        setRolling(false);
        return;
      }
      timer.current = setTimeout(step, rollDelay(i, seq.length));
      i++;
    };
    step();
  };

  const pick = () => {
    if (rolling || !uid || !classKey) return;
    const p = pickNext(activeNums, absentNums, draw);
    if (!p) {
      showToast(activeNums.length ? '오늘 뽑을 학생이 없습니다. 재학생이 모두 결석입니다.' : '명렬표에 재학생이 없습니다.');
      return;
    }
    // 판에 먼저 남긴다 - 굴리는 동안 창을 닫아도 뽑힌 학생은 판에 들어간다
    saveDrawPick(uid, classKey, p, draw.round).catch((e) =>
      showErrorToast('뽑은 학생을 저장하지 못했습니다. 다른 기기에서 이어 뽑을 때 다시 나올 수 있습니다.', e)
    );
    if (p.newRound) showToast(`🎉 ${draw.round}번째 판을 다 뽑아 새 판을 엽니다.`);
    const candidates = p.newRound ? status.pool : status.remaining;
    roll(prefersReducedMotion() ? [p.num] : rollSequence(candidates, p.num, ROLL_STEPS));
  };

  /** 방금 뽑은 학생을 판에 되돌린다 (다시 뽑힐 수 있다) */
  const undo = async () => {
    if (rolling || !uid || !classKey || shown === null || !draw.picked.includes(shown)) return;
    const num = shown;
    try {
      await undoDrawPick(uid, classKey, num);
      setShown(null);
      showToast(`↩️ ${nameOf(num)}을(를) 안 뽑힌 학생으로 되돌렸습니다.`);
    } catch (e) {
      showErrorToast('되돌리지 못했습니다. 네트워크를 확인해 주세요.', e);
    }
  };

  /** 이번 판을 접고 새 판 (안내의 되돌리기로 앞 판으로) */
  const newRound = async () => {
    if (rolling || !uid || !classKey) return;
    const before = draw;
    const key = classKey;
    try {
      await startNewDrawRound(uid, key, draw.round);
      setShown(null);
      showUndoToast(`🔄 새 판을 열었습니다. 모두 다시 뽑힐 수 있습니다.`, async () => {
        await restoreDrawState(uid, key, before);
        return '↩️ 앞 판으로 되돌렸습니다.';
      });
    } catch (e) {
      showErrorToast('새 판을 열지 못했습니다. 네트워크를 확인해 주세요.', e);
    }
  };

  return { shown, rolling, status, pick, undo, newRound };
}
