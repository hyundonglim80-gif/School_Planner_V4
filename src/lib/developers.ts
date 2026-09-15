// src/lib/developers.ts
//
// '개발자에게만 보이는' 설정을 가르는 기준.
//
// 주의: 이건 화면에 보이냐 마느냐일 뿐, 보안 경계가 아니다.
// 공공데이터 키는 여전히 빌드 결과물에 들어가므로, 마음먹은 사람은 꺼내 볼 수 있다.
// 키를 정말 감추려면 브라우저가 data.go.kr을 직접 부르지 않아야 한다
// (공휴일을 Firestore에 한 번 받아두고 사용자는 읽기만 하는 구조).
export const DEVELOPER_EMAILS = [
  'hyundonglim@gmail.com',
  'hyundonglim80@gmail.com',
  'hyundonglim.work@gmail.com',
] as const;

export function isDeveloper(email?: string | null): boolean {
  if (!email) return false;
  return DEVELOPER_EMAILS.includes(email.trim().toLowerCase() as typeof DEVELOPER_EMAILS[number]);
}
