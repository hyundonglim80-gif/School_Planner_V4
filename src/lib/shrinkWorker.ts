// src/lib/shrinkWorker.ts
//
// 사진을 줄이는 일을 딴 실로 내보낸다.
//
// ⚠️ 왜 워커까지 쓰는가.
//    사진을 다시 그려 내보내는 일(특히 WebP로 누르는 일)은 오래 걸린다.
//    4000×3000 한 장에 0.5~1초다. 그것을 화면을 그리는 실에서 하면 그동안
//    화면이 통째로 멈춘다. 스무 장이면 20초다. 실제로 '올리다가 멈춘다'는
//    말이 나왔는데, 멈춘 것이 아니라 그리는 실이 붙잡혀 있던 것이다.
//
//    OffscreenCanvas는 화면 없는 캔버스라 워커 안에서 쓸 수 있다. 무거운 일을
//    여기로 보내면 그동안에도 진행 막대가 움직인다.
//
// 이 파일은 워커로만 돈다. DOM을 건드리지 않는다.

export interface ShrinkRequest {
  id: number;
  blob: Blob;
  maxEdge: number;
  quality: number;
  mime: string;
}

export interface ShrinkReply {
  id: number;
  blob?: Blob;
  mime?: string;
  error?: string;
}

function fitWithin(width: number, height: number, maxEdge: number) {
  const longest = Math.max(width, height);
  if (longest <= maxEdge) return { width, height };
  const ratio = maxEdge / longest;
  return {
    width: Math.max(1, Math.round(width * ratio)),
    height: Math.max(1, Math.round(height * ratio)),
  };
}

self.onmessage = async (e: MessageEvent<ShrinkRequest>) => {
  const { id, blob, maxEdge, quality, mime } = e.data;
  let bitmap: ImageBitmap | null = null;
  try {
    // 휴대폰으로 옆으로 찍은 사진의 EXIF 회전을 그림에 실제로 반영한다
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
    const size = fitWithin(bitmap.width, bitmap.height, maxEdge);

    const canvas = new OffscreenCanvas(size.width, size.height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('캔버스를 만들지 못했습니다.');
    ctx.drawImage(bitmap, 0, 0, size.width, size.height);

    let out = await canvas.convertToBlob({ type: mime, quality });
    let outMime = mime;
    // WebP로 못 누르면 조용히 png를 주는 브라우저가 있다. JPEG로 물러난다.
    if (mime === 'image/webp' && out.type !== 'image/webp') {
      out = await canvas.convertToBlob({ type: 'image/jpeg', quality });
      outMime = 'image/jpeg';
    }

    const reply: ShrinkReply = { id, blob: out, mime: outMime };
    (self as unknown as Worker).postMessage(reply);
  } catch (err: any) {
    const reply: ShrinkReply = { id, error: String(err?.message || err) };
    (self as unknown as Worker).postMessage(reply);
  } finally {
    bitmap?.close();
  }
};
