import { describe, expect, it } from 'vitest';
import fixture from '../../tests/fixtures/pythagoras.json';
import type { ChatMessage } from '../platform/types';
import type { Storyboard } from '../shared/schema';
import { AiError, runTask, type LogEntry, type Transport } from './client';
import { outlineMessages } from './prompts';
import { newProjectFile } from '../shared/project';
import { checkEdit, checkOutline, checkScene } from './validators';

const sb = fixture as Storyboard;
const params = newProjectFile('x').generation;

/** 依次返回预设回答，并记录每次收到的消息 */
function scripted(...answers: string[]) {
  const calls: ChatMessage[][] = [];
  const t: Transport = async (messages, { onDelta }) => {
    calls.push(messages);
    const text = answers.shift() ?? '';
    onDelta(text);
    return { text, usage: [10, 5] };
  };
  return { t, calls };
}

const goodOutline = JSON.stringify({ title: 't', scenes: [{ title: 'a', description: 'd', duration: 5 }] });

describe('AI 客户端', () => {
  it('成功：带代码围栏的输出也能解析', async () => {
    const { t, calls } = scripted('```json\n' + goodOutline + '\n```');
    const logs: LogEntry[] = [];
    const r = await runTask(
      t,
      { task: 'outline', title: '大纲', messages: outlineMessages('x', params), check: checkOutline },
      (e) => logs.push(e),
    );
    expect(r.value.scenes).toHaveLength(1);
    expect(r.attempts).toBe(1);
    expect(calls).toHaveLength(1);
    expect(logs).toMatchObject([{ ok: true, attempts: 1, usage: [10, 5] }]);
  });

  it('修复：第一次缺字段，把问题回传后第二次通过', async () => {
    const { t, calls } = scripted('{"title":"t","scenes":[{"title":"a"}]}', goodOutline);
    const r = await runTask(t, {
      task: 'outline',
      title: '大纲',
      messages: outlineMessages('x', params),
      check: checkOutline,
    });
    expect(r.attempts).toBe(2);
    const repair = calls[1]!;
    expect(repair.map((m) => m.role)).toEqual(['system', 'user', 'assistant', 'user']);
    expect(repair[3]!.content).toContain('scenes[0].description');
  });

  it('失败：2 轮修复后仍不合格，抛出带最后输出的错误', async () => {
    const { t, calls } = scripted('不是 JSON', '{"x":1}', '{"y":2}');
    const logs: LogEntry[] = [];
    const err = await runTask(t, { task: 'outline', title: '大纲', messages: [], check: checkOutline }, (e) =>
      logs.push(e),
    ).catch((e) => e);
    expect(err).toBeInstanceOf(AiError);
    expect(err.kind).toBe('validation');
    expect(err.lastText).toBe('{"y":2}');
    expect(calls).toHaveLength(3);
    expect(logs.at(-1)).toMatchObject({ ok: false, error: 'validation', usage: [30, 15] });
  });

  it('LLM 错误直接上抛，不做修复', async () => {
    const t: Transport = async () => {
      throw { code: 'auth', message: 'bad key' };
    };
    const err = await runTask(t, { task: 'outline', title: '大纲', messages: [], check: checkOutline }).catch(
      (e) => e,
    );
    expect(err).toMatchObject({ kind: 'llm', llm: { code: 'auth' } });
  });
});

describe('校验器', () => {
  it('单场景：强制使用指定 id，语义错误会被列出', () => {
    const ok = checkScene(structuredClone(sb.scenes[0]), 's_new', sb.meta);
    expect(ok.value?.id).toBe('s_new');
    const bad = checkScene(structuredClone(sb.scenes[1]), 's_x', sb.meta); // 引用了上一场景的 la 等
    expect(bad.issues.some((i) => i.includes('la'))).toBe(true);
  });

  it('修改：超出范围的操作被忽略，改动场景的错误会要求修复', () => {
    const scene = { ...structuredClone(sb.scenes[0]!), title: '新标题' };
    const ok = checkEdit(
      {
        ops: [
          { op: 'replaceScene', id: 's_tri001', scene },
          { op: 'deleteScene', id: 's_eq0003' },
        ],
      },
      sb,
      { kind: 'scene', sceneId: 's_tri001' },
    );
    expect(ok.value?.storyboard.scenes).toHaveLength(3);
    expect(ok.value?.skipped).toEqual(['1 个操作超出修改范围，已忽略']);

    const broken = {
      ...scene,
      steps: [{ id: 'x', kind: 'play', anims: [{ type: 'Indicate', target: 'tri' }], duration: 1 }],
    };
    const bad = checkEdit({ ops: [{ op: 'replaceScene', id: 's_tri001', scene: broken }] }, sb, {
      kind: 'all',
    });
    expect(bad.issues.join()).toContain('场景 s_tri001');
  });
});
