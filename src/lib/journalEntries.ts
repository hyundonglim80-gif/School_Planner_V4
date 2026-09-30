// src/lib/journalEntries.ts
//
// 기록 문서(`{sp}/journals/{날짜}`)의 entries를 읽는 한 곳.
// id 없는 옛 기록에는 화면(useDayData.applyJournalData)과 같은 이름 `jr_차례`를 붙인다.
// id로 짝을 맞추는 코드(고치기·지우기·링크·되살리기)가 저마다 다르게 읽으면 같은 기록을 못 찾는다
// (일정의 readEventList와 같은 이유).

export function readJournalEntries(data: any): any[] {
  const raw = data && Array.isArray(data.entries) ? (data.entries as any[]) : [];
  return raw.map((j, idx) =>
    j && j.id !== undefined && j.id !== null && j.id !== ''
      ? j
      : { ...(j && typeof j === 'object' ? j : {}), id: 'jr_' + idx }
  );
}
