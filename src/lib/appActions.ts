// src/lib/appActions.ts
//
// 화면(scope) 안의 단추가 Layout이 여는 창(자리표·누가기록·출석부 등)을 열 때 쓴다 (ROADMAP 16 학급 화면).
// 창의 열림 상태는 Layout이 쥐고 있으므로 화면이 직접 열 수 없다 - 단축키와 같은 이름(ShortcutId)으로 부탁하면
// Layout이 듣고 단축키를 누른 것과 똑같이 연다. 학생 누가기록은 학급·번호를 함께 넘겨 그 학생으로 연다.
import type { ShortcutId } from './shortcuts';

export const APP_ACTION_EVENT = 'sp4-app-action';

export interface AppActionDetail {
  id: ShortcutId;
  /** studentRecord: 처음 보일 학급·학생 */
  classKey?: string;
  num?: number;
}

export function runAppAction(detail: AppActionDetail) {
  window.dispatchEvent(new CustomEvent<AppActionDetail>(APP_ACTION_EVENT, { detail }));
}
