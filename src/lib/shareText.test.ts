import { describe, it, expect, vi, afterEach } from 'vitest';
import { canShare, shareText } from './shareText';

const setShare = (fn?: (data: ShareData) => Promise<void>) =>
  Object.defineProperty(navigator, 'share', { value: fn, configurable: true, writable: true });

afterEach(() => setShare(undefined));

describe('공유 창으로 보내기', () => {
  it('공유 창이 없는 브라우저에서는 단추를 보이지 않는다', () => {
    setShare(undefined);
    expect(canShare()).toBe(false);
    setShare(async () => {});
    expect(canShare()).toBe(true);
  });

  it('제목과 글을 넘긴다', async () => {
    const share = vi.fn(async () => {});
    setShare(share);
    const fallback = vi.fn();

    expect(await shareText('10/2(금) 알림장', '[10/2(금) 알림장]\n1. 색연필', fallback)).toBe('shared');
    expect(share).toHaveBeenCalledWith({ title: '10/2(금) 알림장', text: '[10/2(금) 알림장]\n1. 색연필' });
    expect(fallback).not.toHaveBeenCalled();
  });

  it('공유 창을 닫으면 아무것도 하지 않는다', async () => {
    setShare(async () => {
      throw new DOMException('닫음', 'AbortError');
    });
    const fallback = vi.fn();

    expect(await shareText('t', '글', fallback)).toBe('cancelled');
    expect(fallback).not.toHaveBeenCalled();
  });

  it('공유가 막히면 복사로 대신한다', async () => {
    setShare(async () => {
      throw new DOMException('막힘', 'NotAllowedError');
    });
    const fallback = vi.fn();

    expect(await shareText('t', '글', fallback)).toBe('fallback');
    expect(fallback).toHaveBeenCalledWith('글');
  });
});
