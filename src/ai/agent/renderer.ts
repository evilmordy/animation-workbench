import { platform } from '../../platform';

/** 代码场用哪套播放器。不进 storyboard schema，写在项目的 .awb/anim/renderer.json。 */
export type CodeRenderer = 'anime' | 'manim';

const listeners = new Set<() => void>();

export function subscribeRenderer(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function parseRenderer(text: string | null | undefined): CodeRenderer | null {
  if (!text) return null;
  const trimmed = text.trim();
  if (trimmed === 'anime' || trimmed === 'manim') return trimmed;
  try {
    const data = JSON.parse(trimmed) as { renderer?: unknown };
    if (data.renderer === 'anime' || data.renderer === 'manim') return data.renderer;
  } catch {
    return null;
  }
  return null;
}

export function rendererJson(renderer: CodeRenderer): string {
  return JSON.stringify({ renderer });
}

/**
 * 没写过选择的旧项目继续用 manim。
 * 只有整片都是 code，才切到 anime.js，避免把还在的 dsl 场送进另一套播放器。
 */
export function playbackRenderer(
  sidecar: CodeRenderer | null,
  scenes: readonly { kind: string }[],
): CodeRenderer {
  if (sidecar !== 'anime') return 'manim';
  if (!scenes.length || scenes.some((scene) => scene.kind !== 'code')) return 'manim';
  return 'anime';
}

/** 分镜文件优先。空项目用设置里的默认；已经有代码场又没选过的，保持 manim。 */
export function resolveAgentRenderer(opts: {
  sidecar: CodeRenderer | null;
  fallback: CodeRenderer;
  hasCodeScenes: boolean;
}): CodeRenderer {
  if (opts.sidecar) return opts.sidecar;
  if (opts.hasCodeScenes) return 'manim';
  return opts.fallback === 'manim' ? 'manim' : 'anime';
}

/** codeScenes 关掉时地址与原来一样。打开且这片走 anime.js 时，换成 anime.html。 */
export function previewPageUrl(base: string, playback: CodeRenderer, codeScenes: boolean): string {
  if (!codeScenes || playback !== 'anime') return base;
  const next = base.replace(/index\.html(?=$|[?#])/, 'anime.html');
  return next === base ? base : next;
}

export async function readRendererFile(dir: string): Promise<CodeRenderer | null> {
  const file = await platform.join(dir, '.awb', 'anim', 'renderer.json');
  if (!(await platform.exists(file))) return null;
  try {
    return parseRenderer(await platform.readText(file));
  } catch {
    return null;
  }
}

export async function writeRendererFile(dir: string, renderer: CodeRenderer): Promise<void> {
  const base = await platform.join(dir, '.awb', 'anim');
  await platform.mkdir(base);
  await platform.writeTextAtomic(await platform.join(base, 'renderer.json'), rendererJson(renderer));
  for (const fn of listeners) fn();
}
