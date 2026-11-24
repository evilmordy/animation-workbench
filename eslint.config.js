import { defineConfig } from 'eslint/config';
import vue from 'eslint-plugin-vue';
import tseslint from 'typescript-eslint';

const TAURI = { group: ['@tauri-apps/*'], message: '只有 src/platform/ 可以使用 Tauri（PLAN §0.3）' };
const GFX = {
  group: ['animejs', 'animejs/*', 'three', 'three/*', 'katex', 'katex/*'],
  message: '只有 src/runtime/ 可以使用 animejs、three、katex',
};
const UI = { group: ['vue', 'pinia', 'naive-ui', 'vue-draggable-plus'], message: 'src/shared/ 必须是纯 TS' };
const restrict = (...patterns) => ['error', { patterns }];

export default defineConfig(
  {
    ignores: [
      'dist/**',
      'dist-runtime/**',
      'spike/**',
      'src-tauri/target/**',
      'src-tauri/gen/**',
      'test-results/**',
      'playwright-report/**',
    ],
  },
  ...tseslint.configs.recommended,
  // essential 不含排版规则，排版交给 prettier
  ...vue.configs['flat/essential'],
  {
    files: ['**/*.vue'],
    languageOptions: { parserOptions: { parser: tseslint.parser } },
  },
  {
    rules: {
      'vue/no-v-html': 'error',
      'no-restricted-syntax': [
        'error',
        {
          selector: 'AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]',
          message: '禁止 innerHTML/outerHTML（SEC-06）',
        },
        {
          selector: 'CallExpression[callee.property.name="insertAdjacentHTML"]',
          message: '禁止 insertAdjacentHTML（SEC-06）',
        },
      ],
    },
  },
  // 测试里要构造各种非法数据
  { files: ['**/*.test.ts', '**/*.spec.ts'], rules: { '@typescript-eslint/no-explicit-any': 'off' } },
  {
    files: ['src/**'],
    ignores: ['src/platform/**', 'src/runtime/**', 'src/shared/**'],
    rules: { 'no-restricted-imports': restrict(TAURI, GFX) },
  },
  { files: ['src/platform/**'], rules: { 'no-restricted-imports': restrict(GFX) } },
  { files: ['src/runtime/**'], rules: { 'no-restricted-imports': restrict(TAURI) } },
  {
    files: ['src/shared/**'],
    rules: {
      'no-restricted-imports': restrict(TAURI, GFX, UI),
      'no-restricted-globals': ['error', 'window', 'document', 'navigator', 'localStorage', 'fetch'],
    },
  },
);
