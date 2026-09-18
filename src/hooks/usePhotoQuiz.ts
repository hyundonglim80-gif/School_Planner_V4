// src/hooks/usePhotoQuiz.ts
//
// 이름 암기 판의 진행과 성적을 다룬다.
//
// 성적은 계정에 담는다(users/{uid}/settings/photoQuiz). 기기를 바꿔도,
// 내일 다시 열어도 어제 틀린 학생부터 이어서 하려면 서버에 있어야 한다.
// 다만 O/X를 누를 때마다 쓰면 한 판에 스물다섯 번을 쓰게 되므로, 잠시 모았다가
// 한 번에 쓴다.
import { useState, useEffect, useCallback, useRef } from 'react';
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from '../lib/firebase';
import {
  buildDeck,
  applyAnswer,
  undoAnswer,
  recordOf,
  quizKey,
  type QuizRecords,
} from '../lib/photoQuiz';
import type { ClassKey } from '../lib/studentPhotoNames';

/** 쓰기를 모아 두는 시간 (ms) */
const FLUSH_DELAY = 1500;

export interface QuizStudent {
  num: number;
  name: string;
  gender?: string;
  note?: string;
  /** 사진 주소. 없으면 판에 올리지 않는다. */
  url: string;
}

interface DeckItem extends QuizStudent {
  key: string;
}

/** 방금 누른 답. '되돌리기'로 물릴 수 있게 직전 상태를 함께 들고 있는다. */
interface LastAnswer {
  key: string;
  known: boolean;
  prevStreak: number;
}

export function usePhotoQuiz(cls: ClassKey | null, students: QuizStudent[]) {
  const [records, setRecords] = useState<QuizRecords>({});
  const [loaded, setLoaded] = useState(false);
  const [deck, setDeck] = useState<DeckItem[]>([]);
  const [index, setIndex] = useState(0);
  const [revealed, setRevealed] = useState(false);
  const [last, setLast] = useState<LastAnswer | null>(null);
  const [round, setRound] = useState(1);
  const [weighted, setWeighted] = useState(true);
  /** 이번 판에서만 센 O / X. 누적 성적(records)과는 따로 둔다. */
  const [tally, setTally] = useState({ o: 0, x: 0 });

  const clsKey = cls ? `${cls.year}-${cls.grade}-${cls.classNum}` : '';
  const rosterKey = students.map((s) => `${s.num}:${s.name}:${s.url ? 1 : 0}`).join('|');

  const docRef = useCallback(() => {
    const user = auth.currentUser;
    return user ? doc(db, 'users', user.uid, 'settings', 'photoQuiz') : null;
  }, []);

  /** 성적을 읽어 온다 */
  useEffect(() => {
    let alive = true;
    setLoaded(false);
    const ref = docRef();
    if (!ref) {
      setRecords({});
      setLoaded(true);
      return;
    }
    getDoc(ref)
      .then((snap) => {
        if (!alive) return;
        setRecords(snap.exists() ? ((snap.data().records as QuizRecords) || {}) : {});
        setLoaded(true);
      })
      .catch((e) => {
        console.warn('암기 성적을 읽지 못했습니다. 이번 판은 처음부터 셉니다.', e);
        if (!alive) return;
        setRecords({});
        setLoaded(true);
      });
    return () => {
      alive = false;
    };
  }, [docRef]);

  // ── 서버에 쓰기를 모았다가 한 번에 ──────────────────────────
  const pendingRef = useRef<QuizRecords | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const flush = useCallback(async () => {
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    if (!pending) return;
    const ref = docRef();
    if (!ref) return;
    try {
      await setDoc(ref, { records: pending, updatedAt: Date.now() }, { merge: true });
    } catch (e) {
      // 못 써도 이번 판은 그대로 돌아간다. 다음 답에서 다시 쓴다.
      console.warn('암기 성적을 저장하지 못했습니다.', e);
    }
  }, [docRef]);

  const scheduleFlush = useCallback(
    (next: QuizRecords) => {
      pendingRef.current = next;
      if (timerRef.current) clearTimeout(timerRef.current);
      timerRef.current = setTimeout(() => void flush(), FLUSH_DELAY);
    },
    [flush]
  );

  // 팝업을 닫거나 탭을 떠날 때 아직 안 쓴 것을 흘려 보낸다
  useEffect(() => {
    return () => {
      void flush();
    };
  }, [flush]);

  /** 새 판을 짠다 */
  const shuffle = useCallback(
    (opts: { keepRound?: boolean } = {}) => {
      if (!cls) return;
      const candidates: DeckItem[] = students
        .filter((s) => s.url && s.name)
        .map((s) => ({ ...s, key: quizKey(cls, s.name) }));

      setDeck(buildDeck(candidates, records, { weighted }));
      setIndex(0);
      setRevealed(false);
      setLast(null);
      setTally({ o: 0, x: 0 });
      if (!opts.keepRound) setRound((r) => r + 1);
    },
    [cls, students, records, weighted]
  );

  /** 성적을 다 읽고 명단이 갖춰지면 첫 판을 짠다 */
  useEffect(() => {
    if (!loaded || !clsKey) return;
    if (!cls) return;
    const candidates: DeckItem[] = students
      .filter((s) => s.url && s.name)
      .map((s) => ({ ...s, key: quizKey(cls, s.name) }));
    setDeck(buildDeck(candidates, records, { weighted }));
    setIndex(0);
    setRevealed(false);
    setLast(null);
    setTally({ o: 0, x: 0 });
    setRound(1);
    // records를 의존성에 넣으면 답을 누를 때마다 판이 다시 짜인다.
    // 판은 시작할 때 한 번만 정하고, 성적은 다음 판에 반영한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded, clsKey, rosterKey, weighted]);

  const current = deck[index] || null;
  const total = deck.length;

  /** O 또는 X */
  const answer = useCallback(
    (known: boolean) => {
      if (!current || revealed) return;
      const before = recordOf(records, current.key);
      const next = { ...records, [current.key]: applyAnswer(before, known) };
      setRecords(next);
      setLast({ key: current.key, known, prevStreak: before.streak });
      setRevealed(true);
      setTally((t) => (known ? { ...t, o: t.o + 1 } : { ...t, x: t.x + 1 }));
      scheduleFlush(next);
    },
    [current, revealed, records, scheduleFlush]
  );

  /** 방금 누른 답을 물린다 */
  const undo = useCallback(() => {
    if (!last) return;
    const cur = recordOf(records, last.key);
    const next = { ...records, [last.key]: undoAnswer(cur, last.known, last.prevStreak) };
    setRecords(next);
    setTally((t) =>
      last.known ? { ...t, o: Math.max(0, t.o - 1) } : { ...t, x: Math.max(0, t.x - 1) }
    );
    setLast(null);
    setRevealed(false);
    scheduleFlush(next);
  }, [last, records, scheduleFlush]);

  const next = useCallback(() => {
    setRevealed(false);
    setLast(null);
    setIndex((i) => i + 1);
  }, []);

  return {
    loaded,
    deck,
    current,
    total,
    index,
    revealed,
    round,
    weighted,
    setWeighted,
    /** 지금 보고 있는 학생의 누적 성적 */
    currentRecord: current ? recordOf(records, current.key) : null,
    records,
    answer,
    undo,
    next,
    shuffle,
    /** 방금 무엇을 눌렀는가. 정답 화면에서 그대로 되비쳐 준다. */
    lastKnown: last ? last.known : null,
    canUndo: !!last,
    finished: loaded && total > 0 && index >= total,
    tally,
  };
}
