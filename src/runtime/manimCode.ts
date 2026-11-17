/** anime 播放器遇到旧 manim-web 代码场时的报错。该场留空，不编译。 */
export const MANIM_CODE_UNSUPPORTED = '此场是 manim-web 代码，已不再支持';

/** manim 运行时遇到任何代码场时的报错。后面的分镜场照常录。 */
export const MANIM_RUNTIME_SKIPS_CODE = '代码场不归 manim 运行时播';

/**
 * 旧代码场靠这些调用认出来。anime 场用的是 root / tl.add，不会撞上。
 * 认不出来的代码仍交给编译；这里只拦已经能确定是 manim-web 的正文。
 */
export function isManimSceneCode(code: string): boolean {
  return (
    /\bscene\s*\.\s*(?:play|wait|add)\s*\(/.test(code) ||
    /\bM\s*\.\s*[A-Za-z_$]/.test(code) ||
    /\bctx\s*\.\s*present\s*\(/.test(code)
  );
}
