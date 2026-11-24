export interface PickElement {
  tag: string;
  text: string;
  bbox: [number, number, number, number];
  awb_n: number;
}

export interface PickResult {
  point: { x: number; y: number } | null;
  element: PickElement | null;
}

function stagePoint(
  canvas: HTMLElement,
  x: number,
  y: number,
): { x: number; y: number; scaleX: number; scaleY: number; left: number; top: number } | null {
  const rect = canvas.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  if (x < rect.left || y < rect.top || x > rect.right || y > rect.bottom) return null;
  const stageW = Number(canvas.dataset.stageWidth) || rect.width;
  const stageH = Number(canvas.dataset.stageHeight) || rect.height;
  return {
    x: ((x - rect.left) / rect.width) * stageW,
    y: ((y - rect.top) / rect.height) * stageH,
    scaleX: rect.width / stageW,
    scaleY: rect.height / stageH,
    left: rect.left,
    top: rect.top,
  };
}

function awbNode(node: Element | null): Element | null {
  let current: Element | null = node;
  while (current) {
    if (current.getAttribute('data-awb-n')) return current;
    current = current.parentElement;
  }
  return null;
}

/** 把预览视口里的点击换成舞台坐标，并找带 data-awb-n 的元素。 */
export function hitAt(stage: HTMLElement, x: number, y: number): PickResult {
  const canvas = stage.querySelector('#canvas');
  if (!(canvas instanceof HTMLElement)) return { point: null, element: null };
  const mapped = stagePoint(canvas, x, y);
  if (!mapped) return { point: null, element: null };
  const hit = awbNode(stage.ownerDocument.elementFromPoint(x, y));
  if (!hit) return { point: { x: mapped.x, y: mapped.y }, element: null };
  const box = hit.getBoundingClientRect();
  const n = Number(hit.getAttribute('data-awb-n'));
  return {
    point: { x: mapped.x, y: mapped.y },
    element: {
      tag: hit.tagName.toLowerCase(),
      text: (hit.textContent ?? '').trim().slice(0, 80),
      bbox: [
        (box.left - mapped.left) / mapped.scaleX,
        (box.top - mapped.top) / mapped.scaleY,
        box.width / mapped.scaleX,
        box.height / mapped.scaleY,
      ],
      awb_n: Number.isFinite(n) ? n : 0,
    },
  };
}
