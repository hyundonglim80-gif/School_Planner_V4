// src/features/day/EmptyDayReport.tsx
//
// 하루 화면이 비어 있을 때, 왜 비었는지를 그 자리에서 말해 준다.
//
// '오늘 일정이 안 보인다'와 '이 계정에는 원래 아무것도 없다'는 화면에서 똑같이
// 비어 보인다. 원인은 정반대인데도 그렇다. 그래서 여러 판을 헤맸다.
// 이제 비어 있으면 계정에 직접 물어본다: 일정이 단 한 건이라도 있는가.
import { useEffect, useState } from 'react';
import type { EventReadReport } from '../../hooks/useDayData';
import { probeAccountHasEvents, ownerOfPath, type AccountProbe } from '../../lib/accountProbe';
import { useAuth } from '../auth/useAuth';

export default function EmptyDayReport({ report }: { report: EventReadReport | null }) {
  const { logout } = useAuth();
  const [probe, setProbe] = useState<AccountProbe | null>(null);

  useEffect(() => {
    if (!report) return;
    let alive = true;
    probeAccountHasEvents(report.path).then((r) => { if (alive) setProbe(r); });
    return () => { alive = false; };
  }, [report?.path]);

  // 막 열렸을 때는 아직 답이 오는 중일 수 있다. 몇 초는 기다려 준다.
  const [waited, setWaited] = useState(false);
  useEffect(() => {
    const t = setTimeout(() => setWaited(true), 4000);
    return () => clearTimeout(t);
  }, []);

  // 구독이 한 번도 답을 주지 않았으면 report 자체가 없다. 그것도 알려야 한다.
  if (!report) {
    if (!waited) return null;
    return (
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <p className="text-2xs font-bold mb-1">⚠️ 일정을 읽어오지 못했습니다</p>
        <p className="text-2xs leading-relaxed">
          일정을 가져오는 연결이 응답하지 않았습니다. 잠시 뒤에도 그대로면 새로고침해 주세요.
        </p>
      </div>
    );
  }

  const uid = ownerOfPath(report.path);
  const who = `${report.email || '(메일 없음)'} · ${uid.slice(0, 10)}…`;

  // ① 이 계정에 일정이 단 한 건도 없다 → 거의 확실히 다른 계정으로 들어온 것이다
  if (probe?.state === 'empty') {
    return (
      <div className="rounded-xl border-2 border-amber-400 bg-amber-50 px-4 py-3 text-amber-900">
        <p className="text-2xs font-bold mb-1">⚠️ 이 계정에는 일정이 하나도 없습니다</p>
        <p className="text-2xs leading-relaxed">
          오늘만 비어 있는 것이 아니라, 이 계정에 저장된 일정이 <b>단 한 건도</b> 없습니다.
          평소 쓰시던 계정과 <b>다른 구글 계정으로 로그인</b>되었을 가능성이 큽니다.
          (V3와 V4는 로그인이 따로 걸려 있어 서로 다른 계정으로 들어갈 수 있습니다.)
        </p>
        <p className="text-2xs mt-1.5 text-amber-800/80 break-all">지금 계정: {who}</p>
        <button
          onClick={() => { void logout(); }}
          className="mt-2 px-3 py-1.5 rounded-lg bg-amber-600 text-white font-bold text-2xs hover:bg-amber-700"
        >
          로그아웃하고 계정 다시 고르기
        </button>
      </div>
    );
  }

  if (probe?.state === 'error') {
    return (
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <p className="text-2xs font-bold mb-1">⚠️ 일정을 확인하지 못했습니다</p>
        <p className="text-2xs leading-relaxed break-all">서버에 묻다가 막혔습니다 ({probe.code}).</p>
        <p className="text-2xs mt-1.5 text-amber-800/80 break-all">지금 계정: {who}</p>
      </div>
    );
  }

  // ② 읽다가 오류가 났거나, 서버엔 있는데 못 읽은 경우
  if (report.liveError || report.server === 'error' || report.server === 'exists') {
    const what =
      report.server === 'exists'
        ? '서버에는 오늘 일정이 있는데 이 기기가 못 읽었습니다. 캐시를 비우고 다시 받는 중입니다.'
        : report.liveError
        ? `일정을 읽는 중 오류가 났습니다 (${report.liveError}).`
        : `서버에 직접 확인하지 못했습니다 (${report.serverError}).`;
    return (
      <div className="rounded-xl border-2 border-amber-300 bg-amber-50 px-4 py-3 text-amber-900">
        <p className="text-2xs font-bold mb-1">⚠️ 오늘 일정을 불러오지 못했습니다</p>
        <p className="text-2xs leading-relaxed">{what}</p>
        <p className="text-2xs mt-1.5 text-amber-800/80 break-all">지금 계정: {who} · 읽은 곳 {report.path}</p>
      </div>
    );
  }

  // ③ 계정에 자료는 있고 오늘만 비어 있다 = 정상일 수 있다. 조용히 한 줄만 남긴다.
  if (probe?.state === 'has-data') {
    return (
      <p className="text-2xs text-slate-400 break-all">
        이 계정에 일정 자료는 있습니다 · {who}
      </p>
    );
  }

  return null;
}
