// src/lib/attachments.ts
//
// 붙임 파일에서 그림과 그냥 파일을 가려낸다.
//
// 일정·수업·기록·메모가 모두 같은 모양으로 붙임을 들고 있는데(attachments와,
// 예전 자료에 남아 있는 imageUrl), 가려내는 규칙은 화면마다 따로 적혀 있었다.
// 세 군데에 같은 정규식이 복사돼 있으면 한 곳만 고치고 나머지를 잊는다.

export interface AttachmentLike {
  id?: string;
  name?: string;
  url?: string;
  type?: string;
  size?: number;
}

export interface ViewerImage {
  url: string;
  name: string;
}

const IMAGE_EXT = /\.(jpg|jpeg|png|gif|webp|bmp|heic|avif)(\?.*)?$/i;

/**
 * 붙임 하나가 그림인가.
 *
 * type에 무엇이 들어 있는지가 화면마다 다르다. 기록은 'image', 메모는
 * 'image/png' 같은 MIME을 적는다. 둘 다 받는다.
 *
 * type이 비어 있는 옛 자료도 있어 확장자를 본다. 이때 주소만 보면 안 된다.
 * 드라이브 주소에는 확장자가 없고(.../file/d/<id>/view) 파일 이름 쪽에만
 * 남아 있기 때문이다. 둘 다 본다.
 */
export function isImageAttachment(att: AttachmentLike | null | undefined): boolean {
  if (!att) return false;
  const type = att.type || '';
  if (type === 'image' || type.startsWith('image/')) return true;
  return IMAGE_EXT.test(att.url || '') || IMAGE_EXT.test(att.name || '');
}

/** 붙임을 들고 있는 것이면 무엇이든 (일정·수업·기록·메모) */
export interface HasAttachments {
  imageUrl?: string;
  attachments?: AttachmentLike[];
}

/**
 * 화면에 걸 그림들.
 *
 * imageUrl은 붙임 목록이 생기기 전에 쓰던 자리다. 아직 그 자료가 남아 있어
 * 함께 본다. 다만 같은 그림이 두 자리에 다 적힌 경우가 있어 주소로 거른다.
 */
export function collectImages(item: HasAttachments | null | undefined, srcOf: (a: AttachmentLike) => string): ViewerImage[] {
  if (!item) return [];
  const out: ViewerImage[] = [];
  const seen = new Set<string>();

  const push = (url: string, name: string) => {
    if (!url || seen.has(url)) return;
    seen.add(url);
    out.push({ url, name });
  };

  for (const att of item.attachments || []) {
    if (isImageAttachment(att)) push(srcOf(att), att.name || '첨부 이미지');
  }
  if (item.imageUrl) push(srcOf({ url: item.imageUrl }), '첨부 이미지');

  return out;
}

/** 그림이 아닌 붙임. 여는 단추로 보여 준다. */
export function collectFiles(item: HasAttachments | null | undefined): AttachmentLike[] {
  return (item?.attachments || []).filter((att) => !isImageAttachment(att));
}

/** 붙임이 하나라도 있는가 (칸을 낼지 말지 가린다) */
export function hasAnyAttachment(item: HasAttachments | null | undefined): boolean {
  if (!item) return false;
  return !!item.imageUrl || (item.attachments || []).length > 0;
}
