// T0.4：Chromium 的 WebCodecs 能力。不要在 Linux 的 WebKitGTK 上跑 isConfigSupported（会崩）。
import { resolve } from 'node:path';
import { chromium } from '@playwright/test';

const browser = await chromium.launch({ channel: 'chromium' });
const page = await browser.newPage();
await page.goto(`file://${resolve('harness/index.html')}`);
const caps = await page.evaluate(async () => {
  const out = { isSecureContext, VideoEncoder: typeof VideoEncoder };
  if (typeof VideoEncoder === 'undefined') return out;
  for (const [name, codec] of [['h264(mp4)', 'avc1.42001f'], ['vp8(webm)', 'vp8'], ['vp9(webm)', 'vp09.00.10.08']]) {
    const r = await VideoEncoder.isConfigSupported({ codec, width: 1280, height: 720, bitrate: 4e6, framerate: 30 });
    out[name] = r.supported;
  }
  return out;
});
console.log(JSON.stringify({ browser: `chromium ${browser.version()}`, ...caps }));
await browser.close();
