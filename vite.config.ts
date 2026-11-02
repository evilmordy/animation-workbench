import { readFileSync } from 'node:fs';
import vue from '@vitejs/plugin-vue';
import type { Plugin } from 'vite';
import { defineConfig } from 'vitest/config';

const DEV_ORIGIN = 'http://localhost:1420';

/** 浏览器开发模式下模拟 Tauri 的 awpreview 协议：同样只提供两个文件、同样的 CSP */
function devPreview(): Plugin {
  const csp = `default-src 'none'; script-src ${DEV_ORIGIN} 'unsafe-eval'; style-src 'unsafe-inline'; img-src data: blob:; font-src data:; worker-src blob:; connect-src 'none'; base-uri 'none'; form-action 'none'`;
  const files: Record<string, string> = { '/index.html': 'text/html', '/runtime.js': 'text/javascript' };
  return {
    name: 'awb-dev-preview',
    configureServer(server) {
      server.middlewares.use('/__awpreview', (req, res) => {
        const path = (req.url ?? '').split('?')[0]!;
        const type = files[path];
        if (!type) {
          res.statusCode = 404;
          return res.end();
        }
        res.setHeader('Content-Type', type);
        res.setHeader('Content-Security-Policy', csp);
        // sandbox iframe 的源是 null，加载模块脚本需要 CORS
        res.setHeader('Access-Control-Allow-Origin', '*');
        res.end(readFileSync(`dist-runtime${path}`));
      });
    },
  };
}

// 端口固定为 1420，与 src-tauri/tauri.conf.json 的 devUrl 一致
export default defineConfig({
  plugins: [vue(), devPreview()],
  clearScreen: false,
  server: { port: 1420, strictPort: true, watch: { ignored: ['**/src-tauri/**', '**/spike/**'] } },
  build: { target: 'es2022' },
  test: {
    include: ['src/**/*.test.ts', 'tests/**/*.test.ts'],
    exclude: ['tests/e2e/**', 'tests/runtime/**'],
  },
});
