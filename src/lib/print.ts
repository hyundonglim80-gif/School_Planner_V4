// src/lib/print.ts
//
// 인쇄 (ROADMAP 12). 화면의 한 부분만 A4로 찍는다.
//
//   고른 요소를 복제해 body 바로 아래 #sp4-print-root에 넣고, 인쇄할 때는 그것만 보이게 한다(index.css의 @media print).
//   팝업·오른쪽 칸 안의 표는 스크롤 상자·고정 위치 안에 있어 그대로 찍으면 잘린다 - 복제해서 펼친다.
//   용지 방향은 그때마다 @page를 넣었다가 뺀다. 인쇄 창이 닫히면(afterprint) 치운다.
//
//   data-print-hide가 붙은 것은 빼고 찍는다(단추·거르개 등). 입력 칸은 적힌 값을 글로 바꿔 찍는다.

export interface PrintOptions {
  /** 맨 위 제목 */
  title?: string;
  /** 제목 아래 작은 글 (만든 날 등) */
  subtitle?: string;
  landscape?: boolean;
  /** 여백 (mm) */
  marginMm?: number;
}

export const PRINT_ROOT_ID = 'sp4-print-root';

/** 복제본의 입력 칸을 적힌 값 글로 바꾼다 (복제하면 select·input의 지금 값이 따라오지 않는다) */
function freezeInputs(source: HTMLElement, clone: HTMLElement) {
  const srcFields = source.querySelectorAll('input, select, textarea');
  const cloneFields = clone.querySelectorAll('input, select, textarea');
  srcFields.forEach((src, i) => {
    const target = cloneFields[i] as HTMLElement | undefined;
    if (!target) return;
    let text = '';
    if (src instanceof HTMLSelectElement) text = src.selectedOptions[0]?.textContent || '';
    else if (src instanceof HTMLInputElement) {
      if (src.type === 'checkbox' || src.type === 'radio') text = src.checked ? '☑' : '☐';
      else text = src.value;
    } else if (src instanceof HTMLTextAreaElement) text = src.value;
    const span = document.createElement('span');
    span.textContent = text;
    span.className = 'sp4-print-field';
    target.replaceWith(span);
  });
}

/** 지금 찍을 준비가 된 것을 치운다 */
export function clearPrintRoot() {
  document.getElementById(PRINT_ROOT_ID)?.remove();
  document.getElementById(`${PRINT_ROOT_ID}-page`)?.remove();
  document.body.removeAttribute('data-printing');
}

/** 요소 하나를 찍을 준비를 한다 (복제·@page). 인쇄 창은 printNode가 연다 - 시험에서는 이것만 부른다 */
export function preparePrint(node: HTMLElement, opts: PrintOptions = {}): HTMLElement {
  clearPrintRoot();
  const root = document.createElement('div');
  root.id = PRINT_ROOT_ID;
  if (opts.title) {
    const h = document.createElement('h1');
    h.className = 'sp4-print-title';
    h.textContent = opts.title;
    root.appendChild(h);
  }
  if (opts.subtitle) {
    const p = document.createElement('p');
    p.className = 'sp4-print-subtitle';
    p.textContent = opts.subtitle;
    root.appendChild(p);
  }
  const clone = node.cloneNode(true) as HTMLElement;
  freezeInputs(node, clone);
  clone.querySelectorAll('[data-print-hide]').forEach((el) => el.remove());
  root.appendChild(clone);
  document.body.appendChild(root);

  const page = document.createElement('style');
  page.id = `${PRINT_ROOT_ID}-page`;
  page.textContent = `@page { size: A4 ${opts.landscape ? 'landscape' : 'portrait'}; margin: ${opts.marginMm ?? 8}mm; }`;
  document.head.appendChild(page);
  document.body.setAttribute('data-printing', '');
  return root;
}

/** 요소 하나를 A4로 인쇄한다 (인쇄 창에서 'PDF로 저장'도 된다) */
export function printNode(node: HTMLElement, opts: PrintOptions = {}) {
  preparePrint(node, opts);
  const done = () => {
    window.removeEventListener('afterprint', done);
    clearPrintRoot();
  };
  window.addEventListener('afterprint', done);
  window.print();
}
