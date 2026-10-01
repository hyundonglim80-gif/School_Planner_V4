// src/lib/weeklyGuide.ts
//
// 주간학습안내 (ROADMAP 12-2) - 순수 셈. 읽기는 lib/weeklyGuideStore, 화면은 components/WeeklyGuideModal.
//
//   한 주(월~금)의 요일 × 교시 표: 과목 + 수업 메모, 날마다 준비물(교시 준비물을 모아 겹친 것은 하나로)·알림장 줄.
//   인쇄(lib/print)와 표 복사(엑셀·한글·워드에 붙여넣기 - HTML 표와 탭 글 둘 다)에 같은 표를 쓴다.

export interface GuidePeriod {
  subject: string;
  memo: string;
  supplies: string;
}

export interface GuideDay {
  date: string;
  /** 교시 번호(1부터) → 그 교시 */
  periods: Record<number, GuidePeriod>;
  /** 그날 알림장 줄 */
  notices: string[];
}

export interface GuideOptions {
  memo: boolean;
  supplies: boolean;
  notices: boolean;
}

const DAY = '일월화수목금토';
const pad = (n: number) => String(n).padStart(2, '0');

function parse(s: string): Date {
  const [y, m, d] = s.split('-').map(Number);
  return new Date(y, m - 1, d);
}

const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** 그날이 든 주의 월~금 */
export function schoolWeekOf(dateStr: string): string[] {
  const d = parse(dateStr);
  const monday = new Date(d);
  monday.setDate(d.getDate() - ((d.getDay() + 6) % 7));
  return Array.from({ length: 5 }, (_, i) => {
    const x = new Date(monday);
    x.setDate(monday.getDate() + i);
    return ymd(x);
  });
}

/** 다음 주 월요일 (오늘이 든 주의 다음) */
export function nextWeekMonday(today: string): string {
  const mon = schoolWeekOf(today)[0];
  const d = parse(mon);
  d.setDate(d.getDate() + 7);
  return ymd(d);
}

export function shiftWeek(dateStr: string, weeks: number): string {
  const d = parse(schoolWeekOf(dateStr)[0]);
  d.setDate(d.getDate() + weeks * 7);
  return ymd(d);
}

/** '10/5(월)' */
export const dayHead = (dateStr: string) => {
  const d = parse(dateStr);
  return `${d.getMonth() + 1}/${d.getDate()}(${DAY[d.getDay()]})`;
};

/** '10.5 ~ 10.9' */
export function weekRangeText(dates: string[]): string {
  if (dates.length === 0) return '';
  const f = (s: string) => `${Number(s.slice(5, 7))}.${Number(s.slice(8, 10))}`;
  return `${f(dates[0])} ~ ${f(dates[dates.length - 1])}`;
}

/** 수업 문서의 periods를 교시 표로 (V3 옛 모양 - 과목 글자만 - 도) */
export function periodsFromDoc(raw: unknown): Record<number, GuidePeriod> {
  const out: Record<number, GuidePeriod> = {};
  if (!raw || typeof raw !== 'object') return out;
  for (const [k, v] of Object.entries(raw as Record<string, any>)) {
    const n = Number(k);
    if (!Number.isInteger(n) || n < 1) continue;
    if (typeof v === 'string') {
      if (v.trim()) out[n] = { subject: v.trim(), memo: '', supplies: '' };
    } else if (v && typeof v === 'object') {
      const p = {
        subject: String(v.subject || '').trim(),
        memo: String(v.memo || v.content || '').trim(),
        supplies: String(v.supplies || '').trim(),
      };
      if (p.subject || p.memo || p.supplies) out[n] = p;
    }
  }
  return out;
}

/** 몇 교시까지 그릴까 - 시간표 교시 수와 실제 적힌 마지막 교시 중 큰 쪽 */
export function periodCountOf(days: GuideDay[], templateCount: number): number {
  let max = templateCount;
  for (const d of days) for (const k of Object.keys(d.periods)) max = Math.max(max, Number(k));
  return Math.max(1, max);
}

/** 그날 준비물 - 교시 준비물을 쉼표·가운뎃점으로 나눠 겹친 것은 하나로 */
export function suppliesOf(day: GuideDay): string[] {
  const out: string[] = [];
  for (const k of Object.keys(day.periods).map(Number).sort((a, b) => a - b)) {
    for (const s of day.periods[k].supplies.split(/[,·、\n]/)) {
      const t = s.trim();
      if (t && !out.includes(t)) out.push(t);
    }
  }
  return out;
}

export interface GuideTable {
  head: string[];
  /** 줄마다 [머리, 요일 칸…] - 칸은 여러 줄 글 */
  rows: string[][];
}

/** 표 (인쇄·복사가 같이 쓴다) */
export function guideTable(days: GuideDay[], periodNames: string[], opts: GuideOptions): GuideTable {
  const count = periodCountOf(days, periodNames.length);
  const head = ['', ...days.map((d) => dayHead(d.date))];
  const rows: string[][] = [];
  for (let n = 1; n <= count; n++) {
    rows.push([
      periodNames[n - 1] || `${n}교시`,
      ...days.map((d) => {
        const p = d.periods[n];
        if (!p) return '';
        return [p.subject, opts.memo ? p.memo : ''].filter(Boolean).join('\n');
      }),
    ]);
  }
  if (opts.supplies) rows.push(['준비물', ...days.map((d) => suppliesOf(d).join(', '))]);
  if (opts.notices) rows.push(['알림장', ...days.map((d) => d.notices.map((l, i) => `${i + 1}. ${l}`).join('\n'))]);
  return { head, rows };
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** 붙여넣기용 HTML 표 (한글·워드·엑셀) */
export function guideHtml(title: string, note: string, table: GuideTable): string {
  const cell = (s: string, th = false) =>
    `<${th ? 'th' : 'td'} style="border:1px solid #64748b;padding:4px 6px;vertical-align:top;${th ? 'background:#f1f5f9;' : ''}">${escapeHtml(s).replace(/\n/g, '<br>')}</${th ? 'th' : 'td'}>`;
  return [
    `<h3>${escapeHtml(title)}</h3>`,
    note.trim() ? `<p>${escapeHtml(note.trim()).replace(/\n/g, '<br>')}</p>` : '',
    '<table style="border-collapse:collapse">',
    `<tr>${table.head.map((h) => cell(h, true)).join('')}</tr>`,
    ...table.rows.map((r) => `<tr>${r.map((c, i) => cell(c, i === 0)).join('')}</tr>`),
    '</table>',
  ].join('');
}

/** 붙여넣기용 탭 글 (칸 안 줄바꿈은 따옴표로 감싸 엑셀이 한 칸으로 읽게) */
export function guideTsv(table: GuideTable): string {
  const cell = (s: string) => (/[\t\n"]/.test(s) ? `"${s.replace(/"/g, '""').replace(/\t/g, ' ')}"` : s);
  return [table.head, ...table.rows].map((r) => r.map(cell).join('\t')).join('\n');
}
