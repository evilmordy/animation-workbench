import fixture from '../../tests/fixtures/pythagoras.json';
import type { MockLlm } from '../platform/mock';
import type { ChatMessage } from '../platform/types';
import type { Scene, Storyboard } from '../shared/schema';
import { taskOf } from './prompts';

/**
 * 浏览器模式（pnpm dev / e2e）下的假 LLM：按任务类型返回基于附录 A 的合法回答。
 * 素材或指令里含"【测试：需要修复】"时第一次故意给出不合格的输出，用来走通自动修复。
 */

const sb = fixture as Storyboard;
const NEEDS_REPAIR = '【测试：需要修复】';
const last = (m: ChatMessage[]) => m[m.length - 1]!.content;

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

function answer(messages: ChatMessage[]): string {
  const task = taskOf(messages);
  const user = messages[1]?.content ?? '';
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

  return last(messages);
}

export const mockLlm: MockLlm = async (req, emit) => {
  const text = answer(req.messages);
  for (let i = 0; i < text.length; i += 40) await emit(text.slice(i, i + 40));
  return text;
};
