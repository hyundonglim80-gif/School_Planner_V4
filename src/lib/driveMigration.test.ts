import { describe, it, expect } from 'vitest';
import { collectStorageFiles, applyNewUrls } from './driveMigration';

const S = (n: string) =>
  `https://firebasestorage.googleapis.com/v0/b/x.appspot.com/o/uploads%2Fuid%2F1700000000_${n}?alt=media&token=abc`;

// 문서 모양이 제각각이다. 기록은 entries, 메모는 attachments, 일정은 eventList 안의
// attachments를 쓰고, 옛 항목은 imageUrl을 쓴다. 하나라도 빠뜨리면 그 첨부는
// 영영 옛 주소를 가리킨 채 남는다.
describe('옮길 첨부 찾기', () => {
  it('기록 문서의 첨부를 찾는다', () => {
    const doc = { entries: [{ id: 'j1', attachments: [{ name: 'a.png', url: S('a.png') }] }] };
    const found = collectStorageFiles(doc);
    expect(found).toHaveLength(1);
    expect(found[0].path).toEqual(['entries', 0, 'attachments', 0, 'url']);
    expect(found[0].name).toBe('a.png');
  });

  it('일정 문서처럼 두 겹 안에 있어도 찾는다', () => {
    const doc = { eventList: [{ id: 'e1', attachments: [{ url: S('b.pdf') }] }] };
    expect(collectStorageFiles(doc)[0].path).toEqual(['eventList', 0, 'attachments', 0, 'url']);
  });

  it('옛 항목이 쓰던 imageUrl도 찾는다', () => {
    const doc = { entries: [{ id: 'j1', imageUrl: S('old.jpg') }] };
    expect(collectStorageFiles(doc)[0].path).toEqual(['entries', 0, 'imageUrl']);
  });

  it('드라이브 주소나 빈 값은 건드리지 않는다', () => {
    const doc = {
      entries: [
        { url: 'https://drive.google.com/uc?export=download&id=abc' },
        { url: '' },
        { note: '첨부 없음' },
      ],
    };
    expect(collectStorageFiles(doc)).toHaveLength(0);
  });

  it('타임스탬프를 떼어 파일 이름을 읽기 좋게 돌려준다', () => {
    expect(collectStorageFiles({ u: S('보고서.hwp') })[0].name).toBe('보고서.hwp');
  });
});

describe('새 주소로 갈아 끼우기', () => {
  it('찾은 자리만 바꾸고 나머지는 그대로 둔다', () => {
    const doc = {
      entries: [
        { id: 'j1', content: '내용', attachments: [{ name: 'a.png', url: S('a.png') }] },
        { id: 'j2', content: '그대로' },
      ],
    };
    const found = collectStorageFiles(doc);
    const out: any = applyNewUrls(doc, [
      { path: found[0].path, url: 'https://drive.google.com/uc?export=download&id=NEW', driveId: 'NEW' },
    ]);
    expect(out.entries[0].attachments[0].url).toContain('id=NEW');
    expect(out.entries[0].attachments[0].driveId).toBe('NEW');
    expect(out.entries[0].content).toBe('내용');
    expect(out.entries[1]).toEqual({ id: 'j2', content: '그대로' });
  });

  it('원본은 건드리지 않는다', () => {
    const doc = { entries: [{ attachments: [{ url: S('a.png') }] }] };
    const found = collectStorageFiles(doc);
    applyNewUrls(doc, [{ path: found[0].path, url: 'https://x/new', driveId: 'N' }]);
    expect(doc.entries[0].attachments[0].url).toContain('firebasestorage');
  });

  it('imageUrl 자리에는 driveId를 억지로 달지 않는다', () => {
    const doc = { entries: [{ imageUrl: S('old.jpg') }] };
    const found = collectStorageFiles(doc);
    const out: any = applyNewUrls(doc, [{ path: found[0].path, url: 'https://x/new', driveId: 'N' }]);
    expect(out.entries[0].imageUrl).toBe('https://x/new');
    expect(out.entries[0].driveId).toBeUndefined();
  });
});
