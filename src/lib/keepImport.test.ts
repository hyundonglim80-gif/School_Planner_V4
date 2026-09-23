import { describe, it, expect } from 'vitest';
import {
  parseKeepNote,
  parseKeepFile,
  selectNotesToImport,
  toMemoDraft,
  keepIdOf,
  findExistingMemo,
  memoNeedsUpdate,
  mergeMemoLabels,
  type KeepImportOptions,
} from './keepImport';

const OPTS: KeepImportOptions = { includeArchived: false, keepLabels: true };

describe('Keep 메모 읽기', () => {
  it('제목과 본문을 한 덩이로 붙인다', () => {
    // V4 메모에는 제목 칸이 따로 없다. 제목을 버리면 무슨 메모인지 알 수 없다.
    const note = parseKeepNote({ title: '학부모 상담', textContent: '3시 김OO' });

    expect(note?.content).toBe('학부모 상담\n3시 김OO');
  });

  it('목록 메모는 체크 표시를 글자로 남긴다', () => {
    const note = parseKeepNote({
      title: '준비물',
      listContent: [
        { text: '색종이', isChecked: true },
        { text: '풀', isChecked: false },
      ],
    });

    expect(note?.content).toBe('준비물\n☑ 색종이\n☐ 풀');
  });

  it('라벨을 가져온다', () => {
    const note = parseKeepNote({ textContent: '메모', labels: [{ name: '업무' }, { name: '긴급' }] });

    expect(note?.labels).toEqual(['업무', '긴급']);
  });

  it('만든 때는 마이크로초라 밀리초로 바꾼다', () => {
    const ms = Date.UTC(2026, 2, 1);
    const note = parseKeepNote({ textContent: '메모', createdTimestampUsec: ms * 1000 });

    expect(note?.createdAt).toBe(ms);
  });

  it('밀리초로 적힌 것도 그대로 받아 준다', () => {
    const ms = Date.UTC(2026, 2, 1);
    const note = parseKeepNote({ textContent: '메모', createdTimestampUsec: ms });

    expect(note?.createdAt).toBe(ms);
  });

  it('보관·휴지통·고정 표시를 읽는다', () => {
    const note = parseKeepNote({ textContent: '메모', isArchived: true, isTrashed: true, isPinned: true });

    expect(note).toMatchObject({ archived: true, trashed: true, pinned: true });
  });

  it('내용도 파일도 없으면 메모로 치지 않는다', () => {
    expect(parseKeepNote({ title: '', textContent: '' })).toBeNull();
    expect(parseKeepNote(null)).toBeNull();
  });

  it('파일만 딸린 메모는 살린다', () => {
    // 무엇이 있었는지는 남겨 줘야 Takeout 폴더에서 찾을 수 있다
    const note = parseKeepNote({ attachments: [{ filePath: 'a.jpg' }] });

    expect(note?.attachmentNames).toEqual(['a.jpg']);
  });
});

describe('Keep 파일 읽기', () => {
  it('메모 하나가 든 파일을 읽는다', () => {
    const notes = parseKeepFile(JSON.stringify({ textContent: '하나' }), 'a.json');

    expect(notes).toHaveLength(1);
    expect(notes[0].sourceName).toBe('a.json');
  });

  it('배열로 묶인 파일도 받아 준다', () => {
    const notes = parseKeepFile(JSON.stringify([{ textContent: '하나' }, { textContent: '둘' }]));

    expect(notes.map((n) => n.content)).toEqual(['하나', '둘']);
  });

  it('JSON이 아니면 조용히 건너뛴다', () => {
    // Takeout 폴더에는 .html 같은 것도 섞여 있다. 하나 때문에 전체가 멈추면 안 된다.
    expect(parseKeepFile('<html>메모</html>')).toEqual([]);
  });
});

describe('가져올 것 고르기', () => {
  const notes = [
    { content: '보통', labels: [], createdAt: 0, archived: false, trashed: false, pinned: false, attachmentNames: [] },
    { content: '보관', labels: [], createdAt: 0, archived: true, trashed: false, pinned: false, attachmentNames: [] },
    { content: '휴지통', labels: [], createdAt: 0, archived: false, trashed: true, pinned: false, attachmentNames: [] },
  ];

  it('휴지통에 있던 것은 언제나 뺀다', () => {
    const picked = selectNotesToImport(notes, { includeArchived: true, keepLabels: true });

    expect(picked.map((n) => n.content)).toEqual(['보통', '보관']);
  });

  it('보관한 메모는 골랐을 때만 가져온다', () => {
    expect(selectNotesToImport(notes, OPTS).map((n) => n.content)).toEqual(['보통']);
  });
});

describe('메모로 바꾸기', () => {
  it('붙어 있던 파일 이름을 본문 끝에 남긴다', () => {
    const note = parseKeepNote({ textContent: '사진 메모', attachments: [{ filePath: 'a.jpg' }] })!;

    expect(toMemoDraft(note, OPTS).content).toBe('사진 메모\n📎 Keep에 붙어 있던 파일: a.jpg');
  });

  it('라벨을 안 가져오기로 하면 비운다', () => {
    const note = parseKeepNote({ textContent: '메모', labels: [{ name: '업무' }] })!;

    expect(toMemoDraft(note, { includeArchived: false, keepLabels: false }).labels).toEqual([]);
  });
});

describe('이미 있는 메모 알아보기', () => {
  const note = (over: any = {}) => ({
    content: '운동회 준비',
    labels: [] as string[],
    createdAt: 1772323200000,
    archived: false,
    trashed: false,
    pinned: false,
    attachmentNames: [] as string[],
    ...over,
  });

  it('만든 때로 열쇠를 만든다 (고쳐도 바뀌지 않는다)', () => {
    expect(keepIdOf(note())).toBe('keep_1772323200000');
    expect(keepIdOf(note({ content: '내용을 고쳤다' }))).toBe('keep_1772323200000');
  });

  it('만든 때를 모르면 내용으로 열쇠를 만든다', () => {
    const a = keepIdOf(note({ createdAt: 0 }));
    const b = keepIdOf(note({ createdAt: 0 }));
    const c = keepIdOf(note({ createdAt: 0, content: '다른 메모' }));
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it('열쇠로 먼저 찾고, 없으면 같은 내용으로 찾는다', () => {
    const n = note();
    const byKey = { firestoreId: 'a', content: '아무거나', keepId: 'keep_1772323200000' };
    expect(findExistingMemo(n, [byKey], '운동회 준비')?.firestoreId).toBe('a');

    const byBody = { firestoreId: 'b', content: '운동회 준비' };
    expect(findExistingMemo(n, [byBody], '운동회 준비')?.firestoreId).toBe('b');
    expect(findExistingMemo(n, [], '운동회 준비')).toBeUndefined();
  });

  it('글·라벨·붙은 파일 중 하나라도 달라지면 고쳐 쓴다', () => {
    const memo = { firestoreId: 'a', content: '운동회 준비', labels: ['학교행사'], attachments: [{ name: '사진.jpg' }] };
    const same = { content: '운동회 준비', labels: ['학교행사'], attachmentNames: ['사진.jpg'] };

    expect(memoNeedsUpdate(same, memo)).toBe(false);
    expect(memoNeedsUpdate({ ...same, content: '고침' }, memo)).toBe(true);
    expect(memoNeedsUpdate({ ...same, labels: [] }, memo)).toBe(true);
    expect(memoNeedsUpdate({ ...same, attachmentNames: [] }, memo)).toBe(true);
  });

  it('라벨 차례가 달라도 같은 것으로 본다', () => {
    const memo = { firestoreId: 'a', content: 'x', labels: ['가', '나'], attachments: [] };
    expect(memoNeedsUpdate({ content: 'x', labels: ['나', '가'], attachmentNames: [] }, memo)).toBe(false);
  });
});

describe('메모 라벨 목록에 더하기', () => {
  it('없던 이름만 더한다', () => {
    expect(mergeMemoLabels(['업무'], ['업무', '학교행사'])).toEqual(['업무', '학교행사']);
  });

  it('저장된 모양을 따른다 ({id,name,color}로 되어 있으면 그 모양으로)', () => {
    const merged = mergeMemoLabels([{ id: 'm1', name: '업무', color: 'blue' }], ['학교행사']);

    expect(merged).toHaveLength(2);
    expect(merged[1]).toMatchObject({ name: '학교행사' });
    expect(typeof merged[1]).toBe('object');
  });

  it('빈 이름은 넣지 않는다', () => {
    expect(mergeMemoLabels([], ['  ', ''])).toEqual([]);
  });
});
