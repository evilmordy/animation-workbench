import type { LayoutBox } from './check/pixels';

/** 截帧时最多带回这么多个包围盒。文字框先留下。 */
export const LAYOUT_BOX_LIMIT = 40;

/** 先扫一截再过滤，避免舞台容器把名额占满。 */
export const LAYOUT_SCAN_LIMIT = 800;

export interface RawLayoutElement {
  id: string;
  layer: boolean;
  visibility: string;
  display: string;
  opacity: number;
  width: number;
  height: number;
  x: number;
  y: number;
  text: string;
  childElementCount: number;
  /** `data-awb-role`。满屏 svg/canvas 是 `canvas`。 */
  awbRole?: string;
  /**
   * 根 svg 的可视视口（舞台坐标）。
   * 根 svg 默认 overflow:hidden，子元素的 getBoundingClientRect 仍含视口外的线。
   * 先裁到视口，网格线才不会被当成出界。
   */
  svgClip?: { x: number; y: number; width: number; height: number };
}

export function intersectRect(
  box: { x: number; y: number; width: number; height: number },
  clip: { x: number; y: number; width: number; height: number },
): { x: number; y: number; width: number; height: number } | null {
  const x = Math.max(box.x, clip.x);
  const y = Math.max(box.y, clip.y);
  const right = Math.min(box.x + box.width, clip.x + clip.width);
  const bottom = Math.min(box.y + box.height, clip.y + clip.height);
  const width = right - x;
  const height = bottom - y;
  if (width < 2 || height < 2) return null;
  return { x, y, width, height };
}

function clipSvg(el: RawLayoutElement): RawLayoutElement | null {
  if (!el.svgClip) return el;
  const hit = intersectRect(el, el.svgClip);
  if (!hit) return null;
  return { ...el, x: hit.x, y: hit.y, width: hit.width, height: hit.height };
}

export function isContentBox(el: RawLayoutElement): boolean {
  if (el.id === 'canvas' || el.id === 'stage' || el.layer || el.awbRole === 'canvas') return false;
  if (el.visibility === 'hidden' || el.display === 'none') return false;
  if (!(el.opacity >= 0.05)) return false;
  if (el.width < 2 || el.height < 2) return false;
  return true;
}

export function toLayoutBox(el: RawLayoutElement, index: number): LayoutBox {
  const text = el.text.trim().slice(0, 80);
  const role = text && el.childElementCount === 0 ? 'text' : 'other';
  return {
    id: el.id || `${role}-${index}`,
    role,
    x: el.x,
    y: el.y,
    width: el.width,
    height: el.height,
    ...(text ? { text } : {}),
    ...(el.awbRole ? { awbRole: el.awbRole } : {}),
  };
}

export function pickLayoutBoxes(elements: RawLayoutElement[]): { boxes: LayoutBox[]; truncated: boolean } {
  const visible: RawLayoutElement[] = [];
  for (const el of elements) {
    const clipped = clipSvg(el);
    if (clipped && isContentBox(clipped)) visible.push(clipped);
  }
  const boxes = visible.map(toLayoutBox);
  const text = boxes.filter((box) => box.role === 'text');
  const other = boxes.filter((box) => box.role !== 'text');
  const ordered = [...text, ...other];
  return {
    boxes: ordered.slice(0, LAYOUT_BOX_LIMIT),
    truncated: ordered.length > LAYOUT_BOX_LIMIT,
  };
}
