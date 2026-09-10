//src/lib/govApi.ts

// 환경변수(.env)에 저장된 키를 사용하거나, 이곳 문자열에 직접 키를 하드코딩하여 적용할 수 있습니다.
const DEFAULT_GOV_API_KEY = import.meta.env.VITE_GOV_API_KEY || '61eKHEN9Q5rvaYiHWrtSUco3vwTEhoCiF0d8L2Zdu990gANAp3Cnc0yKKgWqOm3s%2F4Mmqa9STa6WvNHboA1RsQ%3D%3D';

export const fetchHolidaysFromGovApi = async function(
  year: number, 
  apiKey?: string
): Promise<Record<string, string>> {
  
  // 1. 전달받은 apiKey가 없으면 기본 API 키 사용
  const activeKey = apiKey || DEFAULT_GOV_API_KEY;

  if (!activeKey) {
    throw new Error("공공데이터포털 API Service Key가 필요합니다.");
  }
  
  let cleanKey = activeKey.trim();
  let safeKey = encodeURIComponent(decodeURIComponent(cleanKey));
  
  let holidays: Record<string, string> = {};

  // 💡 1월부터 12월까지 모든 달의 공휴일을 동시에(병렬로) 요청합니다.
  const fetchPromises = Array.from({ length: 12 }, async (_, i) => {
    const monthStr = String(i + 1).padStart(2, '0');
    let url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${year}&solMonth=${monthStr}&ServiceKey=${safeKey}&_type=json&numOfRows=100`;
    
    try {
      let res = await fetch(url);
      let text = await res.text();
      let data = JSON.parse(text);

      if (data.response && data.response.body && data.response.body.items && data.response.body.items.item) {
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
      console.warn(`${year}년 ${monthStr}월 공휴일 파싱 오류:`, e);
    }
  });

  // 12개월치 요청이 모두 끝날 때까지 대기
  await Promise.all(fetchPromises);
  
  return holidays;
};