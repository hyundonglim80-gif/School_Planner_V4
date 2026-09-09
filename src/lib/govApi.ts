//src/lib/govApi.ts

// 환경변수(.env)에 저장된 키를 사용하거나, 이곳 문자열에 직접 키를 하드코딩하여 적용할 수 있습니다.
const DEFAULT_GOV_API_KEY = import.meta.env.VITE_GOV_API_KEY || '61eKHEN9Q5rvaYiHWrtSUco3vwTEhoCiF0d8L2Zdu990gANAp3Cnc0yKKgWqOm3s%2F4Mmqa9STa6WvNHboA1RsQ%3D%3D';

export const fetchHolidaysFromGovApi = async function(
  year: number, 
  apiKey?: string // 인자를 선택적(optional)으로 변경
): Promise<Record<string, string>> {
  
  // 1. 전달받은 apiKey가 없으면 기본 API 키 사용
  const activeKey = apiKey || DEFAULT_GOV_API_KEY;

  if (!activeKey || activeKey === '61eKHEN9Q5rvaYiHWrtSUco3vwTEhoCiF0d8L2Zdu990gANAp3Cnc0yKKgWqOm3s%2F4Mmqa9STa6WvNHboA1RsQ%3D%3D') {
    throw new Error("공공데이터포털 API Service Key가 필요합니다.");
  }
  
  let cleanKey = activeKey.trim();
  let safeKey = encodeURIComponent(decodeURIComponent(cleanKey));
  let url = `https://apis.data.go.kr/B090041/openapi/service/SpcdeInfoService/getRestDeInfo?solYear=${year}&ServiceKey=${safeKey}&_type=json&numOfRows=100`;
  
  let res = await fetch(url);
  let text = await res.text();
  
  let data;
  try {
      data = JSON.parse(text);
  } catch(e) {
      throw new Error("공공데이터 API 응답이 JSON 형태가 아닙니다.", { cause: e });
  }
  
  let holidays: Record<string, string> = {};
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
  return holidays;
};