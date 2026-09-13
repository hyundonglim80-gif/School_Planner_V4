#!/usr/bin/env node
// School Planner V4 - 백업 JSON 데이터 무결성 점검 (읽기 전용)
//
// 사용법:  node check-backup.mjs <백업파일.json> [--verbose]
//
// 앱의 백업 모달에서 "JSON 전체 백업"으로 받은 파일을 그대로 넣으면 된다.
// Firestore에 접속하지 않고 파일만 읽으므로 데이터를 건드릴 위험이 없다.

import fs from 'node:fs';

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith('--'));
const VERBOSE = args.includes('--verbose');

if (!file) {
  console.error('사용법: node check-backup.mjs <백업파일.json> [--verbose]');
  process.exit(2);
}

const payload = JSON.parse(fs.readFileSync(file, 'utf8'));
const events = payload.events || {};
const journals = payload.journals || {};
const tasks = payload.tasks || {};

// 앱의 lib/eventText.ts와 같은 규칙
const contentOf = (it) => String(it?.content ?? it?.text ?? '').trim();
const serialize = (list) =>
  (list || [])
    .map((it) => {
      const c = contentOf(it);
      if (!c) return null;
      return `${it?.completed ? '[v] ' : ''}${it?.label ? `[${it.label}] ` : ''}${c}`;
    })
    .filter((x) => x !== null)
    .join('\n');

const findings = {
  ghost: [],        // eventList=[] 인데 eventText 有 -> 지운 일정이 되살아난다
  staleText: [],    // eventList 와 eventText 내용이 어긋남
  invisible: [],    // content 없이 text만 있음 -> 화면에서 필터링되어 안 보임
  duplicates: [],   // 같은 날짜에 같은 내용이 중복 -> 이월 증식 흔적
  legacyOnly: [],   // eventList 필드 자체가 없는 V3 문서 (정상, 참고용)
};

let totalDates = 0;
let totalItems = 0;
let itemsWithAttachments = 0;
const authorCount = new Map();

for (const [dateStr, data] of Object.entries(events)) {
  totalDates++;
  const list = data?.eventList;
  const text = String(data?.eventText ?? '');

  if (!Array.isArray(list)) {
    if (text.trim()) findings.legacyOnly.push({ dateStr, lines: text.trim().split('\n').length });
    continue;
  }

  totalItems += list.length;

  if (list.length === 0) {
    if (text.trim()) {
      findings.ghost.push({ dateStr, lines: text.trim().split('\n').length, text: text.trim() });
    }
  } else {
    const expected = serialize(list);
    if (expected !== text) {
      findings.staleText.push({ dateStr, expected, actual: text });
    }
  }

  const seen = new Map();
  for (const it of list) {
    // 앱의 읽기 경로는 content만 본다. text에만 값이 있으면 목록에서 필터링되어
    // 저장은 되었는데 화면에는 나타나지 않는다 (반복 일정 생성 버그).
    const ownContent = String(it?.content ?? '').trim();
    const fallback = String(it?.text ?? '').trim();
    if (!ownContent && fallback) {
      findings.invisible.push({ dateStr, id: it?.id, raw: fallback });
    }
    const c = contentOf(it);
    if (c) seen.set(c, (seen.get(c) || 0) + 1);
    if (Array.isArray(it?.attachments) && it.attachments.length > 0) itemsWithAttachments++;
    const a = it?.authorId || '(없음)';
    authorCount.set(a, (authorCount.get(a) || 0) + 1);
  }
  for (const [c, n] of seen) {
    if (n > 1) findings.duplicates.push({ dateStr, content: c, count: n });
  }
}

// 기록(일지) 첨부는 이미 고쳐진 경로라 비교 기준으로 쓴다
let journalItems = 0;
let journalWithAttachments = 0;
for (const data of Object.values(journals)) {
  for (const j of data?.entries || []) {
    journalItems++;
    if (Array.isArray(j?.attachments) && j.attachments.length > 0) journalWithAttachments++;
  }
}

const line = '─'.repeat(64);
const fmt = (n) => String(n).padStart(5);

console.log(line);
console.log(`백업 파일 : ${file}`);
console.log(`범위      : ${payload.scopeName || payload.scope || '(알 수 없음)'}`);
console.log(`내보낸 때 : ${payload.exportedAt || '(없음)'}`);
console.log(line);
console.log(`일정 문서(날짜) ${fmt(totalDates)}개 / 일정 항목 ${fmt(totalItems)}개`);
console.log(`기록 항목       ${fmt(journalItems)}개`);
console.log(line);

console.log('\n[1] 지운 일정이 되살아나는 문서  (eventList 비었는데 eventText 남음)');
console.log(`    ${findings.ghost.length}건` + (findings.ghost.length ? '  ← 수정 대상' : '  ✅'));
for (const g of findings.ghost.slice(0, VERBOSE ? 1e9 : 10)) {
  console.log(`    - ${g.dateStr}: ${g.lines}줄이 되살아남`);
  if (VERBOSE) g.text.split('\n').forEach((l) => console.log(`        │ ${l}`));
}
if (!VERBOSE && findings.ghost.length > 10) console.log(`    ... 외 ${findings.ghost.length - 10}건 (--verbose)`);

console.log('\n[2] eventText 불일치  (지금은 무해하지만 목록이 비면 [1]이 된다)');
console.log(`    ${findings.staleText.length}건` + (findings.staleText.length ? '' : '  ✅'));
for (const s of findings.staleText.slice(0, VERBOSE ? 1e9 : 5)) {
  console.log(`    - ${s.dateStr}`);
  if (VERBOSE) {
    console.log(`        기대 │ ${s.expected.replace(/\n/g, '\n        기대 │ ')}`);
    console.log(`        실제 │ ${s.actual.replace(/\n/g, '\n        실제 │ ')}`);
  }
}
if (!VERBOSE && findings.staleText.length > 5) console.log(`    ... 외 ${findings.staleText.length - 5}건 (--verbose)`);

console.log('\n[3] 화면에 안 보이는 일정  (content 없이 text만 — 반복 일정 버그)');
console.log(`    ${findings.invisible.length}건` + (findings.invisible.length ? '  ← 유실된 것처럼 보였던 항목' : '  ✅'));
for (const v of findings.invisible.slice(0, VERBOSE ? 1e9 : 10)) {
  console.log(`    - ${v.dateStr}: "${v.raw}" (id=${v.id})`);
}

if (findings.legacyOnly.length) {
  console.log(`    (참고) eventList 필드가 없는 V3 레거시 문서 ${findings.legacyOnly.length}건 — 정상입니다`);
}

console.log('\n[4] 같은 날짜 내 중복 일정  (이월 증식 흔적)');
console.log(`    ${findings.duplicates.length}건` + (findings.duplicates.length ? '' : '  ✅'));
for (const d of findings.duplicates.slice(0, VERBOSE ? 1e9 : 10)) {
  console.log(`    - ${d.dateStr}: "${d.content}" ×${d.count}`);
}
if (!VERBOSE && findings.duplicates.length > 10) console.log(`    ... 외 ${findings.duplicates.length - 10}건 (--verbose)`);

console.log('\n[5] 일정 첨부파일 보유 항목');
console.log(`    일정 ${itemsWithAttachments}개 / 기록 ${journalWithAttachments}개`);
if (itemsWithAttachments === 0 && journalWithAttachments > 0) {
  console.log('    ← 기록에는 첨부가 남아 있는데 일정에는 0개. 일정 첨부 유실 버그의 흔적이다.');
}

console.log('\n[6] 작성자(authorId) 분포');
const authors = [...authorCount.entries()].sort((a, b) => b[1] - a[1]);
for (const [a, n] of authors.slice(0, 10)) {
  console.log(`    ${String(n).padStart(5)}개  ${a}`);
}
if (payload.scope && payload.scope !== 'personal' && authors.length === 1) {
  console.log('    ← 공유 그룹인데 작성자가 1명뿐. 작성자 정보가 덮어씌워진 상태다.');
}

console.log('\n' + line);
const critical = findings.ghost.length + findings.invisible.length;
if (critical === 0) {
  console.log('결과: 즉시 수정이 필요한 문제는 발견되지 않았습니다.');
} else {
  console.log(`결과: 주의가 필요한 문서 ${critical}건 ([1] + [3]).`);
}
console.log(line);

process.exit(0);
