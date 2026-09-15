// src/lib/adminConfig.ts
//
// 개발자만 읽고 쓰는 설정 한 칸. 지금은 공공데이터 키 하나만 들어 있다.
//
// 키를 소스에 두지 않는 것이 요점이다. 소스에 두면 빌드 결과물에 그대로 남아
// 누구나 꺼내 볼 수 있다. 여기 두면 규칙(firestore.rules)이 등록된 계정만
// 읽게 막아주고, 개발자는 기기를 바꿔도 다시 입력할 필요가 없다.
import { doc, getDoc, setDoc } from 'firebase/firestore';
import { db, auth } from './firebase';

const configRef = () => doc(db, 'admin', 'config');

export interface AdminConfig {
  govApiKey: string;
}

/** 권한이 없거나 아직 없는 문서면 빈 값을 준다 (오류로 앱을 멈추지 않는다) */
export async function loadAdminConfig(): Promise<AdminConfig> {
  try {
    const snap = await getDoc(configRef());
    if (!snap.exists()) return { govApiKey: '' };
    return { govApiKey: (snap.data().govApiKey as string) || '' };
  } catch (e) {
    console.warn('admin/config 를 읽지 못했습니다 (규칙 배포 전이거나 권한 없음).', e);
    return { govApiKey: '' };
  }
}

export async function saveAdminGovApiKey(govApiKey: string): Promise<void> {
  await setDoc(
    configRef(),
    { govApiKey, updatedAt: Date.now(), updatedBy: auth.currentUser?.email || '' },
    { merge: true }
  );
}
