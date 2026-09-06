export async function exportToGoogleCalendar(
  token: string, 
  eventsToExport: any[], 
  onProgress?: (msg: string) => void
) {
  try {
    if (onProgress) onProgress('기존 캘린더 확인 중...');
    
    // 1. 기존 School Planner 캘린더 찾기
    const listRes = await fetch('https://www.googleapis.com/calendar/v3/users/me/calendarList', {
      headers: { 'Authorization': `Bearer ${token}` }
    });
    if (!listRes.ok) throw new Error('캘린더 목록을 불러오지 못했습니다.');
    
    const listData = await listRes.json();
    let calendarId = listData.items?.find((item: any) => item.summary === 'School Planner')?.id;

    // 2. 없으면 생성
    if (!calendarId) {
      if (onProgress) onProgress('새 캘린더(School Planner) 생성 중...');
      const createRes = await fetch('https://www.googleapis.com/calendar/v3/calendars', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ summary: 'School Planner', timeZone: 'Asia/Seoul' })
      });
      if (!createRes.ok) throw new Error('새 캘린더 생성 실패');
      const createData = await createRes.json();
      calendarId = createData.id;
    }

    // 3. 이벤트 추가
    let count = 0;
    for (const ev of eventsToExport) {
      count++;
      if (onProgress) onProgress(`구글 캘린더에 일정 등록 중... (${count}/${eventsToExport.length})`);

      await fetch(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          summary: ev.text || '제목 없음',
          description: 'School Planner 동기화 항목',
          start: { date: ev.dateStr },
          end: { date: ev.dateStr } // 종일 일정
        })
      });
    }

    if (onProgress) onProgress('구글 캘린더 연동 완료!');
    return true;
  } catch (error: any) {
    console.error(error);
    throw error;
  }
}

export async function importFromGoogleCalendar(
  token: string, 
  startDate: string, 
  endDate: string, 
  onProgress?: (msg: string) => void
) {
  try {
    if (onProgress) onProgress('구글 캘린더 일정 불러오는 중...');

    const timeMin = startDate ? new Date(startDate).toISOString() : new Date(new Date().setFullYear(new Date().getFullYear() - 1)).toISOString();
    const timeMax = endDate ? new Date(endDate + 'T23:59:59Z').toISOString() : new Date(new Date().setFullYear(new Date().getFullYear() + 1)).toISOString();

    const res = await fetch(`https://www.googleapis.com/calendar/v3/calendars/primary/events?timeMin=${timeMin}&timeMax=${timeMax}&singleEvents=true`, {
      headers: { 'Authorization': `Bearer ${token}` }
    });

    if (!res.ok) throw new Error('일정을 불러오지 못했습니다.');
    
    const data = await res.json();
    return data.items || [];
  } catch (error: any) {
    console.error(error);
    throw error;
  }
}
