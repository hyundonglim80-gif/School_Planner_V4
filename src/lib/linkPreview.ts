// src/lib/linkPreview.ts
//
// 글 안의 사이트 주소·지도 링크 미리보기 (2026-10-07 사용자 요청). 순수 함수만 - 화면은 components/LinkPreviewCards.
// V4는 서버가 없어 다른 사이트의 제목·그림(og:)을 읽을 수 없다(브라우저가 막는다). 그래서 주소만으로 알 수 있는 것을 보인다:
//   - 유튜브: 영상 그림(img.youtube.com - 그림은 막지 않는다)
//   - 지도(구글·네이버·카카오): 장소 이름(주소에 있으면)과, 구글 지도 좌표·검색어면 작은 지도(maps.google.com output=embed)
//   - 그 밖의 사이트: 사이트 아이콘·도메인·주소 길
// 글은 바꾸지 않는다 - 카드는 보이기만.

export type PreviewKind = 'youtube' | 'map' | 'site';

export interface LinkPreview {
  url: string;
  kind: PreviewKind;
  /** 'www.'를 뗀 도메인 */
  domain: string;
  /** 카드 제목 (장소 이름·도메인) */
  title: string;
  /** 카드 둘째 줄 (주소 길) */
  sub: string;
  /** 유튜브 그림 */
  thumb?: string;
  /** 작은 지도 (구글 지도 embed) */
  embed?: string;
  /** 사이트 아이콘 */
  icon?: string;
  /** 지도 서비스 이름 */
  service?: string;
}

/** 미리보기는 이만큼까지 (글에 링크가 많으면 앞의 것만) */
export const PREVIEW_MAX = 3;

const URL_RE = /https?:\/\/[^\s<>"')\]]+/g;

/** 글 안의 주소 (끝의 문장 부호는 뗀다, 같은 주소는 한 번) */
export function findUrls(text: string): string[] {
  const out: string[] = [];
  for (const m of String(text || '').matchAll(URL_RE)) {
    const u = m[0].replace(/[.,;:!?…。、]+$/, '');
    if (!out.includes(u)) out.push(u);
  }
  return out;
}

const decode = (s: string) => {
  try {
    return decodeURIComponent(s.replace(/\+/g, ' '));
  } catch {
    return s;
  }
};

function youtubeId(u: URL): string | null {
  const host = u.hostname.replace(/^www\.|^m\./, '');
  if (host === 'youtu.be') return u.pathname.slice(1).split('/')[0] || null;
  if (host === 'youtube.com' || host === 'music.youtube.com') {
    if (u.pathname === '/watch') return u.searchParams.get('v');
    const m = /^\/(shorts|embed|live)\/([^/?]+)/.exec(u.pathname);
    if (m) return m[2];
  }
  return null;
}

/** 구글 지도 주소에서 장소 이름·좌표 */
function googleMap(u: URL): { place: string; query: string } | null {
  const host = u.hostname.replace(/^www\./, '');
  const isMaps = (host === 'google.com' || host.startsWith('google.')) && u.pathname.startsWith('/maps');
  if (!isMaps && host !== 'maps.google.com') return null;
  const q = u.searchParams.get('q') || u.searchParams.get('query') || '';
  const placeM = /\/maps\/place\/([^/]+)/.exec(u.pathname);
  const atM = /@(-?\d+\.\d+),(-?\d+\.\d+)/.exec(u.pathname);
  const place = placeM ? decode(placeM[1]) : q ? decode(q) : '';
  const query = q ? q : atM ? `${atM[1]},${atM[2]}` : placeM ? placeM[1] : '';
  return { place, query };
}

/** 주소 하나 → 미리보기. 주소로 읽을 수 없으면 null */
export function previewOf(url: string): LinkPreview | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;
  const domain = u.hostname.replace(/^www\./, '');
  const path = decode(u.pathname + (u.search ? u.search : '')).replace(/\/$/, '');
  const base = { url, domain, sub: path.length > 60 ? path.slice(0, 57) + '…' : path };

  const yt = youtubeId(u);
  if (yt) return { ...base, kind: 'youtube', title: 'YouTube 영상', thumb: `https://img.youtube.com/vi/${encodeURIComponent(yt)}/mqdefault.jpg`, service: 'YouTube' };

  const g = googleMap(u);
  if (g) {
    return {
      ...base,
      kind: 'map',
      service: '구글 지도',
      title: g.place || '구글 지도',
      embed: g.query ? `https://maps.google.com/maps?q=${encodeURIComponent(decode(g.query))}&z=15&output=embed` : undefined,
    };
  }
  // 짧은 지도 주소 (펼쳐 볼 수 없다 - 서비스 이름만)
  if (/^(maps\.app\.goo\.gl|goo\.gl)$/.test(domain) && (domain !== 'goo.gl' || u.pathname.startsWith('/maps'))) {
    return { ...base, kind: 'map', service: '구글 지도', title: '구글 지도 링크' };
  }
  if (domain === 'map.naver.com' || domain === 'm.map.naver.com' || domain === 'naver.me') {
    const placeM = /\/(?:search|place)\/([^/?]+)/.exec(u.pathname);
    return { ...base, kind: 'map', service: '네이버 지도', title: placeM && !/^\d+$/.test(placeM[1]) ? decode(placeM[1]) : '네이버 지도 링크' };
  }
  if (domain === 'map.kakao.com' || domain === 'place.map.kakao.com' || domain === 'kko.to') {
    const q = u.searchParams.get('q') || u.searchParams.get('itemId') || '';
    return { ...base, kind: 'map', service: '카카오맵', title: q && !/^\d+$/.test(q) ? decode(q) : '카카오맵 링크' };
  }
  return { ...base, kind: 'site', title: domain, icon: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(u.hostname)}&sz=64` };
}

/** 글 → 미리보기 (앞의 PREVIEW_MAX개) */
export function previewsOf(text: string): LinkPreview[] {
  return findUrls(text)
    .map(previewOf)
    .filter((p): p is LinkPreview => !!p)
    .slice(0, PREVIEW_MAX);
}
