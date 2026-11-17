import type { Scene } from '../../shared/schema';

/** 用场景标题和描述拼重写指令。不带旧代码，避免把旧签名写回提示。 */
export function rewriteIntent(scenes: readonly Pick<Scene, 'id' | 'title' | 'description'>[]): string {
  const lines = scenes.map((scene) => {
    const name = scene.title.trim() || scene.id;
    const seen = scene.description.trim() || name;
    return `- ${scene.id} 「${name}」：${seen}`;
  });
  return ['把下面这些旧代码场按描述重写成 anime.js 代码场。', ...lines].join('\n');
}
