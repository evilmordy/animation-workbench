import type { PALETTE_TOKENS } from './registry';
import type { Storyboard } from './schema';

export type PaletteToken = (typeof PALETTE_TOKENS)[number];
export type Palette = Record<PaletteToken, string>;

/** 内置风格预设（PLAN T2.5）。custom 以 3b1b 为底，由 meta.palette 覆盖 */
export const PRESETS: Record<'3b1b' | 'clean', { background: string; palette: Palette }> = {
  '3b1b': {
    background: '#000000',
    palette: {
      primary: '#58C4DD',
      secondary: '#83C167',
      accent: '#FC6255',
      text: '#FFFFFF',
      muted: '#888888',
    },
  },
  clean: {
    background: '#FFFFFF',
    palette: {
      primary: '#2563EB',
      secondary: '#16A34A',
      accent: '#DC2626',
      text: '#111827',
      muted: '#6B7280',
    },
  },
};

export function resolvePalette(meta: Storyboard['meta']): Palette {
  const base = PRESETS[meta.stylePreset === 'clean' ? 'clean' : '3b1b'].palette;
  return { ...base, ...meta.palette };
}

/** 把 "$primary" 这类令牌解析成具体颜色 */
export function resolveColor(color: string, palette: Palette): string {
  return color.startsWith('$') ? (palette[color.slice(1) as PaletteToken] ?? '#FFFFFF') : color;
}
