import { useEffect, useState } from 'react';

export interface VisibleRect {
  left: number;
  top: number;
  width: number;
  height: number;
}

function readRect(): VisibleRect {
  const vv = window.visualViewport;
  if (vv) {
    return { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height };
  }
  return { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight };
}

// index.html이 viewport를 width=1200으로 고정하고 있어서, 모바일에서는 레이아웃 뷰포트가
// 화면보다 훨씬 크다(예: 393px 폰 → 1200 x 2600 CSS px). position:fixed는 이 거대한 레이아웃
// 뷰포트를 기준으로 잡히므로, 팝업을 100vh 기준으로 만들면 확대했을 때 대부분이 화면 밖으로
// 밀려나고 스크롤할 것도 생기지 않는다.
// 이 훅은 "지금 실제로 보이는 영역"(visual viewport)을 돌려주며, 핀치 줌/패닝/소프트 키보드로
// 보이는 영역이 바뀔 때마다 갱신된다. 팝업을 이 영역에 맞추면 어떤 배율에서도 짤리지 않는다.
export function useVisualViewport(isActive: boolean): VisibleRect {
  const [rect, setRect] = useState<VisibleRect>(readRect);

  useEffect(() => {
    if (!isActive) return;

    let frame = 0;
    const update = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setRect(readRect()));
    };

    update();

    const vv = window.visualViewport;
    if (vv) {
      vv.addEventListener('resize', update);
      vv.addEventListener('scroll', update);
    }
    window.addEventListener('resize', update);
    window.addEventListener('orientationchange', update);

    return () => {
      cancelAnimationFrame(frame);
      if (vv) {
        vv.removeEventListener('resize', update);
        vv.removeEventListener('scroll', update);
      }
      window.removeEventListener('resize', update);
      window.removeEventListener('orientationchange', update);
    };
  }, [isActive]);

  return rect;
}
