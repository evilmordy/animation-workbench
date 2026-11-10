import { inflateSync } from 'node:zlib';
import type { Raster } from '../../src/ai/agent/check/pixels';

/** 解 Playwright 截下来的 8 位 PNG。像素留在本进程，不把整幅 RGBA 经 JSON 传出浏览器。 */

function readU32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset + offset, 4).getUint32(0);
}

function concat(parts: Uint8Array[]): Uint8Array {
  const out = new Uint8Array(parts.reduce((sum, part) => sum + part.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
}

function paeth(left: number, up: number, upLeft: number): number {
  const estimate = left + up - upLeft;
  const dl = Math.abs(estimate - left);
  const du = Math.abs(estimate - up);
  const dul = Math.abs(estimate - upLeft);
  if (dl <= du && dl <= dul) return left;
  return du <= dul ? up : upLeft;
}

function unfilter(raw: Uint8Array, height: number, stride: number, bpp: number): Uint8Array {
  if (raw.length !== height * (stride + 1)) throw new Error('PNG 扫描行长度不对');
  const out = new Uint8Array(height * stride);
  let src = 0;
  for (let y = 0; y < height; y++) {
    const filter = raw[src++];
    const row = y * stride;
    for (let x = 0; x < stride; x++) {
      const left = x >= bpp ? out[row + x - bpp]! : 0;
      const up = y > 0 ? out[row - stride + x]! : 0;
      const upLeft = y > 0 && x >= bpp ? out[row - stride + x - bpp]! : 0;
      const value = raw[src++]!;
      let recon = value;
      if (filter === 1) recon = value + left;
      else if (filter === 2) recon = value + up;
      else if (filter === 3) recon = value + Math.floor((left + up) / 2);
      else if (filter === 4) recon = value + paeth(left, up, upLeft);
      else if (filter !== 0) throw new Error(`PNG 过滤器不支持：${filter}`);
      out[row + x] = recon & 0xff;
    }
  }
  return out;
}

export function decodePng(bytes: Uint8Array): Raster {
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (bytes.length < 8 || signature.some((byte, index) => bytes[index] !== byte)) throw new Error('不是 PNG');
  let offset = 8;
  let width = 0;
  let height = 0;
  let bitDepth = 0;
  let colorType = -1;
  let interlace = 0;
  const idat: Uint8Array[] = [];
  while (offset + 12 <= bytes.length) {
    const length = readU32(bytes, offset);
    const type = String.fromCharCode(
      bytes[offset + 4]!,
      bytes[offset + 5]!,
      bytes[offset + 6]!,
      bytes[offset + 7]!,
    );
    const start = offset + 8;
    const end = start + length;
    if (end + 4 > bytes.length) throw new Error('PNG 块被截断');
    const data = bytes.subarray(start, end);
    if (type === 'IHDR') {
      width = readU32(data, 0);
      height = readU32(data, 4);
      bitDepth = data[8] ?? 0;
      colorType = data[9] ?? -1;
      interlace = data[12] ?? 0;
    } else if (type === 'IDAT') idat.push(data);
    else if (type === 'IEND') break;
    offset = end + 4;
  }
  if (!width || !height) throw new Error('PNG 没有 IHDR');
  if (bitDepth !== 8 || interlace !== 0) throw new Error(`PNG 位深或交错不支持：${bitDepth}/${interlace}`);
  if (colorType !== 6 && colorType !== 2) throw new Error(`PNG 颜色类型不支持：${colorType}`);
  const bpp = colorType === 6 ? 4 : 3;
  const raw = inflateSync(concat(idat));
  const pixels = unfilter(raw, height, width * bpp, bpp);
  const rgba = new Uint8Array(width * height * 4);
  if (colorType === 6) rgba.set(pixels);
  else {
    for (let i = 0, j = 0; i < pixels.length; i += 3, j += 4) {
      rgba[j] = pixels[i]!;
      rgba[j + 1] = pixels[i + 1]!;
      rgba[j + 2] = pixels[i + 2]!;
      rgba[j + 3] = 255;
    }
  }
  return { width, height, rgba };
}
