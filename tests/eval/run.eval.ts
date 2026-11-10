// @vitest-environment happy-dom
/**
 * 五题机器初筛。`pnpm eval:ai`。
 * 不进 CI。DEEPSEEK_API_KEY 只从环境变量读，不写进仓库、不进 summary.json。
 * EVAL_TOPIC 可只跑一题。EVAL_SCREEN=1 时先用一场现成代码把浏览器初筛走一遍，不调用模型。
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { it } from 'vitest';
import type { Transport } from '../../src/ai/client';
import { messageText, type LlmMessage } from '../../src/platform/types';
import { parseStoryboard } from '../../src/shared/schema';
import { screenStoryboard } from './screen';
import { deepseekRequestBody, evaluateTopic, type EvalRow } from './summary';
import { TOPICS, type Topic } from './topics';

function apiMessages(messages: LlmMessage[]): { role: string; content: string }[] {
  return messages.map((message) => ({
    role: message.role,
    content: typeof message.content === 'string' ? message.content : messageText(message.content),
  }));
}

function transport(key: string): Transport {
  return async (messages) => {
    const res = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify(deepseekRequestBody(apiMessages(messages))),
      signal: AbortSignal.timeout(600_000),
    });
    const raw = await res.text();
    const redacted = raw.split(key).join('[redacted]');
    if (!res.ok) {
      throw new Error(`DeepSeek ${res.status}：${redacted.slice(0, 200)}`);
    }
    const data = JSON.parse(redacted) as {
      choices?: { message?: { content?: string } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    const usage = data.usage;
    return {
      text: data.choices?.[0]?.message?.content ?? '',
      usage: usage ? [usage.prompt_tokens ?? 0, usage.completion_tokens ?? 0] : null,
    };
  };
}

function printRow(row: EvalRow) {
  const cells = [
    row.id,
    row.status,
    String(row.scenes),
    String(row.turns),
    String(row.tokens),
    String(row.elapsedMs),
    String(row.writes),
    row.stuck.join(',') || '-',
    row.gate ? '过' : '不过',
    row.layout ? '过' : '不过',
    row.residual ? '过' : '不过',
    row.seek ? '过' : '不过',
    row.backward ? '过' : '不过',
    row.shuffle ? '过' : '不过',
    row.export ? '过' : '不过',
    row.console ? '过' : '不过',
    row.blackRatio == null ? '-' : row.blackRatio.toFixed(3),
    row.pass ? 'PASS' : 'FAIL',
    row.math,
  ];
  console.log(`| ${cells.join(' | ')} |`);
}

async function screenFixture() {
  const parsed = parseStoryboard({
    schemaVersion: 1,
    meta: { title: '冒烟', mode: '2d', aspect: '16:9', background: '#000000', stylePreset: '3b1b' },
    scenes: [
      {
        id: 's_effect',
        title: '现象',
        description: '未完成的任务更容易被记住',
        kind: 'code',
        enter: 'fresh',
        hold: 1,
        elements: [],
        steps: [],
        code: [
          "const box = el('div', { left: 80, top: 80, width: 200, height: 80, background: C.blue }, '未完成的任务');",
          'fadeIn(box, 0);',
          'wait(1000);',
        ].join('\n'),
      },
    ],
  });
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
  const facts = await screenStoryboard(parsed.value);
  console.log(
    `现成一场初筛：问题 ${facts.issues.length}，黑屏比 ${facts.blackRatio.toFixed(3)}，导出 ${facts.exportOk ? '过' : '不过'}`,
  );
  if (facts.issues.length) console.log(facts.issues.map((issue) => issue.fingerprint).join('\n'));
}

it('五题机器初筛', async () => {
  if (process.env.EVAL_SCREEN === '1') await screenFixture();
  const key = process.env.DEEPSEEK_API_KEY ?? '';
  if (!key) {
    console.log('未设置 DEEPSEEK_API_KEY，跳过五题评测。');
    return;
  }
  const only = process.env.EVAL_TOPIC;
  const topics: readonly Topic[] = only ? TOPICS.filter((topic) => topic.id === only) : TOPICS;
  if (!topics.length) throw new Error(`没有题 ${only}`);
  const call = transport(key);
  console.log(
    '| 题 | 状态 | 场数 | 轮数 | token | 耗时 | 写入 | 卡住场 | 运行门 | 布局 | 残留 | 同毫秒 | 后向 | 乱序 | 导出 | 控制台 | 黑屏比 | PASS | 抽查 |',
  );
  const rows: EvalRow[] = [];
  for (const topic of topics) {
    const row = await evaluateTopic({ topic, transport: call, screen: screenStoryboard });
    rows.push(row);
    printRow(row);
  }
  const outDir = join(process.cwd(), 'tests/eval/out');
  mkdirSync(outDir, { recursive: true });
  writeFileSync(
    join(outDir, 'summary.json'),
    `${JSON.stringify(
      {
        model: 'deepseek-chat',
        temperature: 0.3,
        maxTokens: 65536,
        pass: '运行门 + 布局 + 残留 + 同毫秒 + 后向 + 乱序 + 导出 + 控制台 + 黑屏比 ≤ 0.1',
        rows,
      },
      null,
      2,
    )}\n`,
  );
});
