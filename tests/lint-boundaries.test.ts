import { ESLint } from 'eslint';
import { describe, expect, it } from 'vitest';

const eslint = new ESLint();
const ruleIds = async (code: string, filePath: string) =>
  (await eslint.lintText(code, { filePath }))[0]!.messages.map((m) => m.ruleId);

describe('PLAN §0.3 边界规则', () => {
  it('src/platform 之外禁止 Tauri', async () => {
    expect(await ruleIds("import '@tauri-apps/api/core';\n", 'src/stores/x.ts')).toContain(
      'no-restricted-imports',
    );
    expect(await ruleIds("import '@tauri-apps/api/core';\n", 'src/platform/x.ts')).not.toContain(
      'no-restricted-imports',
    );
  });

  it('只有 src/runtime 可以依赖 animejs、three、katex', async () => {
    for (const spec of ["import 'animejs';\n", "import 'three';\n", "import 'katex';\n"]) {
      expect(await ruleIds(spec, 'src/features/x.ts')).toContain('no-restricted-imports');
      expect(await ruleIds(spec, 'src/ai/agent/x.ts')).toContain('no-restricted-imports');
      expect(await ruleIds(spec, 'src/runtime/x.ts')).not.toContain('no-restricted-imports');
    }
  });

  it('src/shared 禁止 UI 库和 DOM 全局对象', async () => {
    expect(await ruleIds("import 'vue';\n", 'src/shared/x.ts')).toContain('no-restricted-imports');
    expect(await ruleIds('document.title;\n', 'src/shared/x.ts')).toContain('no-restricted-globals');
  });

  it('禁止 v-html 和 innerHTML', async () => {
    expect(await ruleIds('<template><div v-html="x" /></template>\n', 'src/features/X.vue')).toContain(
      'vue/no-v-html',
    );
    expect(
      await ruleIds('const el = {} as HTMLElement;\nel.innerHTML = "x";\n', 'src/features/x.ts'),
    ).toContain('no-restricted-syntax');
  });
});
