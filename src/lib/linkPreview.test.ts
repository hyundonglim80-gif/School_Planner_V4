import { describe, it, expect } from 'vitest';
import { findUrls, previewOf, previewsOf } from './linkPreview';

describe('linkPreview', () => {
  it('글 안의 주소 (끝 문장 부호 뗌, 중복 한 번)', () => {
    expect(findUrls('보기 https://a.com/x. 그리고 (https://b.kr) https://a.com/x')).toEqual(['https://a.com/x', 'https://b.kr']);
  });
  it('유튜브', () => {
    const p = previewOf('https://www.youtube.com/watch?v=abc123&t=5');
    expect(p?.kind).toBe('youtube');
    expect(p?.thumb).toBe('https://img.youtube.com/vi/abc123/mqdefault.jpg');
    expect(previewOf('https://youtu.be/xyz')?.thumb).toContain('/vi/xyz/');
    expect(previewOf('https://youtube.com/shorts/s1')?.thumb).toContain('/vi/s1/');
  });
  it('구글 지도: 장소 이름·작은 지도', () => {
    const p = previewOf('https://www.google.com/maps/place/%EC%84%9C%EC%9A%B8%EC%8B%9C%EC%B2%AD/@37.5662952,126.9779451,17z');
    expect(p?.kind).toBe('map');
    expect(p?.title).toBe('서울시청');
    expect(p?.embed).toContain('output=embed');
    expect(previewOf('https://maps.google.com/?q=경복궁')?.embed).toContain(encodeURIComponent('경복궁'));
    expect(previewOf('https://maps.app.goo.gl/AbCd')?.title).toBe('구글 지도 링크');
  });
  it('네이버·카카오 지도', () => {
    expect(previewOf('https://map.naver.com/p/search/%EB%82%A8%EC%82%B0%ED%83%80%EC%9B%8C')?.title).toBe('남산타워');
    expect(previewOf('https://naver.me/abc')?.service).toBe('네이버 지도');
    expect(previewOf('https://map.kakao.com/?q=%EA%B5%AD%EB%A6%BD%EC%A4%91%EC%95%99%EB%B0%95%EB%AC%BC%EA%B4%80')?.title).toBe('국립중앙박물관');
  });
  it('그 밖의 사이트: 아이콘·도메인', () => {
    const p = previewOf('https://www.neis.go.kr/main.do');
    expect(p).toMatchObject({ kind: 'site', domain: 'neis.go.kr', title: 'neis.go.kr', sub: '/main.do' });
    expect(p?.icon).toContain('favicons');
  });
  it('세 개까지', () => {
    expect(previewsOf('https://a.com https://b.com https://c.com https://d.com')).toHaveLength(3);
    expect(previewsOf('주소 없음')).toEqual([]);
  });
});
