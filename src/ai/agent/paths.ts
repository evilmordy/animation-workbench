/** 旁路文件白名单。模型工具只能写这些；截帧 PNG 另走 isFramePath。 */

export function isAnimPath(name: string): boolean {
  return /^(plan\.md|rubric\.json|shared\.js|scenes\/[A-Za-z_][A-Za-z0-9_-]{0,63}\.js)$/.test(name);
}

/**
 * 截帧 PNG。仍在项目 `.awb/anim/frames/` 下，不进分镜。
 * 文件名由场次 id、整片/单场、时间标签拼成，避免把任意路径写进旁路目录。
 */
export function isFramePath(name: string): boolean {
  return /^frames\/[A-Za-z_][A-Za-z0-9_-]{0,63}-(?:sequence|isolated)-(?:start|mid|end|t\d{1,6})\.png$/.test(
    name,
  );
}
