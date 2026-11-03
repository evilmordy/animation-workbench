import type { Page } from '@playwright/test';

/** 统计截图像素里接近某个 #RRGGBB 的个数。用来确认换场后上一场的色块真的不在画面上。 */
export async function countNear(page: Page, png: Buffer, hex: string, tol = 14): Promise<number> {
  return page.evaluate(
    async ({ b64, hex, tol }) => {
      const img = new Image();
      img.src = `data:image/png;base64,${b64}`;
      await img.decode();
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('no 2d');
      ctx.drawImage(img, 0, 0);
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      const n = Number.parseInt(hex.slice(1), 16);
      const tr = (n >> 16) & 255;
      const tg = (n >> 8) & 255;
      const tb = n & 255;
      let hit = 0;
      for (let i = 0; i < data.length; i += 4) {
        const r = data[i] ?? 0;
        const g = data[i + 1] ?? 0;
        const b = data[i + 2] ?? 0;
        if (Math.abs(r - tr) <= tol && Math.abs(g - tg) <= tol && Math.abs(b - tb) <= tol) hit++;
      }
      return hit;
    },
    { b64: png.toString('base64'), hex, tol },
  );
}
