import type { LlmMessage } from '../../platform/types';
import { platform } from '../../platform';
import type { Storyboard } from '../../shared/schema';
import type { Transport } from '../client';
import type { CaptureBatch, CaptureRequest, FrameAt, FrameSource } from './capture';
import { isFramePath } from './parse';
import { checkLayout, compareResidual, pngDataUrl, type LayoutBox, type Raster } from './pixels';
import { runToolLoop, type ToolLoopResult, type ToolOutput, type ToolSpec } from './tools';

export const VISION_KEY_NOTE = '看图模型的 API key 由用户在设置里另行提供，这里不读取、不保存密钥。';

/** 与 settings.runtime.agentTools 的默认值一致。关着时不注册闭环工具。 */
export function agentToolsEnabled(agentTools: boolean | undefined): boolean {
  return agentTools === true;
}

const SCENE_ID = /^[A-Za-z_][A-Za-z0-9_-]{0,63}$/;

export interface StoredFrame {
  name: string;
  sceneId: string;
  source: FrameSource;
  t: number;
  at: FrameAt;
  raster: Raster;
  boxes: LayoutBox[];
  consoleErrors: string[];
}

export interface VisionSession {
  frames: Map<string, StoredFrame>;
  consoleErrors: string[];
}

export interface FrameStore {
  write(name: string, png: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array | null>;
}

export interface VisionContext {
  getStoryboard(): Storyboard | null;
  capture(request: CaptureRequest): Promise<CaptureBatch>;
  store: FrameStore;
  session: VisionSession;
}

function assertFramePath(name: string) {
  if (!isFramePath(name)) throw new Error(`拒绝写入：${name}`);
}

export function memoryFrameStore(): FrameStore & { files: Map<string, Uint8Array> } {
  const files = new Map<string, Uint8Array>();
  return {
    files,
    async write(name, png) {
      assertFramePath(name);
      files.set(name, png);
    },
    async read(name) {
      if (!isFramePath(name)) return null;
      return files.get(name) ?? null;
    },
  };
}

/** 写到 `<project>/.awb/anim/frames/`。不改 PROJECT_DIRS，也不写 storyboard.json。 */
export function diskFrameStore(projectDir: string): FrameStore {
  return {
    async write(name, png) {
      assertFramePath(name);
      const base = await platform.join(projectDir, '.awb', 'anim');
      await platform.mkdir(base);
      await platform.mkdir(await platform.join(base, 'frames'));
      await platform.writeBinary(await platform.join(base, ...name.split('/')), png);
    },
    async read(name) {
      if (!isFramePath(name)) return null;
      const file = await platform.join(projectDir, '.awb', 'anim', ...name.split('/'));
      if (!(await platform.exists(file))) return null;
      return platform.readBinary(file);
    },
  };
}

export function unavailableCapture(reason?: string): VisionContext['capture'] {
  const message =
    reason ?? '没有截帧后端。应用内 webview 截帧尚未接入；Playwright 预览不可用时已降级，没有图片。';
  return async () => {
    throw new Error(message);
  };
}

export function visionContext(opts: {
  getStoryboard: () => Storyboard | null;
  capture?: VisionContext['capture'];
  store?: FrameStore;
}): VisionContext {
  return {
    getStoryboard: opts.getStoryboard,
    capture: opts.capture ?? unavailableCapture(),
    store: opts.store ?? memoryFrameStore(),
    session: { frames: new Map(), consoleErrors: [] },
  };
}

function objectArgs(args: unknown): Record<string, unknown> {
  if (!args || typeof args !== 'object' || Array.isArray(args)) return {};
  return args as Record<string, unknown>;
}

export function parseAt(value: unknown): FrameAt {
  if (value === 'start' || value === 'mid' || value === 'end') return value;
  if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 600) return value;
  if (typeof value === 'string' && value.trim()) {
    const n = Number(value);
    if (Number.isFinite(n) && n >= 0 && n <= 600) return n;
  }
  return 'start';
}

function parseIds(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const ids: string[] = [];
  for (const item of value) {
    if (typeof item === 'string' && SCENE_ID.test(item) && !ids.includes(item)) ids.push(item);
  }
  return ids.length ? ids : undefined;
}

export function atTag(at: FrameAt): string {
  if (at === 'start' || at === 'mid' || at === 'end') return at;
  return `t${Math.round(at * 100)}`;
}

export function frameName(sceneId: string, source: FrameSource, at: FrameAt): string {
  const name = `frames/${sceneId}-${source}-${atTag(at)}.png`;
  if (!isFramePath(name)) throw new Error(`拒绝写入：${name}`);
  return name;
}

/** 缺省只截 kind:code。调用方点名的场次可以是 dsl。 */
export function planCapture(
  storyboard: Storyboard,
  args: { sceneIds?: string[]; at?: FrameAt; isolated?: boolean },
): { ok: true; request: CaptureRequest } | { ok: false; message: string } {
  let scenes = storyboard.scenes;
  if (args.sceneIds?.length) {
    const picked = [];
    for (const id of args.sceneIds) {
      const scene = storyboard.scenes.find((item) => item.id === id);
      if (!scene) return { ok: false, message: `没有场 ${id}` };
      picked.push(scene);
    }
    scenes = picked;
  } else {
    scenes = storyboard.scenes.filter((scene) => scene.kind === 'code');
    if (!scenes.length) {
      return {
        ok: false,
        message:
          '当前分镜没有 kind:code 场。render_frames 优先截代码场。传入 sceneIds 可以指定场次，或先写出 code。',
      };
    }
  }
  const at = args.at ?? 'start';
  const isolated = args.isolated !== false;
  return {
    ok: true,
    request: {
      storyboard,
      shots: scenes.map((scene) => ({ sceneId: scene.id, at, isolated })),
    },
  };
}

function remember(ctx: VisionContext, frame: StoredFrame) {
  ctx.session.frames.set(frame.name, frame);
  for (const error of frame.consoleErrors) {
    if (ctx.session.consoleErrors.length >= 20 || ctx.session.consoleErrors.includes(error)) continue;
    ctx.session.consoleErrors.push(error.slice(0, 500));
  }
}

function findFrame(
  ctx: VisionContext,
  name: string | undefined,
  source?: FrameSource,
): StoredFrame | undefined {
  if (name) return ctx.session.frames.get(name);
  const frames = [...ctx.session.frames.values()];
  if (!source) return frames.at(-1);
  return frames.reverse().find((frame) => frame.source === source);
}

export function visionTools(ctx: VisionContext): ToolSpec[] {
  return [
    {
      definition: {
        type: 'function',
        function: {
          name: 'render_frames',
          description:
            '对当前分镜截帧，写入项目 .awb/anim/frames/。优先 kind:code。默认截到该场开头，并另渲染单场，方便比对上一场残留。失败时降级成文字，不阻塞改代码。',
          parameters: {
            type: 'object',
            properties: {
              sceneIds: { type: 'array', items: { type: 'string' }, description: '缺省时只截 kind:code' },
              at: {
                description: 'start、mid、end，或相对场起点的秒。默认 start。',
              },
              isolated: { type: 'boolean', description: '是否同时渲染单场。默认 true。' },
            },
          },
        },
      },
      async run(args) {
        return renderFrames(ctx, args);
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'view_image',
          description: `把已截帧的 PNG 放进下一条图像消息，供视觉模型看。${VISION_KEY_NOTE}`,
          parameters: {
            type: 'object',
            properties: { frame: { type: 'string', description: 'render_frames 返回的 frames/*.png' } },
            required: ['frame'],
          },
        },
      },
      async run(args) {
        return viewImage(ctx, args);
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'check_layout',
          description: '检查截帧的出界和字叠，返回文字摘要。有 DOM 框用框，没有框时看边缘像素。',
          parameters: {
            type: 'object',
            properties: { frame: { type: 'string', description: '缺省时检查最近一张整片帧' } },
          },
        },
      },
      run(args) {
        return checkLayoutTool(ctx, args);
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'check_residual',
          description:
            '对比「整片 seek 到该场的帧」和「只渲染这一场的帧」。多出来的像素视为上一场残留。不要用 opacity 判断可见性。',
          parameters: {
            type: 'object',
            properties: { sceneId: { type: 'string', description: '缺省时检查最近一对帧' } },
          },
        },
      },
      run(args) {
        return checkResidualTool(ctx, args);
      },
    },
    {
      definition: {
        type: 'function',
        function: {
          name: 'console_errors',
          description: '返回最近一次预览或截帧收集到的控制台错误和构建错误。',
          parameters: { type: 'object', properties: {} },
        },
      },
      run() {
        return consoleErrors(ctx);
      },
    },
  ];
}

async function renderFrames(ctx: VisionContext, args: unknown): Promise<string> {
  const storyboard = ctx.getStoryboard();
  if (!storyboard) return '没有打开的分镜，无法截帧。';
  const raw = objectArgs(args);
  const planned = planCapture(storyboard, {
    sceneIds: parseIds(raw.sceneIds),
    at: parseAt(raw.at),
    isolated: raw.isolated !== false,
  });
  if (!planned.ok) return planned.message;
  let batch: CaptureBatch;
  try {
    batch = await ctx.capture(planned.request);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return `截帧失败，已降级：${message}\n没有写出图片。可以继续根据代码改场景，不必等看图模型。`;
  }
  if (!batch.frames.length) return `截帧后端 ${batch.backend} 没有返回画面。没有写出图片。`;
  const lines: string[] = [];
  for (const frame of batch.frames) {
    const at = planned.request.shots.find((shot) => shot.sceneId === frame.sceneId)?.at ?? 'start';
    let name: string;
    try {
      name = frameName(frame.sceneId, frame.source, at);
      await ctx.store.write(name, frame.png);
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e);
      const wrote = lines.length ? `已写出 ${lines.length} 张后中断。` : '没有写出图片。';
      return `截帧失败，已降级：${message}\n${wrote}`;
    }
    remember(ctx, {
      name,
      sceneId: frame.sceneId,
      source: frame.source,
      t: frame.t,
      at,
      raster: frame.raster,
      boxes: frame.boxes,
      consoleErrors: frame.consoleErrors,
    });
    const where = frame.source === 'sequence' ? '整片' : '单场';
    lines.push(`- ${name} 场 ${frame.sceneId} ${where} t=${frame.t.toFixed(2)}`);
  }
  return [
    `已写出 ${lines.length} 张截帧（${batch.backend}），目录是项目 .awb/anim/frames/。`,
    ...lines,
    `控制台错误 ${ctx.session.consoleErrors.length} 条。`,
    '用 view_image 把图放回对话，用 check_layout 看出界和字叠，用 check_residual 比像素残留。',
    VISION_KEY_NOTE,
  ].join('\n');
}

async function viewImage(ctx: VisionContext, args: unknown): Promise<ToolOutput> {
  const requested = stringArg(objectArgs(args).frame);
  if (!requested || !isFramePath(requested)) {
    return `拒绝读取：${requested || '空路径'}。只接受 frames/ 下的截帧 PNG。`;
  }
  const stored = ctx.session.frames.get(requested);
  const png = await ctx.store.read(requested);
  if (!png) return `没有这张截帧：${requested}。先调用 render_frames。`;
  const caption = stored
    ? `${stored.source === 'sequence' ? '整片' : '单场'}截帧 ${requested}，场 ${stored.sceneId}，t=${stored.t.toFixed(2)}。`
    : `截帧 ${requested}`;
  return {
    text: `已把 ${requested} 放进下一条图像消息。${VISION_KEY_NOTE}`,
    image: { url: pngDataUrl(png), caption },
  };
}

function checkLayoutTool(ctx: VisionContext, args: unknown): string {
  const requested = stringArg(objectArgs(args).frame);
  if (requested && !isFramePath(requested)) return `拒绝读取：${requested}`;
  const frame = findFrame(ctx, requested, requested ? undefined : 'sequence');
  if (!frame) return '还没有截帧。先调用 render_frames。';
  const report = checkLayout({
    width: frame.raster.width,
    height: frame.raster.height,
    boxes: frame.boxes,
    raster: frame.raster,
  });
  return `${frame.name}\n${report.summary}`;
}

function checkResidualTool(ctx: VisionContext, args: unknown): string {
  const sceneArg = stringArg(objectArgs(args).sceneId);
  const sceneId = sceneArg && SCENE_ID.test(sceneArg) ? sceneArg : undefined;
  const frames = [...ctx.session.frames.values()];
  const sequence = frames
    .slice()
    .reverse()
    .find((frame) => frame.source === 'sequence' && (!sceneId || frame.sceneId === sceneId));
  const isolated = frames
    .slice()
    .reverse()
    .find((frame) => frame.source === 'isolated' && frame.sceneId === (sceneId ?? sequence?.sceneId));
  if (!sequence || !isolated) return '还没有成对的整片帧和单场帧。render_frames 请保持 isolated 为 true。';
  const scene = ctx.getStoryboard()?.scenes.find((item) => item.id === sequence.sceneId);
  const note = scene?.enter === 'keep' ? '这一场 enter 是 keep，共享对象留在画面上不一定是残留。' : undefined;
  const report = compareResidual(sequence.raster, isolated.raster, { note });
  return `场 ${sequence.sceneId}：整片 ${sequence.name} 对比单场 ${isolated.name}\n${report.summary}`;
}

function consoleErrors(ctx: VisionContext): string {
  if (!ctx.session.frames.size && !ctx.session.consoleErrors.length)
    return '还没有播放过预览。先调用 render_frames。';
  if (!ctx.session.consoleErrors.length) return '预览没有控制台错误。';
  return ctx.session.consoleErrors.map((error, index) => `${index + 1}. ${error}`).join('\n');
}

function stringArg(value: unknown): string | undefined {
  return typeof value === 'string' ? value.trim() : undefined;
}

export type VisionReview = { status: 'disabled'; rounds: 0; text: string } | ToolLoopResult;

/**
 * 只有 runtime.agentTools 打开才进入 runToolLoop。
 * 关着时不调用模型。runAgent 的一次性写 code 不经过这里。
 */
export async function runVisionReview(opts: {
  enabled: boolean;
  messages: LlmMessage[];
  transport: Transport;
  ctx: VisionContext;
  maxRounds?: number;
}): Promise<VisionReview> {
  if (!agentToolsEnabled(opts.enabled)) {
    return {
      status: 'disabled',
      rounds: 0,
      text: '闭环工具关着。agent 仍按一次性写 code 的路径走，不会截帧。',
    };
  }
  return runToolLoop({
    messages: opts.messages,
    tools: visionTools(opts.ctx),
    transport: opts.transport,
    title: '看画面',
    maxRounds: opts.maxRounds ?? 6,
  });
}
