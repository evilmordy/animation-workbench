import { z } from 'zod';
import { SCHEMA_VERSION, type Storyboard } from './schema';

export const COMPLEXITIES = ['simple', 'medium', 'complex'] as const;
export const CONTENT_TYPES = ['math', 'physics', 'algorithm', 'story', 'general'] as const;

export const GenerationParams = z.object({
  targetDuration: z.number().min(10).max(600).default(60),
  complexity: z.enum(COMPLEXITIES).default('medium'),
  contentType: z.enum(CONTENT_TYPES).default('general'),
});

export const InputRef = z.object({
  id: z.string(),
  name: z.string(),
  /** inputs/ 下的文件名（原件副本） */
  file: z.string(),
  /** inputs/ 下提取出的文本 */
  textFile: z.string(),
  chars: z.number(),
  addedAt: z.string(),
});

/** project.json（PLAN §2 用户项目目录）；未知字段会被丢弃，便于向前兼容 */
export const ProjectFile = z.object({
  schemaVersion: z.number().int(),
  name: z.string(),
  createdAt: z.string(),
  ai: z.object({ providerId: z.string().optional(), model: z.string().optional() }).default({}),
  inputs: z.array(InputRef).default([]),
  generation: GenerationParams.default({ targetDuration: 60, complexity: 'medium', contentType: 'general' }),
});

export type ProjectFile = z.infer<typeof ProjectFile>;
export type GenerationParams = z.infer<typeof GenerationParams>;
export type InputRef = z.infer<typeof InputRef>;

export function newProjectFile(name: string, now = new Date()): ProjectFile {
  return ProjectFile.parse({ schemaVersion: SCHEMA_VERSION, name, createdAt: now.toISOString() });
}

export function emptyStoryboard(title: string): Storyboard {
  return {
    schemaVersion: SCHEMA_VERSION,
    meta: { title, mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
    scenes: [],
  };
}

/** 快照文件名：storyboard-YYYYMMDD-HHmmss-<原因>.json（本地时间） */
export function snapshotName(reason: string, now = new Date()): string {
  const p = (n: number) => String(n).padStart(2, '0');
  const stamp = `${now.getFullYear()}${p(now.getMonth() + 1)}${p(now.getDate())}-${p(now.getHours())}${p(now.getMinutes())}${p(now.getSeconds())}`;
  return `storyboard-${stamp}-${reason.replace(/[^\w\u4e00-\u9fa5-]/g, '_').slice(0, 24)}.json`;
}

export const PROJECT_DIRS = ['inputs', 'assets', 'versions', 'exports', '.awb'] as const;
