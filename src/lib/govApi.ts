export const fetchHolidaysFromGovApi = async function(year: number, apiKey: string): Promise<Record<string, string>> {
  if (!apiKey) throw new Error("공공데이터포털 API Service Key가 필요합니다.");
  
  let cleanKey = apiKey.trim();
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
