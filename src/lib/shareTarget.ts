// src/lib/shareTarget.ts
// 다른 앱의 '공유'를 V4가 받는다 (Web Share Target - 안드로이드에 앱으로 설치했을 때만).
//
// 흐름: 휴대폰 공유 창에서 SP V4를 고르면 브라우저가 manifest.json의 share_target 대로
// './share-target'에 POST로 보낸다. 서비스 워커(public/sw.js)가 그것을 받아 글과 파일을
// 캐시 'sp4share-inbox'에 넣고 './index.html?share=<id>'로 넘긴다. 앱은 로그인한 뒤
// 여기 takeSharedPayload로 그것을 꺼내 **새 메모 쓰는 칸**에 채워 연다(저장은 사용자가 누를 때만).
//
// ⚠️ 캐시 이름과 열쇠 모양은 sw.js와 같아야 한다.

export const SHARE_CACHE = 'sp4share-inbox';

/** 받은 것 하나의 자리 (sw.js의 shareKey와 같은 모양) */
export const shareKey = (origin: string, id: string, part: string) => `${origin}/__sp4share/${id}/${part}`;

export interface SharedPayload {
  /** 새 메모 칸에 채울 글 (제목·글·주소를 합친 것) */
  text: string;
  /** 같이 받은 파일. 칸에서 '드라이브에 올려 첨부'를 눌러야 올라간다 */
  files: File[];
}

interface ShareMeta {
  title?: string;
  text?: string;
  url?: string;
  files?: { key: string; name: string; type: string }[];
}

/**
 * 제목·글·주소를 한 덩어리 글로. 앱마다 넣는 칸이 달라서(크롬은 주소를 text에도 넣고,
 * 어떤 앱은 제목만 text와 같다) 이미 들어 있는 것은 다시 적지 않는다.
 */
export function composeSharedText(title?: string, text?: string, url?: string): string {
  const t = (title || '').trim();
  const body = (text || '').trim();
  const u = (url || '').trim();
  const lines: string[] = [];
  if (t && !body.includes(t)) lines.push(t);
  if (body) lines.push(body);
  if (u && !body.includes(u) && !t.includes(u)) lines.push(u);
  return lines.join('\n');
}

/** 주소에 공유받은 표시가 있나 (?share=… 또는 GET으로 온 title·text·url) */
export function hasSharedParams(search: string): boolean {
  const p = new URLSearchParams(search);
  return p.has('share') || p.has('text') || p.has('url') || p.has('title');
}

/** 주소에서 공유 표시를 지운다 (새로고침해도 다시 열리지 않게). 다른 값(?as= 등)은 둔다. */
export function stripSharedParams(href: string): string {
  const u = new URL(href);
  for (const k of ['share', 'title', 'text', 'url']) u.searchParams.delete(k);
  return u.pathname + (u.searchParams.toString() ? `?${u.searchParams}` : '') + u.hash;
}

/**
 * 받은 것을 꺼내고 주소와 캐시에서 지운다. 받은 것이 없으면 null.
 * sw.js가 받다가 실패했으면('?share=error') 오류를 던진다.
 */
export async function takeSharedPayload(loc: Location = window.location): Promise<SharedPayload | null> {
  const params = new URLSearchParams(loc.search);
  if (!hasSharedParams(loc.search)) return null;
  history.replaceState(history.state, '', stripSharedParams(loc.href));

  const id = params.get('share');
  if (!id) {
    // GET으로 온 경우 (서비스 워커 없이 열린 옛 설치본 등)
    const text = composeSharedText(params.get('title') || '', params.get('text') || '', params.get('url') || '');
    return text ? { text, files: [] } : null;
  }
  if (id === 'error') throw new Error('공유받은 내용을 읽지 못했습니다.');
  if (!/^[a-z0-9]+$/i.test(id) || typeof caches === 'undefined') return null;

  const cache = await caches.open(SHARE_CACHE);
  const metaKey = shareKey(loc.origin, id, 'meta');
  const metaRes = await cache.match(metaKey);
  // 이미 꺼냈다(뒤로 가기로 다시 온 주소 등)
  if (!metaRes) return null;
  const meta = (await metaRes.json()) as ShareMeta;
  const files: File[] = [];
  for (const f of meta.files || []) {
    const res = await cache.match(f.key);
    if (!res) continue;
    const blob = await res.blob();
    files.push(new File([blob], f.name, { type: f.type || blob.type }));
    await cache.delete(f.key);
  }
  await cache.delete(metaKey);
  const text = composeSharedText(meta.title, meta.text, meta.url);
  if (!text && files.length === 0) return null;
  return { text, files };
}
