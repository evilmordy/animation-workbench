import { describe, expect, it } from 'vitest';
import { assembleExportHtml } from '../../src/features/export/exportHtml';
import { parseStoryboard } from '../../src/shared/schema';
import { exportPasses } from './summary';

describe('导出检查', () => {
  it('认内联运行时，拒绝外链脚本', async () => {
    const parsed = parseStoryboard({
      schemaVersion: 1,
      meta: { title: '导出', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
      scenes: [
        {
          id: 's_effect',
          title: '现象',
          description: '一场',
          kind: 'code',
          enter: 'fresh',
          hold: 1,
          elements: [],
          steps: [],
          code: 'wait(1000);',
        },
      ],
    });
    if (!parsed.ok) throw new Error('bad board');
    const html = await assembleExportHtml('runtime-body-marker', parsed.value, {
      slides: false,
      loop: false,
      codeScenes: true,
    });
    expect(exportPasses(html, 'runtime-body-marker')).toBe(true);
    expect(
      exportPasses(
        html.replace('runtime-body-marker', '<script src="https://cdn.example/a.js"></script>'),
        'nope',
      ),
    ).toBe(false);
  });
});
