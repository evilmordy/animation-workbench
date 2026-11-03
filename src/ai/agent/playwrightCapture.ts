/**
 * Playwright 截帧。复用 tests/runtime 的 code-harness 和 dist-runtime。
 * 不要从应用入口静态引入本文件：它依赖 Node 和 Playwright，失败时应由工具降级。
 */
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { HarnessPage, HarnessRun } from './capture';
import type { LayoutBox, Raster } from './pixels';

/** 与 tests/runtime/serve.ts 的预览 CSP 一致。 */
const PREVIEW_CSP =
  "default-src 'none'; script-src http://awpreview.test 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'";

const PREVIEW_FILES: Record<string, [string, string]> = {
  'http://awpreview.test/code-harness.html': ['tests/runtime/code-harness.html', 'text/html'],
  'http://awpreview.test/code-harness.js': ['tests/runtime/code-harness.js', 'text/javascript'],
  'http://awpreview.test/runtime.js': ['dist-runtime/runtime.js', 'text/javascript'],
};

function requirePreviewFiles(root: string) {
  for (const [rel] of Object.values(PREVIEW_FILES)) {
    if (!existsSync(join(root, rel))) {
      throw new Error(`预览文件不存在：${rel}。先构建 runtime，或继续走降级，不阻塞改代码。`);
    }
  }
}

interface Grabbed {
  width: number;
  height: number;
  rgba: number[];
  boxes: LayoutBox[];
}

/**
 * 打开无头浏览器里的代码场景预览。文件缺失或浏览器起不来时抛错，调用方降级。
 * 不读取模型 API key。
 */
export async function launchPlaywrightHarness(root = process.cwd()): Promise<HarnessPage> {
  requirePreviewFiles(root);
  let chromium: typeof import('@playwright/test').chromium;
  try {
    ({ chromium } = await import('@playwright/test'));
  } catch (e) {
    throw new Error(`Playwright 不可用：${e instanceof Error ? e.message : String(e)}`);
  }
  let browser: Awaited<ReturnType<typeof chromium.launch>>;
  try {
    browser = await chromium.launch({ channel: 'chromium' });
  } catch (e) {
    throw new Error(
      `Playwright 启动失败：${e instanceof Error ? e.message : String(e)}。应用内 webview 截帧尚未接入。`,
    );
  }
  try {
    const page = await browser.newPage({ viewport: { width: 960, height: 540 } });
    const consoleErrors: string[] = [];
    const listeners = new Set<(message: string) => void>();
    const push = (message: string) => {
      if (!message || consoleErrors.includes(message)) return;
      consoleErrors.push(message);
      for (const listener of listeners) listener(message);
    };
    page.on('pageerror', (error) => push(error.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') push(msg.text());
    });
    await page.route('**/*', (route) => {
      const url = route.request().url().split('?')[0] ?? '';
      const file = PREVIEW_FILES[url];
      if (!file) return route.abort();
      return route.fulfill({
        body: readFileSync(join(root, file[0])),
        contentType: file[1],
        headers: { 'Content-Security-Policy': PREVIEW_CSP },
      });
    });
    const harness: HarnessPage = {
      onConsoleError(listener) {
        listeners.add(listener);
        for (const message of consoleErrors) listener(message);
      },
      async gotoHarness() {
        await page.goto('http://awpreview.test/code-harness.html');
        await page.waitForFunction(() => Boolean((globalThis as { __ready?: boolean }).__ready));
        await page.addStyleTag({ content: '[data-player-bar]{display:none!important}' });
      },
      async run(storyboard, enableCodeScenes) {
        return page.evaluate(
          ({ storyboard, enableCodeScenes }) => {
            const win = globalThis as {
              __run?: (sb: unknown, enable?: boolean) => Promise<HarnessRun>;
            };
            if (!win.__run) throw new Error('预览页没有 __run');
            return win.__run(storyboard, enableCodeScenes);
          },
          { storyboard, enableCodeScenes },
        );
      },
      async seek(t) {
        await page.evaluate((time) => {
          const win = globalThis as { __seek?: (t: number) => void };
          win.__seek?.(time);
        }, t);
      },
      async wait(ms) {
        await page.waitForTimeout(ms);
      },
      async grab() {
        const png = await page.locator('#stage').screenshot();
        const grabbed = await page.evaluate(async (b64): Promise<Grabbed> => {
          const img = new Image();
          img.src = `data:image/png;base64,${b64}`;
          await img.decode();
          const canvas = document.createElement('canvas');
          canvas.width = img.width;
          canvas.height = img.height;
          const ctx = canvas.getContext('2d');
          if (!ctx) throw new Error('无法读取截帧像素');
          ctx.drawImage(img, 0, 0);
          const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
          const stage = document.getElementById('stage');
          const origin = stage?.getBoundingClientRect();
          const boxes: LayoutBox[] = [];
          if (stage && origin) {
            for (const el of stage.querySelectorAll('*')) {
              if (boxes.length >= 40) break;
              const rect = el.getBoundingClientRect();
              if (rect.width < 2 || rect.height < 2) continue;
              const text = (el.textContent ?? '').trim().slice(0, 80);
              const role = text && el.children.length === 0 ? 'text' : 'other';
              boxes.push({
                id: el.id || `${role}-${boxes.length}`,
                role,
                x: rect.x - origin.x,
                y: rect.y - origin.y,
                width: rect.width,
                height: rect.height,
                ...(text ? { text } : {}),
              });
            }
          }
          return { width: canvas.width, height: canvas.height, rgba: Array.from(data), boxes };
        }, Buffer.from(png).toString('base64'));
        const raster: Raster = {
          width: grabbed.width,
          height: grabbed.height,
          rgba: Uint8Array.from(grabbed.rgba),
        };
        return { png, raster, boxes: grabbed.boxes };
      },
      async close() {
        await browser.close();
      },
    };
    return harness;
  } catch (e) {
    await browser.close();
    throw e;
  }
}
