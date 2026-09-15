//src/lib/govApi.ts
//
// data.go.kr 특일정보를 직접 부르는 곳. 이제 이 함수를 부르는 건 개발자뿐이다.
// (환경설정 > 개발자 설정 > 공휴일 내려받기)
//
// 키를 여기 적어두지 않는다. 소스에 적으면 빌드 결과물에 그대로 실려
// 누구나 꺼내 쓸 수 있고, 그러면 하루 호출 한도도 남이 대신 써버린다.
// 키는 admin/config(Firestore)에 두고 등록된 계정만 읽는다. lib/adminConfig.ts 참고.
//
// 사용자 화면은 이 함수를 부르지 않는다. holidays/{연도}를 읽기만 한다. lib/holidays.ts 참고.

export const fetchHolidaysFromGovApi = async function (
  year: number,
  apiKey: string
): Promise<Record<string, string>> {
  const cleanKey = (apiKey || '').trim();
  if (!cleanKey) {
    throw new Error('공공데이터포털 API Service Key가 필요합니다.');
  }

  // 이미 인코딩된 키를 그대로 붙여넣는 경우가 많아, 한 번 풀었다가 다시 인코딩한다
  const safeKey = encodeURIComponent(decodeURIComponent(cleanKey));

  const holidays: Record<string, string> = {};
  const failedMonths: string[] = [];

  // 1월부터 12월까지 동시에 요청한다
  const fetchPromises = Array.from({ length: 12 }, async (_, i) => {
    const monthStr = String(i + 1).padStart(2, '0');
    const url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${year}&solMonth=${monthStr}&ServiceKey=${safeKey}&_type=json&numOfRows=100`;

    try {
      const res = await fetch(url);
      const text = await res.text();
      const data = JSON.parse(text);

      if (data.response?.body?.items?.item) {
        let items = data.response.body.items.item;
        if (!Array.isArray(items)) items = [items];

        items.forEach((item: any) => {
          if (item.isHoliday === 'Y') {
            const locStr = item.locdate.toString();
            const dateStr = locStr.replace(/(\d{4})(\d{2})(\d{2})/, '$1-$2-$3');
            holidays[dateStr] = item.dateName;
          }
        });
      }
    } catch (e) {
      // 키가 틀렸을 때도 여기로 온다(응답이 JSON이 아닌 오류 XML로 온다).
      // 12개월이 전부 실패하면 아래에서 오류로 알린다.
      console.warn(`${year}년 ${monthStr}월 공휴일 파싱 오류:`, e);
      failedMonths.push(monthStr);
    }
  });

  await Promise.all(fetchPromises);

  if (failedMonths.length === 12) {
    throw new Error('공공데이터 응답을 읽지 못했습니다. API 키와 사용 승인 상태를 확인해 주세요.');
  }

  return holidays;
};
