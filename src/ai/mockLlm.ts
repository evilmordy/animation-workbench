import fixture from '../../tests/fixtures/pythagoras.json';
import type { MockLlm } from '../platform/mock';
import { messageText, type ChatMessage, type LlmMessage, type ToolCall } from '../platform/types';
import type { Scene, Storyboard } from '../shared/schema';
import { taskOf } from './prompts';

/**
 * 浏览器模式（pnpm dev / e2e）下的假 LLM：按任务类型返回基于附录 A 的合法回答。
 * 素材或指令里含"【测试：需要修复】"时第一次故意给出不合格的输出，用来走通自动修复。
 */

const sb = fixture as Storyboard;
const NEEDS_REPAIR = '【测试：需要修复】';
/** e2e：模型一直吐字，直到取消把这次请求标成 cancelled。 */
const WAIT_CANCEL = '【测试：agent 等待取消】';
/** 纯文本消息原样留下。图像 part 只取 text，假 LLM 不看图。 */
function asText(messages: LlmMessage[]): ChatMessage[] {
  return messages.map((m) => ({
    role: m.role === 'assistant' || m.role === 'system' || m.role === 'user' ? m.role : 'user',
    content: messageText(m.content),
  }));
}

/** 自给自足的场景：标题文字 + 一个图形 + 强调 */
function standaloneScene(id: string, title: string, k: number): Scene {
  const colors = ['$primary', '$secondary', '$accent'];
  return {
    id,
    title,
    description: `${title}：标题文字和一个图形`,
    kind: 'dsl',
    enter: 'fresh',
    hold: 1,
    elements: [
      { id: 'title', type: 'Text', props: { text: title, fontSize: 40 }, place: { toEdge: 'UP' } },
      { id: 'shape', type: k % 2 ? 'Square' : 'Circle', props: {}, style: { color: colors[k % 3] } },
    ],
    steps: [
      { id: 'st1', kind: 'play', anims: [{ type: 'Write', target: 'title' }], duration: 1 },
      { id: 'st2', kind: 'play', anims: [{ type: 'Create', target: 'shape' }], duration: 1.5 },
      { id: 'st3', kind: 'play', anims: [{ type: 'Indicate', target: 'shape' }], duration: 1 },
    ],
  };
}

function answer(messages: LlmMessage[]): string {
  const text = asText(messages);
  const task = taskOf(text);
  const user = text[1]?.content ?? '';
  const repairing = messages.length > 2;
  const wantBroken = user.includes(NEEDS_REPAIR) && !repairing;

  if (task === 'outline') {
    if (wantBroken) return '{"title":"勾股定理","scenes":[{"title":"引入"}]}';
    return JSON.stringify({
      title: sb.meta.title,
      scenes: sb.scenes.map((s, i) => ({
        title: s.title,
        description: s.description,
        duration: [4.5, 5.5, 7][i],
      })),
    });
  }

  if (task === 'scene') {
    const id = /id 使用 "([^"]+)"/.exec(user)?.[1] ?? 's_mock';
    const index = Number(/第 (\d+) 个场景/.exec(user)?.[1] ?? 1) - 1;
    const title = /- 标题：(.+)/.exec(user)?.[1]?.trim() ?? `场景 ${index + 1}`;
    if (wantBroken)
      return JSON.stringify({
        ...standaloneScene(id, title, index),
        steps: [{ id: 'x', kind: 'play', anims: [{ type: 'Indicate', target: 'nope' }], duration: 1 }],
      });
    // 第一个场景用附录 A 原样（它是自给自足的），其余用通用模板
    const scene =
      index === 0 ? { ...sb.scenes[0]!, id, enter: 'fresh' as const } : standaloneScene(id, title, index);
    const extra = /额外要求：(.+)/.exec(user)?.[1];
    if (extra?.includes('蓝'))
      scene.elements = scene.elements.map((e) => ({ ...e, style: { ...e.style, color: '#3B82F6' } }));
    return '```json\n' + JSON.stringify(scene) + '\n```';
  }

  if (task === 'edit') {
    const current = JSON.parse(/当前内容（JSON）：\n([\s\S]*?)\n\n只输出操作列表/.exec(user)?.[1] ?? '{}');
    const instruction = /<instruction>\n([\s\S]*?)\n<\/instruction>/.exec(user)?.[1] ?? '';
    const scenes: Scene[] = current.scene
      ? [current.scene]
      : (current.scenes ?? []).filter((s: Scene) => !s.locked);
    if (wantBroken)
      return JSON.stringify({
        ops: [
          {
            op: 'replaceScene',
            id: scenes[0]?.id,
            scene: {
              ...scenes[0],
              steps: [{ id: 'x', kind: 'play', anims: [{ type: 'Indicate', target: 'nope' }], duration: 1 }],
            },
          },
        ],
      });
    const blue = instruction.includes('蓝');
    const longer = /延长|加长|慢/.test(instruction);
    return JSON.stringify({
      ops: scenes.map((s) => ({
        op: 'replaceScene',
        id: s.id,
        scene: {
          ...s,
          hold: longer ? Math.min(30, s.hold + 2) : s.hold,
          elements: s.elements.map((e) => (blue ? { ...e, style: { ...e.style, color: '#3B82F6' } } : e)),
        },
      })),
    });
  }

  return text.at(-1)?.content ?? '';
}

function toolCall(name: string, args: Record<string, unknown>): ToolCall {
  return { id: `call_${name}`, type: 'function', function: { name, arguments: JSON.stringify(args) } };
}

function numberedBlock(user: string): { n: number; text: string }[] {
  const lines: { n: number; text: string }[] = [];
  let started = false;
  for (const line of user.split('\n')) {
    const match = /^\s*(\d+)\| (.*)$/.exec(line);
    if (!match) {
      if (started) break;
      continue;
    }
    started = true;
    lines.push({ n: Number(match[1]), text: match[2] ?? '' });
  }
  return lines;
}

/** 浏览器里的精确编辑。按指令改一行；颜色题先用过期哈希，逼出重读。 */
function preciseEdit(user: string): { text: string; toolCalls: ToolCall[] } | null {
  if (!user.includes('精确编辑') || !user.includes('base_hash:')) return null;
  const instruction = /"instruction":"([^"]*)"/.exec(user)?.[1] ?? '';
  const sceneId = /"scene_id":"([^"]+)"/.exec(user)?.[1] ?? '';
  const hash = /base_hash: ([0-9a-f]+)/.exec(user)?.[1] ?? '';
  const lines = numberedBlock(user);
  const edit = (line: { n: number; text: string } | undefined, next: string, base: string) => {
    if (!line) return { text: '没有找到要改的行', toolCalls: [toolCall('finish', { summary: '没改' })] };
    return {
      text: '改这一行',
      toolCalls: [
        toolCall('edit_range', {
          scene_id: sceneId,
          base_hash: base,
          start_line: line.n,
          end_line: line.n,
          replacement: next,
        }),
      ],
    };
  };
  if (user.includes('"gate":"pass"'))
    return { text: '改完了', toolCalls: [toolCall('finish', { summary: '改好了' })] };
  if (instruction.includes('颜色') || instruction.includes('蓝')) {
    if (user.includes('"code_numbered"')) {
      const fresh = /"hash":"([0-9a-f]+)"/.exec(user)?.[1] ?? hash;
      const line = lines.find((item) => item.text.includes('#ffffff'));
      return edit(line, line?.text.replace('#ffffff', '#3b82f6') ?? '', fresh);
    }
    if (user.includes('STALE'))
      return { text: '先重读', toolCalls: [toolCall('read_scene', { scene_id: sceneId })] };
    const line = lines.find((item) => item.text.includes('#ffffff'));
    return edit(line, line?.text ?? '', 'stale');
  }
  if (instruction.includes('挪开')) {
    const line = lines.find((item) => item.text.includes(', 220,'));
    return edit(line, line?.text.replace(', 220,', ', 1100,') ?? '', hash);
  }
  if (instruction.includes('慢一点')) {
    const line = lines.find((item) => /wait\(\d+\)/.test(item.text));
    return edit(line, line?.text.replace(/wait\(\d+\)/, 'wait(1600)') ?? '', hash);
  }
  if (instruction.includes('待改')) {
    const line = lines.find((item) => item.text.includes('待改'));
    return edit(line, line?.text.replace('待改', '已改') ?? '', hash);
  }
  const renamed = /改成(\S+)/.exec(instruction)?.[1];
  if (renamed) {
    const line = lines.find((item) => item.text.includes('旧标题') || item.text.includes('head('));
    return edit(line, line?.text.replace(/'[^']*'/, `'${renamed}'`) ?? '', hash);
  }
  return { text: '没有对应的改法', toolCalls: [toolCall('finish', { summary: '没改' })] };
}

export const mockLlm: MockLlm = async (req, emit) => {
  const blob = req.messages.map((m) => messageText(m.content)).join('\n');
  if (blob.includes(WAIT_CANCEL)) {
    for (;;) await emit('…');
  }
  const precise = preciseEdit(blob);
  if (precise) {
    await emit(precise.text);
    return precise;
  }
  const text = answer(req.messages);
  for (let i = 0; i < text.length; i += 40) await emit(text.slice(i, i + 40));
  return text;
};
