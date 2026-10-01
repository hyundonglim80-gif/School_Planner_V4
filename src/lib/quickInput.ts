// src/lib/quickInput.ts
//
// 새 일정 빠른 입력 (ROADMAP 11) - 순수 셈. 화면은 components/QuickInputChips.
//
//   새 일정 내용에서 날짜·기한·시각·라벨·반복을 알아보고, 저장 전에 칩으로 보인다. 누르면 그 값을 칸에 넣는다.
//   알아본 말을 글에서 빼는 것은 칩을 누를 때만(사용자가 고르는 것) - 읽기·저장 경로에서 본문을 바꾸지 않는다는 규칙.
//
//   날짜  오늘·내일·모레·글피 / (이번·다음·다다음) 주 화(요일) / 화요일 / 10/15 / 10월 15일 / 2026-10-15 / 3일 뒤·2주 후
//   기한  위 날짜 + '까지' (10/15까지, 금요일까지)
//   시각  15:00 / 오후 3시 / 3시 반 / 9시 20분 (오전·오후가 없으면 1~7시는 오후로)
//   라벨  #공문 (있는 일정 라벨 이름일 때만)
//   반복  매주 화 / 매주 월·수 / 격주 금

export interface QuickMatch {
  start: number;
  end: number;
  text: string;
}

export interface QuickParse {
  /** 저장할 날짜 (기한이 아닌 첫 날짜 말) */
  date?: { date: string; match: QuickMatch };
  /** '…까지' */
  due?: { date: string; match: QuickMatch };
  /** HH:mm */
  time?: { hhmm: string; match: QuickMatch };
  labels: { name: string; match: QuickMatch }[];
  recur?: { days: number[]; biweekly: boolean; match: QuickMatch };
}

const WEEKDAY = '일월화수목금토';

const pad = (n: number) => String(n).padStart(2, '0');

function parseYmd(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

function ymd(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function addDaysTo(base: Date, n: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + n);
  return d;
}

/** 있는 날짜인가 (2/30 같은 것은 버린다) */
function makeDate(y: number, m: number, d: number): Date | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const dt = new Date(y, m - 1, d);
  return dt.getMonth() === m - 1 && dt.getDate() === d ? dt : null;
}

/** 월/일만 적었으면 올해, 두 달 넘게 지난 날이면 내년 (12월에 '1/5'라고 적는 경우) */
function inferYear(base: Date, m: number, d: number): Date | null {
  const dt = makeDate(base.getFullYear(), m, d);
  if (!dt) return null;
  if (dt.getTime() < addDaysTo(base, -60).getTime()) return makeDate(base.getFullYear() + 1, m, d);
  return dt;
}

/** 월요일 시작 주에서 그 요일 (weekOffset 0 = 이번 주) */
function weekdayInWeek(base: Date, weekOffset: number, wd: number): Date {
  const monday = addDaysTo(base, -((base.getDay() + 6) % 7));
  return addDaysTo(monday, weekOffset * 7 + ((wd + 6) % 7));
}

/** 오늘 또는 그 뒤의 첫 그 요일 */
function nextWeekday(base: Date, wd: number): Date {
  return addDaysTo(base, (wd - base.getDay() + 7) % 7);
}

interface DateCandidate {
  date: Date;
  start: number;
  end: number;
}

const DATE_RULES: Array<{ re: RegExp; make: (m: RegExpExecArray, base: Date) => Date | null }> = [
  { re: /(\d{4})[-./](\d{1,2})[-./](\d{1,2})/g, make: (m) => makeDate(+m[1], +m[2], +m[3]) },
  { re: /(\d{1,2})월\s?(\d{1,2})일/g, make: (m, b) => inferYear(b, +m[1], +m[2]) },
  // (1/3) 같은 기간 일정 표시는 날짜가 아니다
  { re: /(?<![\d(/])(\d{1,2})\s?\/\s?(\d{1,2})(?![\d/)])/g, make: (m, b) => inferYear(b, +m[1], +m[2]) },
  { re: /(이번\s?주|다음\s?주|담주|다다음\s?주)\s?([일월화수목금토])(?:요일)?/g, make: (m, b) => {
    const w = m[1].replace(/\s/g, '');
    const off = w === '이번주' ? 0 : w === '다다음주' ? 2 : 1;
    return weekdayInWeek(b, off, WEEKDAY.indexOf(m[2]));
  } },
  { re: /(?<![가-힣])([일월화수목금토])요일/g, make: (m, b) => nextWeekday(b, WEEKDAY.indexOf(m[1])) },
  { re: /(오늘|내일|모레|글피)/g, make: (m, b) => addDaysTo(b, ['오늘', '내일', '모레', '글피'].indexOf(m[1])) },
  { re: /(\d{1,2})\s?(일|주)\s?(뒤|후)/g, make: (m, b) => addDaysTo(b, +m[1] * (m[2] === '주' ? 7 : 1)) },
];

const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) => a.start < b.end && b.start < a.end;

function findTime(text: string): QuickParse['time'] {
  const found: Array<{ h: number; mi: number; start: number; end: number }> = [];
  const ampm = /(오전|오후)\s?(\d{1,2})시(?:\s?(\d{1,2})분|\s?(반))?/g;
  for (let m; (m = ampm.exec(text)); ) {
    let h = +m[2];
    if (h > 12) continue;
    if (m[1] === '오후' && h < 12) h += 12;
    if (m[1] === '오전' && h === 12) h = 0;
    found.push({ h, mi: m[4] ? 30 : m[3] ? +m[3] : 0, start: m.index, end: m.index + m[0].length });
  }
  const colon = /(?<!\d)(\d{1,2}):(\d{2})(?!\d)/g;
  for (let m; (m = colon.exec(text)); ) {
    if (+m[1] < 24 && +m[2] < 60) found.push({ h: +m[1], mi: +m[2], start: m.index, end: m.index + m[0].length });
  }
  // '3시' - '1시간'·'3교시'는 아니다. 오전·오후가 없으면 1~7시는 오후(학교 하루)
  const bare = /(?<![\d가-힣])(\d{1,2})시(?!간)(?:\s?(\d{1,2})분|\s?(반))?/g;
  for (let m; (m = bare.exec(text)); ) {
    let h = +m[1];
    if (h > 23) continue;
    if (h >= 1 && h <= 7) h += 12;
    const hit = { h, mi: m[3] ? 30 : m[2] ? +m[2] : 0, start: m.index, end: m.index + m[0].length };
    if (!found.some((f) => overlaps(f, hit))) found.push(hit);
  }
  const first = found.filter((f) => f.mi < 60).sort((a, b) => a.start - b.start)[0];
  if (!first) return undefined;
  return { hhmm: `${pad(first.h)}:${pad(first.mi)}`, match: { start: first.start, end: first.end, text: text.slice(first.start, first.end) } };
}

function findRecur(text: string): QuickParse['recur'] {
  // 요일 글자(월·화·수…)는 '수업'·'화요일'처럼 낱말 첫 글자이기도 해서 정규식 하나로는 가리기 어렵다 - 한 토막씩 읽는다
  const head = /(매주|격주)/g;
  for (let m; (m = head.exec(text)); ) {
    let i = m.index + m[0].length;
    if (text[i] === ' ') i++;
    const days = new Set<number>();
    let end = -1;
    while (i < text.length) {
      let j = i;
      while (j < text.length && WEEKDAY.includes(text[j])) j++;
      if (j === i) break;
      let k = j;
      if (text.startsWith('요일', k)) k += 2;
      else if (/[가-힣]/.test(text[k] || '')) break; // '매주 수업' - 요일이 아니라 낱말
      for (const c of text.slice(i, j)) days.add(WEEKDAY.indexOf(c));
      end = k;
      // 다음 요일로: 쉼표·가운뎃점, 또는 빈칸 뒤 요일 한 글자(뒤가 낱말이 아닐 때)
      const sep = /^\s?[,·、/]\s?|^\s(?=[일월화수목금토](?:요일|[^가-힣]|$))/.exec(text.slice(k));
      if (!sep) break;
      i = k + sep[0].length;
    }
    if (days.size > 0 && end > 0) {
      return {
        days: [...days].sort((a, b) => a - b),
        biweekly: m[1] === '격주',
        match: { start: m.index, end, text: text.slice(m.index, end) },
      };
    }
  }
  return undefined;
}

function findLabels(text: string, labelNames: string[]): QuickParse['labels'] {
  const out: QuickParse['labels'] = [];
  // 긴 이름 먼저 ('공문 처리'가 '공문'보다 먼저)
  for (const name of [...new Set(labelNames)].filter(Boolean).sort((a, b) => b.length - a.length)) {
    const re = new RegExp(`#${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?![가-힣A-Za-z0-9_])`, 'g');
    for (let m; (m = re.exec(text)); ) {
      const match = { start: m.index, end: m.index + m[0].length, text: m[0] };
      if (out.some((o) => overlaps(o.match, match))) continue;
      out.push({ name, match });
      break;
    }
  }
  return out.sort((a, b) => a.match.start - b.match.start);
}

/** 새 일정 내용에서 알아본 것 */
export function parseQuickInput(text: string, baseDate: string, labelNames: string[] = []): QuickParse {
  const base = parseYmd(baseDate);
  const recur = findRecur(text);
  const time = findTime(text);
  const labels = findLabels(text, labelNames);
  const taken = [recur?.match, time?.match, ...labels.map((l) => l.match)].filter(Boolean) as QuickMatch[];

  const cands: DateCandidate[] = [];
  for (const rule of DATE_RULES) {
    rule.re.lastIndex = 0;
    for (let m; (m = rule.re.exec(text)); ) {
      const hit = { start: m.index, end: m.index + m[0].length };
      if (taken.some((t) => overlaps(t, hit)) || cands.some((c) => overlaps(c, hit))) continue;
      const date = rule.make(m, base);
      if (date) cands.push({ date, ...hit });
    }
  }
  cands.sort((a, b) => a.start - b.start);

  const result: QuickParse = { labels };
  if (time) result.time = time;
  if (recur) result.recur = recur;
  for (const c of cands) {
    const until = /^\s?까지/.exec(text.slice(c.end));
    if (until) {
      if (!result.due) {
        const end = c.end + until[0].length;
        result.due = { date: ymd(c.date), match: { start: c.start, end, text: text.slice(c.start, end) } };
      }
    } else if (!result.date) {
      result.date = { date: ymd(c.date), match: { start: c.start, end: c.end, text: text.slice(c.start, c.end) } };
    }
  }
  return result;
}

/** 알아본 말을 글에서 뺀다 (칩을 눌렀을 때). 남는 빈칸·줄 끝 빈칸을 다듬는다 */
export function stripMatch(text: string, match: QuickMatch): string {
  if (text.slice(match.start, match.end) !== match.text) return text;
  const before = text.slice(0, match.start).replace(/[ \t]+$/, '');
  const after = text.slice(match.end).replace(/^[ \t]+/, '');
  const joiner = before && after && !/\n$/.test(before) && !/^\n/.test(after) ? ' ' : '';
  return (before + joiner + after).replace(/[ \t]+\n/g, '\n').trim();
}
