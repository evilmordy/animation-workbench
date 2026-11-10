/**
 * 在预览页里量舞台。字段和 Playwright 截帧里的包围盒扫描一致：
 * 相对 #stage、根 svg 先裁视口、最多 800 个节点。
 * foreignObject 栅格化是 spike：成功才带回 PNG，失败只带回原因。
 */

export interface StageElement {
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
  awbRole: string;
  svgClip?: { x: number; y: number; width: number; height: number };
}

export interface RasterSpike {
  ms: number;
  dataUrl?: string;
  error?: string;
}

const SCAN_LIMIT = 800;

export function collectStageElements(stage: HTMLElement, scanLimit = SCAN_LIMIT): StageElement[] {
  const origin = stage.getBoundingClientRect();
  const found: StageElement[] = [];
  const svgClipOf = (el: Element) => {
    const svg = (el as SVGElement).ownerSVGElement;
    if (!svg) return undefined;
    const overflow = getComputedStyle(svg);
    if (overflow.overflowX === 'visible' && overflow.overflowY === 'visible') return undefined;
    const view = svg.getBoundingClientRect();
    return {
      x: view.x - origin.x,
      y: view.y - origin.y,
      width: view.width,
      height: view.height,
    };
  };
  for (const el of stage.querySelectorAll('*')) {
    if (found.length >= scanLimit) break;
    const cs = getComputedStyle(el);
    const rect = el.getBoundingClientRect();
    const svgClip = svgClipOf(el);
    found.push({
      id: el.id,
      layer: el.id === 'canvas' || el.classList.contains('awb-layer'),
      visibility: cs.visibility,
      display: cs.display,
      opacity: Number(cs.opacity),
      width: rect.width,
      height: rect.height,
      x: rect.x - origin.x,
      y: rect.y - origin.y,
      text: (el.textContent ?? '').trim().slice(0, 80),
      childElementCount: el.childElementCount,
      awbRole: el.getAttribute('data-awb-role') || '',
      ...(svgClip ? { svgClip } : {}),
    });
  }
  return found;
}

function paintCanvases(
  ctx: CanvasRenderingContext2D,
  stage: HTMLElement,
  origin: DOMRect,
): string | undefined {
  for (const node of stage.querySelectorAll('canvas')) {
    if (!(node instanceof HTMLCanvasElement)) continue;
    const box = node.getBoundingClientRect();
    try {
      ctx.drawImage(node, box.x - origin.x, box.y - origin.y, box.width, box.height);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return message || 'canvas 像素读不出来';
    }
  }
  return undefined;
}

function readableError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (/tainted|cross-origin|SecurityError/i.test(message)) {
    return 'foreignObject 画进 canvas 后被浏览器当成跨域，读不出像素。';
  }
  return message || 'foreignObject 截帧失败';
}

/**
 * 把舞台克隆进 SVG foreignObject，再画到 canvas。
 * blob: 图在 Chromium 里会污染 canvas，读不回像素；data: 图可以读回。
 * three / canvas 的位图 clone 不走，画完 DOM 后再 drawImage 叠上去。失败只返回原因。
 */
export async function spikeRaster(stage: HTMLElement): Promise<RasterSpike> {
  const started = performance.now();
  const fail = (error: string): RasterSpike => ({ ms: performance.now() - started, error });
  const rect = stage.getBoundingClientRect();
  const width = Math.max(1, Math.round(rect.width));
  const height = Math.max(1, Math.round(rect.height));
  try {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(width));
    svg.setAttribute('height', String(height));
    const foreign = document.createElementNS('http://www.w3.org/2000/svg', 'foreignObject');
    foreign.setAttribute('width', '100%');
    foreign.setAttribute('height', '100%');
    const style = document.createElement('style');
    style.textContent = [...document.querySelectorAll('style')]
      .map((node) => node.textContent ?? '')
      .join('\n');
    const clone = stage.cloneNode(true);
    if (clone instanceof HTMLElement) clone.setAttribute('xmlns', 'http://www.w3.org/1999/xhtml');
    foreign.append(style, clone);
    svg.appendChild(foreign);
    const xml = new XMLSerializer().serializeToString(svg);
    const url = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(xml)}`;
    const img = new Image();
    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('foreignObject 解码超时')), 4000);
      img.onload = () => {
        clearTimeout(timer);
        resolve();
      };
      img.onerror = () => {
        clearTimeout(timer);
        reject(new Error('foreignObject 没有解码成图片'));
      };
      img.src = url;
    });
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return fail('没有 2d canvas');
    ctx.drawImage(img, 0, 0);
    const canvasError = paintCanvases(ctx, stage, rect);
    if (canvasError) return fail(readableError(canvasError));
    ctx.getImageData(0, 0, 1, 1);
    const dataUrl = canvas.toDataURL('image/png');
    if (!dataUrl.startsWith('data:image/png')) return fail('toDataURL 没有返回 PNG');
    return { ms: performance.now() - started, dataUrl };
  } catch (error) {
    return fail(readableError(error));
  }
}
