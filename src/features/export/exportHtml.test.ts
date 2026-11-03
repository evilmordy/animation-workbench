import { describe, expect, it } from 'vitest';
import pythagoras from '../../../tests/fixtures/pythagoras.json';
import { legacyExportHtml } from '../../../tests/fixtures/legacyExportHtml';
import { zugeng } from '../../../tests/fixtures/zugeng';
import type { Storyboard } from '../../shared/schema';
import { assembleExportHtml } from './exportHtml';

const runtime = '/* runtime */\nconsole.log(1);\n';
const opts = { slides: false, loop: false };
const dsl = pythagoras as Storyboard;

const cspOf = (html: string) => html.match(/Content-Security-Policy" content="([^"]*)"/)?.[1];

describe('导出 HTML', () => {
  it('纯 dsl 与 S2a 模板逐字节一致，flag 打开也不变', async () => {
    const legacy = await legacyExportHtml(runtime, dsl, opts);
    const off = await assembleExportHtml(runtime, dsl, opts);
    const on = await assembleExportHtml(runtime, dsl, { ...opts, codeScenes: true });
    expect(off).toBe(legacy);
    expect(on).toBe(legacy);
    expect(off).not.toContain('data-code-scenes');
  });

  it('含 code 且 flag 关时仍是 S2a 模板', async () => {
    const html = await assembleExportHtml(runtime, zugeng, opts);
    expect(html).toBe(await legacyExportHtml(runtime, zugeng, opts));
    expect(html).not.toContain('data-code-scenes');
  });

  it('含 code 且 flag 开时只多 data-code-scenes，CSP 一个指令都不改', async () => {
    const enabled = await assembleExportHtml(runtime, zugeng, { ...opts, codeScenes: true });
    const legacy = await legacyExportHtml(runtime, zugeng, opts);
    expect(enabled.replace(' data-code-scenes="1"', '')).toBe(legacy);
    expect(cspOf(enabled)).toBe(cspOf(legacy));
    expect(cspOf(enabled)).toContain("'unsafe-eval'");
    expect(cspOf(enabled)).toContain("connect-src 'none'");
    expect(cspOf(enabled)).toContain("style-src 'unsafe-inline'");
    expect(cspOf(enabled)).toMatch(/script-src 'sha256-[^']+' 'unsafe-eval'/);
  });
});
