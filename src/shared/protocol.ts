import { z } from 'zod';

/** 宿主 → 预览 iframe（PLAN §3.2）。storyboard 在 iframe 内另行用 schema 校验 */
export const HostMessage = z.discriminatedUnion('type', [
  z.object({ type: z.literal('load'), storyboard: z.unknown(), startAt: z.number().optional() }),
  z.object({ type: z.literal('play') }),
  z.object({ type: z.literal('pause') }),
  z.object({ type: z.literal('seek'), t: z.number() }),
  z.object({ type: z.literal('setRate'), rate: z.number().positive() }),
  /**
   * 应用内体检。要布局框；`raster: false` 只量 DOM，不跑 foreignObject。
   * 原有 load/play/pause/seek/setRate 的语义不变。
   */
  z.object({
    type: z.literal('probe'),
    id: z.string().min(1).max(64),
    raster: z.boolean().optional(),
  }),
]);

export const SceneSpan = z.object({ id: z.string(), start: z.number(), end: z.number() });

/** 预览 iframe → 宿主 */
export const PreviewMessage = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('ready'),
    runtimeVersion: z.string(),
    manimWebVersion: z.string(),
    caps: z.object({ webcodecs: z.boolean() }),
  }),
  z.object({
    type: z.literal('loaded'),
    duration: z.number(),
    scenes: z.array(SceneSpan),
    buildMs: z.number(),
  }),
  z.object({ type: z.literal('time'), t: z.number(), playing: z.boolean() }),
  z.object({
    type: z.literal('error'),
    sceneId: z.string().optional(),
    elementId: z.string().optional(),
    message: z.string(),
  }),
  z.object({ type: z.literal('log'), level: z.string(), message: z.string() }),
  z.object({ type: z.literal('heartbeat') }),
  z.object({
    type: z.literal('probed'),
    id: z.string(),
    width: z.number(),
    height: z.number(),
    elements: z.array(z.unknown()),
    raster: z.string().nullable(),
    rasterMs: z.number(),
    rasterError: z.string().optional(),
  }),
]);

export type HostMessage = z.infer<typeof HostMessage>;
export type PreviewMessage = z.infer<typeof PreviewMessage>;
export type SceneSpan = z.infer<typeof SceneSpan>;
