// src/hooks/useShareReceiver.ts
// 다른 앱에서 공유받은 것을 새 메모 쓰는 칸에 채워 연다 (lib/shareTarget).
// Layout은 로그인한 뒤에만 그려지므로, 로그인 화면을 거쳐 와도 주소의 '?share='는 남아 있다가 여기서 꺼낸다.
import { useEffect } from 'react';
import { takeSharedPayload } from '../lib/shareTarget';
import { openEntryPanel } from '../components/EntryPanelHost';
import { showToast, showErrorToast } from '../utils/toast';

// 꺼내기는 한 번만 한다 (꺼내면 주소·캐시에서 지운다). 개발 모드(StrictMode)는 효과를 두 번 돌리고
// 첫 번째를 바로 거두므로, 둘이 같은 약속을 기다려 살아 있는 쪽이 연다.
let taking: ReturnType<typeof takeSharedPayload> | null = null;
let opened = false;

export function useShareReceiver(): void {
  useEffect(() => {
    let cancelled = false;
    taking ??= takeSharedPayload();
    taking
      .then((payload) => {
        if (cancelled || !payload || opened) return;
        opened = true;
        // 받는 곳은 개인 공간의 새 메모. 저장은 사용자가 누를 때만 (공유를 잘못 골라도 닫으면 그만)
        void openEntryPanel({ kind: 'memo', groupId: null, draftText: payload.text, draftFiles: payload.files });
        showToast(
          payload.files.length > 0
            ? '📥 공유받은 내용을 새 메모에 담았습니다. 파일은 \'드라이브에 올려 첨부\'를 누르고 저장하세요.'
            : '📥 공유받은 내용을 새 메모에 담았습니다. 저장을 눌러야 남습니다.'
        );
      })
      .catch((e) => {
        if (!cancelled && !opened) {
          opened = true;
          showErrorToast('공유받은 내용을 읽지 못했습니다. 다시 공유해 주세요.', e);
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);
}
