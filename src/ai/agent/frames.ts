import { platform } from '../../platform';
import type { Storyboard } from '../../shared/schema';
import type { CaptureRequest, FrameAt, FrameSource } from './capture';
import { isFramePath } from './paths';

export interface FrameStore {
  write(name: string, png: Uint8Array): Promise<void>;
  read(name: string): Promise<Uint8Array | null>;
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
    if (!scenes.length) return { ok: false, message: '当前分镜没有 kind:code 场。' };
  }
  const at = args.at ?? 'end';
  const isolated = args.isolated !== false;
  return {
    ok: true,
    request: {
      storyboard,
      shots: scenes.map((scene) => ({ sceneId: scene.id, at, isolated })),
    },
  };
}
