/**
 * T3.8：pnpm eval:ai —— 用应用里同一套提示词和校验器评测各模型的结构化输出可靠性。
 *
 * 模型由环境变量 EVAL_MODELS 指定，逗号分隔的 "服务商:模型"，例如：
 *   EVAL_MODELS="deepseek:deepseek-chat,ollama:qwen3.5:9b-16k" pnpm eval:ai
 * Key 来自 <服务商大写>_API_KEY（如 DEEPSEEK_API_KEY）；Ollama 不需要。EVAL_LIMIT 可以只跑前 N 个输入。
 * 结果追加到 docs/ai-eval.md。
 */
import { appendFileSync } from 'node:fs';
import { expect, it } from 'vitest';
import { runTask, type Transport } from '../../src/ai/client';
import { outlineMessages, sceneMessages } from '../../src/ai/prompts';
import { providerById } from '../../src/ai/providers';
import { checkOutline, checkScene } from '../../src/ai/validators';
import { newProjectFile } from '../../src/shared/project';
import { PRESETS } from '../../src/shared/palette';
import { EVAL_INPUTS } from './inputs';

const meta = {
  title: 'eval',
  mode: '2d',
  aspect: '16:9',
  background: PRESETS['3b1b'].background,
  stylePreset: '3b1b',
} as const;

function transport(providerId: string, model: string): Transport {
  const p = providerById(providerId);
  const key = process.env[`${providerId.toUpperCase()}_API_KEY`] ?? (providerId === 'ollama' ? 'ollama' : '');
  if (!key) throw new Error(`缺少 ${providerId.toUpperCase()}_API_KEY`);
  return async (messages) => {
    const res = await fetch(`${p.baseUrl.replace(/\/$/, '')}/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({
        model,
        messages,
        temperature: 0.3,
        ...(p.jsonMode ? { response_format: { type: 'json_object' } } : {}),
      }),
      signal: AbortSignal.timeout(600_000),
    });
    if (!res.ok)
      throw { code: res.status === 429 ? 'rate_limit' : 'server', message: (await res.text()).slice(0, 200) };
    const data = await res.json();
    const u = data.usage;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: u ? [u.prompt_tokens, u.completion_tokens] : null,
    };
  };
}

type Row = {
  model: string;
  input: string;
  task: string;
  attempts: number | null;
  ms: number;
  error?: string;
};

it('AI 结构化输出可靠性评测', async () => {
  const models = (process.env.EVAL_MODELS ?? '').split(',').filter(Boolean);
  if (!models.length) {
    console.log('未设置 EVAL_MODELS，跳过评测。示例：EVAL_MODELS="ollama:qwen3.5:9b-16k" pnpm eval:ai');
    return;
  }
  const inputs = EVAL_INPUTS.slice(0, Number(process.env.EVAL_LIMIT ?? EVAL_INPUTS.length));
  const rows: Row[] = [];
  for (const spec of models) {
    const [providerId, ...rest] = spec.split(':');
    const model = rest.join(':');
    const t = transport(providerId!, model);
    for (const input of inputs) {
      const params = { ...newProjectFile('x').generation, contentType: input.type, targetDuration: 45 };
      const run = async (task: 'outline' | 'scene', fn: () => Promise<{ attempts: number }>) => {
        const t0 = Date.now();
        try {
          const r = await fn();
          rows.push({ model: spec, input: input.name, task, attempts: r.attempts, ms: Date.now() - t0 });
        } catch (e) {
          const err = e as { kind?: string; message?: string };
          rows.push({
            model: spec,
            input: input.name,
            task,
            attempts: null,
            ms: Date.now() - t0,
            error: err.kind ?? err.message,
          });
        }
        console.log(JSON.stringify(rows.at(-1)));
      };
      let outline:
        Awaited<ReturnType<typeof runTask<import('../../src/ai/prompts').Outline>>>['value'] | null = null;
      await run('outline', async () => {
        const r = await runTask(t, {
          task: 'outline',
          title: input.name,
          messages: outlineMessages(input.text, params),
          check: checkOutline,
        });
        outline = r.value;
        return r;
      });
      if (outline)
        await run('scene', () =>
          runTask(t, {
            task: 'scene',
            title: input.name,
            messages: sceneMessages({
              outline: outline!,
              index: 0,
              sceneId: 's_eval',
              source: input.text,
              params,
            }),
            check: (d) => checkScene(d, 's_eval', meta),
          }),
        );
    }
  }

  const lines = [
    `\n## ${new Date().toISOString().slice(0, 16)} · ${inputs.length} 个输入\n`,
    '| 模型 | 任务 | 一次通过 | 1 轮修复内 | 2 轮修复内 | 平均耗时 |',
    '|---|---|---|---|---|---|',
  ];
  for (const spec of models) {
    for (const task of ['outline', 'scene']) {
      const rs = rows.filter((r) => r.model === spec && r.task === task);
      if (!rs.length) continue;
      const pct = (n: number) =>
        `${Math.round((100 * rs.filter((r) => r.attempts !== null && r.attempts <= n).length) / rs.length)}%`;
      const avg = Math.round(rs.reduce((a, r) => a + r.ms, 0) / rs.length / 100) / 10;
      lines.push(`| ${spec} | ${task} | ${pct(1)} | ${pct(2)} | ${pct(3)} | ${avg}s |`);
    }
  }
  const failures = rows.filter((r) => r.attempts === null);
  if (failures.length)
    lines.push(
      '',
      '失败：' + failures.map((f) => `${f.model}/${f.input}/${f.task}（${f.error}）`).join('；'),
    );
  const md = lines.join('\n') + '\n';
  appendFileSync('docs/ai-eval.md', md);
  console.log(md);
  expect(rows.length).toBeGreaterThan(0);
});
