// src/features/day/EmptyDayReport.tsx
//
// 오늘 일정이 비어 있을 때, 왜 비었는지를 화면에서 바로 보여 준다.
//
// '안 보인다'는 신고를 여러 번 받았는데, 그때마다 어느 계정으로 어느 문서를
// 읽었고 서버는 뭐라고 했는지를 알 수 없어 한참을 헤맸다. 정말 그날 일정이
// 없는 것과, 읽지 못한 것은 화면에서 똑같이 '비어 있음'으로 보인다. 그 둘을
// 가르는 정보를 여기에 적는다.
import type { EventReadReport } from '../../hooks/useDayData';

export default function EmptyDayReport({ report }: { report: EventReadReport | null }) {
  if (!report) return null;

  // 서버에도 없으면 그냥 '그날 일정이 없는 날'이다. 알릴 것이 없다.
  if (report.server === 'missing' && !report.liveError) return null;
  // 서버 확인 전이고 오류도 없으면 아직 판단할 근거가 없다.
  if (report.server === 'not-checked' && !report.liveError) return null;

  const trouble = report.liveError || report.server === 'error' || report.server === 'exists';
  if (!trouble) return null;

  const what =
    report.server === 'exists'
      ? '서버에는 오늘 일정이 있는데 이 기기가 못 읽었습니다. 캐시를 비우고 다시 받는 중입니다 — 잠시 뒤 화면이 새로 고쳐집니다.'
      : report.liveError
      ? `일정을 읽는 중 오류가 났습니다 (${report.liveError}).`
      : `서버에 직접 확인하지 못했습니다 (${report.serverError}).`;

  return (
    <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
      <p className="text-2xs font-bold mb-1">⚠️ 오늘 일정을 불러오지 못했습니다</p>
      <p className="text-2xs leading-relaxed">{what}</p>
      <p className="text-2xs leading-relaxed mt-1.5 text-amber-800/80 break-all">
        계정 {report.email || '(알 수 없음)'} · 읽은 곳 {report.path}
      </p>
    </div>
  );
}
