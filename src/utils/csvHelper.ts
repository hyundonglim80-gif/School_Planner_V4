import type { Student } from '../hooks/useRoster';

/**
 * 학생 명단을 CSV 파일로 다운로드합니다.
 */
export function downloadCSV(students: Student[], filename: string) {
  // 헤더 생성
  const headers = ['번호', '이름', '성별', '상태', '특이사항'];
  const csvRows = [];
  csvRows.push(headers.join(','));

  // 데이터 생성
  for (const st of students) {
    const row = [
      st.num || '',
      st.name || '',
      st.gender || '',
      st.isActive !== false ? '재학' : '전출',
      st.note || ''
    ];
    // CSV 이스케이프 (쉼표나 따옴표가 있을 수 있으므로 쌍따옴표로 감싸기)
    const escapedRow = row.map(v => `"${String(v).replace(/"/g, '""')}"`);
    csvRows.push(escapedRow.join(','));
  }

  const csvString = csvRows.join('\n');
  const blob = new Blob(['\uFEFF' + csvString], { type: 'text/csv;charset=utf-8;' }); // BOM 추가 (한글 깨짐 방지)
  const link = document.createElement('a');
  if (link.download !== undefined) {
    const url = URL.createObjectURL(blob);
    link.setAttribute('href', url);
    link.setAttribute('download', filename);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  }
}

/**
 * CSV 텍스트를 학생 배열로 변환합니다.
 */
export async function parseCSV(file: File): Promise<Student[]> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const text = e.target?.result as string;
        if (!text) {
          resolve([]);
          return;
        }

        const lines = text.split(/\r?\n/).filter(line => line.trim() !== '');
        if (lines.length < 2) {
           reject(new Error('CSV 파일에 데이터가 없습니다. (헤더 행 포함)'));
           return;
        }

        const students: Student[] = [];
        // 첫 번째 줄은 헤더로 간주하고 스킵
        for (let i = 1; i < lines.length; i++) {
          // 따옴표를 고려한 CSV 분리 (간단 버전)
          const line = lines[i];
          const cols = line.match(/(".*?"|[^",\s]+)(?=\s*,|\s*$)/g)?.map(c => c.replace(/^"|"$/g, '').replace(/""/g, '"')) || [];
          
          if (cols.length === 0) continue;

          const num = parseInt(cols[0], 10);
          if (isNaN(num)) continue; // 번호가 숫자가 아니면 스킵

          const name = cols[1] || '';
          const genderRaw = cols[2] || '';
          const gender = (genderRaw.includes('남') || genderRaw === 'M') ? 'M' : (genderRaw.includes('여') || genderRaw === 'F') ? 'F' : '';
          const statusRaw = cols[3] || '';
          const isActive = !statusRaw.includes('전출');
          const note = cols[4] || '';

          students.push({
            num,
            name,
            gender,
            isActive,
            note
          });
        }
        resolve(students);
      } catch (err) {
        reject(err);
      }
    };
    reader.onerror = () => reject(new Error('파일 읽기 실패'));
    reader.readAsText(file);
  });
}
