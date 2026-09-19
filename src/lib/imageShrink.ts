// src/lib/imageShrink.ts
//
// 사진을 올리기 전에 줄인다.
//
// 휴대폰으로 찍은 사진은 한 장에 3~5MB다. 한 반 스물다섯 장이면 100MB고,
// 그걸 매번 드라이브에서 내려받아 화면에 띄우면 느리다. 그런데 화면에서
// 가장 크게 쓰는 자리가 암기 판의 카드인데 폭이 264px다. 3배 화면이라 해도
// 800px이면 넉넉하다. 4000px짜리를 그대로 들고 다닐 까닭이 없다.
//
// 원본은 건드리지 않는다. 앱은 드라이브의 제 자리(School_Planner/Students_Poto)
// 에 줄인 사본을 올릴 뿐이고, 선생님이 갖고 계신 원본 파일과 원래 폴더는
// 그대로 남는다.

/** 긴 변을 이만큼까지만 (px) */
export const MAX_EDGE = 1000;
/** 다시 그릴 때의 품질 (0~1) */
export const QUALITY = 0.85;
/**
 * 무엇으로 다시 그릴 것인가.
 *
 * WebP를 쓴다. 같은 품질에서 JPEG보다 눈에 띄게 작고, 투명한 배경이 있는
 * PNG를 넣어도 배경이 검게 물들지 않는다(JPEG는 투명을 다루지 못한다).
 * 브라우저가 WebP로 못 그리면 JPEG로 물러난다.
 */
export const TARGET_MIME = 'image/webp';

/**
 * 이보다 작은 사진은 손대지 않는다.
 *
 * 이미 가벼운 것을 다시 그려 봐야 얻는 것이 없고, 그 사이 화면만 멈춘다.
 * 밖에서 미리 줄여 오신 사진(로컬에서 일괄 변환)이 여기 걸려 그냥 지나간다.
 */
export const SKIP_UNDER_BYTES = 500 * 1024;

export interface Size {
  width: number;
  height: number;
}

/**
 * 긴 변이 maxEdge를 넘지 않도록 줄인 크기. 이미 작으면 그대로 둔다.
 *
 * 작은 사진을 키우지 않는다. 키워 봐야 없던 화질이 생기지 않고 용량만 는다.
 */
export function fitWithin(width: number, height: number, maxEdge = MAX_EDGE): Size {
  if (!(width > 0) || !(height > 0)) return { width: 0, height: 0 };
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

/** 확장자를 바꾼 파일 이름 */
export function withExtension(fileName: string, mime: string): string {
  const ext = mime === 'image/webp' ? 'webp' : mime === 'image/png' ? 'png' : 'jpg';
  const at = fileName.lastIndexOf('.');
  const base = at < 0 ? fileName : fileName.slice(0, at);
  return `${base}.${ext}`;
}

export interface ShrinkResult {
  /** 올릴 파일. 줄이지 못했으면 원본 그대로다. */
  file: File;
  before: number;
  after: number;
  /** 실제로 줄였는가 */
  changed: boolean;
}

function toBlob(canvas: HTMLCanvasElement, mime: string, quality: number): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, mime, quality));
}

// ── 딴 실에 맡기기 ──────────────────────────────────────────────
//
// 다시 그려 내보내는 일은 오래 걸리고, 그리는 실에서 하면 그동안 화면이
// 멈춘다(lib/shrinkWorker.ts 주석 참고). 워커를 못 쓰는 자리에서는
// 예전처럼 여기서 한다.

let worker: Worker | null = null;
let workerBroken = false;
let nextJobId = 1;
const pending = new Map<number, (r: { blob?: Blob; mime?: string; error?: string }) => void>();

function getWorker(): Worker | null {
  if (workerBroken) return null;
  if (worker) return worker;
  try {
    if (typeof Worker === 'undefined' || typeof OffscreenCanvas === 'undefined') {
      workerBroken = true;
      return null;
    }
    worker = new Worker(new URL('./shrinkWorker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (e: MessageEvent<{ id: number; blob?: Blob; mime?: string; error?: string }>) => {
      const done = pending.get(e.data.id);
      if (done) {
        pending.delete(e.data.id);
        done(e.data);
      }
    };
    worker.onerror = () => {
      // 워커가 통째로 죽으면 기다리던 것을 모두 풀어 준다. 안 그러면 멈춘다.
      workerBroken = true;
      for (const done of pending.values()) done({ error: '워커가 멈췄습니다.' });
      pending.clear();
      worker = null;
    };
    return worker;
  } catch {
    workerBroken = true;
    return null;
  }
}

function shrinkInWorker(
  blob: Blob,
  maxEdge: number,
  quality: number,
  mime: string
): Promise<{ blob?: Blob; mime?: string; error?: string }> {
  const w = getWorker();
  if (!w) return Promise.resolve({ error: '워커를 쓸 수 없습니다.' });

  const id = nextJobId++;
  return new Promise((resolve) => {
    // 한 장이 끝내 안 돌아와도 나머지가 발이 묶이지 않게 한다
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: '사진 줄이기가 너무 오래 걸립니다.' });
    }, 20000);
    pending.set(id, (r) => {
      clearTimeout(timer);
      resolve(r);
    });
    w.postMessage({ id, blob, maxEdge, quality, mime });
  });
}

/**
 * 사진 한 장을 줄인다.
 *
 * 어느 단계에서든 실패하면 원본을 그대로 돌려준다. 줄이는 것은 덤이지
 * 못 하면 올리지 못할 일이 아니다.
 */
export async function shrinkPhoto(
  file: File,
  { maxEdge = MAX_EDGE, quality = QUALITY, mime = TARGET_MIME } = {}
): Promise<ShrinkResult> {
  const keep: ShrinkResult = { file, before: file.size, after: file.size, changed: false };
  if (!file.type.startsWith('image/')) return keep;
  // 이미 가벼우면 손대지 않는다 (밖에서 미리 줄여 오신 사진이 여기로 빠진다)
  if (file.size <= SKIP_UNDER_BYTES) return keep;

  // 먼저 딴 실에 맡겨 본다. 그래야 그동안에도 화면이 움직인다.
  const viaWorker = await shrinkInWorker(file, maxEdge, quality, mime);
  if (viaWorker.blob && viaWorker.blob.size < file.size) {
    const shrunk = new File([viaWorker.blob], withExtension(file.name, viaWorker.mime || mime), {
      type: viaWorker.mime || mime,
      lastModified: file.lastModified,
    });
    return { file: shrunk, before: file.size, after: shrunk.size, changed: true };
  }
  if (viaWorker.blob) return keep; // 줄여 봤자 더 크다

  let bitmap: ImageBitmap | null = null;
  try {
    // imageOrientation: 'from-image' 는 휴대폰으로 옆으로 찍은 사진의
    // EXIF 회전을 그림에 실제로 반영한다. 이게 없으면 얼굴이 누워서 올라간다.
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
    const size = fitWithin(bitmap.width, bitmap.height, maxEdge);
    if (size.width === 0) return keep;

    const canvas = document.createElement('canvas');
    canvas.width = size.width;
    canvas.height = size.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return keep;
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    // WebP를 못 그리는 브라우저면 toBlob이 png를 주거나 null을 준다. JPEG로 물러난다.
    let blob = await toBlob(canvas, mime, quality);
    let outMime = mime;
    if (!blob || (mime === 'image/webp' && blob.type !== 'image/webp')) {
      blob = await toBlob(canvas, 'image/jpeg', quality);
      outMime = 'image/jpeg';
    }
    if (!blob) return keep;

    // 줄인 것이 원본보다 크면 줄인 것이 아니다 (이미 잘 눌린 작은 사진)
    if (blob.size >= file.size) return keep;

    const shrunk = new File([blob], withExtension(file.name, outMime), {
      type: outMime,
      lastModified: file.lastModified,
    });
    return { file: shrunk, before: file.size, after: shrunk.size, changed: true };
  } catch (e) {
    console.warn('사진을 줄이지 못했습니다. 원본을 올립니다.', file.name, e);
    return keep;
  } finally {
    bitmap?.close();
  }
}

/** '3.2MB' 처럼 사람이 읽을 크기 */
export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes}B`;
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}
