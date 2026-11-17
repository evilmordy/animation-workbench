import { describe, expect, it } from 'vitest';
import pythagoras from '../../../tests/fixtures/pythagoras.json';
import { legacyExportHtml } from '../../../tests/fixtures/legacyExportHtml';
import type { Storyboard } from '../../shared/schema';
import { assembleExportHtml } from './exportHtml';

const runtime = '/* runtime */\nconsole.log(1);\n';
const opts = { slides: false, loop: false };
const dsl = pythagoras as Storyboard;
const codeBoard: Storyboard = {
  ...dsl,
  scenes: [
    {
      id: 's_code',
      title: '代码',
      description: '',
      kind: 'code',
      enter: 'fresh',
      hold: 0.4,
      elements: [],
      steps: [],
      code: 'const el = document.createElement("div");\nroot.appendChild(el);\n',
    },
  ],
};

describe('导出 HTML', () => {
  it('纯 dsl 与 S2a 模板逐字节一致', async () => {
    const html = await assembleExportHtml(runtime, dsl, opts);
    expect(html).toBe(await legacyExportHtml(runtime, dsl, opts));
  });

  it('含 code 时仍是 S2a 模板', async () => {
    const html = await assembleExportHtml(runtime, codeBoard, opts);
    expect(html).toBe(await legacyExportHtml(runtime, codeBoard, opts));
  });
});
