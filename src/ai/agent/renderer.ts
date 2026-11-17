/** 整片都是代码场且代码场景打开时，预览和导出才用 anime 页。空片、夹着分镜场、开关关掉，都走原来的页。 */
export function filmUsesAnime(codeScenes: boolean, scenes: readonly { kind: string }[]): boolean {
  return codeScenes && scenes.length > 0 && scenes.every((scene) => scene.kind === 'code');
}

/** anime 为 false 时地址与原来一样。 */
export function previewPageUrl(base: string, anime: boolean): string {
  if (!anime) return base;
  return base.replace(/index\.html(?=$|[?#])/, 'anime.html');
}
