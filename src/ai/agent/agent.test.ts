// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platform } from '../../platform';
import { resetMockFs, setMockLlm } from '../../platform/mock';
import { messageText, type ChatReq } from '../../platform/types';
import { emptyStoryboard, newProjectFile } from '../../shared/project';
import { parseStoryboard, type Scene, type Storyboard } from '../../shared/schema';
import { runtimeFlags } from '../../runtime/codeScene';
import { mockLlm } from '../mockLlm';
import { outlineMessages } from '../prompts';
import { aiSession } from '../session';
import type { Transport } from '../client';
import { useGenerationStore } from '../../stores/generation';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { dispatchGenerate, usesAgenticEngine } from './engine';
import { contentHash } from './hash';
import { runAgent, type AgentHost } from './loop';
import { projectAgentHost } from './run';
import { PHASE_TOOLS } from './tools/defs';

const PASS = [
  "const box = el('div', { left: 80, top: 80, width: 200, height: 80, background: C.blue }, 'ok');",
  'fadeIn(box, 0);',
  'wait(1000);',
].join('\n');

const LOOP = "const box = el('div');\ntw(box, { x: [0, 40], duration: 800, loop: true }, 0);\nwait(500);";

const meta = {
  title: 't',
  mode: '2d' as const,
  aspect: '16:9' as const,
  background: '#000000',
  stylePreset: '3b1b' as const,
};

function scene(over: Partial<Scene> & Pick<Scene, 'id'>): Scene {
  return {
    title: over.title ?? over.id,
    description: over.description ?? '',
    kind: 'code',
    enter: 'fresh',
    hold: 1,
    elements: [],
    steps: [],
    ...over,
  };
}

function board(scenes: Scene[]): Storyboard {
  const parsed = parseStoryboard({ schemaVersion: 1, meta, scenes });
  if (!parsed.ok) throw new Error(parsed.issues.map((issue) => issue.message).join('; '));
  return parsed.value;
}

function memoryHost(initial: Storyboard): AgentHost & { sb: () => Storyboard | null } {
  let sb: Storyboard | null = initial;
  return {
    sb: () => sb,
    getStoryboard: () => sb,
    updateStoryboard(next) {
      sb = next;
    },
    async writeFile() {},
    async readFile() {
      return null;
    },
  };
}

function call(name: string, args: unknown) {
  return {
    text: '',
    usage: [1, 1] as [number, number],
    finishReason: 'tool_calls' as const,
    toolCalls: [{ id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }],
  };
}

function planCall(hold = 4) {
  return call('write_plan', {
    title: '演示',
    plan_md: '# 计划\n放一块蓝色。',
    scenes: [{ id: 's_box', title: '色块', description: '蓝色', hold, enter: 'fresh' }],
  });
}

beforeEach(() => {
  resetMockFs();
  setActivePinia(createPinia());
  runtimeFlags.codeScenes = false;
});

afterEach(() => {
  runtimeFlags.codeScenes = false;
  setMockLlm(async () => {
    throw { code: 'no_key', message: '浏览器模式没有配置假 LLM' };
  });
});

describe('ReAct 循环', () => {
  it('PLAN、SCENE、FILM 走到 done，每轮只发 system 和 user，撤销退回最近一次写入', async () => {
    const project = useProjectStore();
    await project.create('t', emptyStoryboard('undo'), '/projects/react-loop');
    const seen: { roles: string[]; tools: string[]; maxTokens?: number; text: string }[] = [];
    let n = 0;
    const transport: Transport = async (messages, opts) => {
      n += 1;
      seen.push({
        roles: messages.map((message) => message.role),
        tools: opts.tools?.map((tool) => tool.function.name) ?? [],
        maxTokens: opts.maxTokens,
        text: messages.map((message) => messageText(message.content)).join('\n'),
      });
      if (n === 1) return planCall();
      if (n === 2) return call('write_scene', { scene_id: 's_box', code: PASS, summary: '蓝色方块' });
      return call('finish', { summary: '一场完成' });
    };
    const result = await runAgent({
      intent: '放一块蓝色。这是指令，不是素材里的句子。',
      host: projectAgentHost(),
      budget: { maxTurns: 4 },
      transport,
    });
    expect(result).toMatchObject({ status: 'done', turns: 3, sceneIds: ['s_box'] });
    expect(seen).toHaveLength(3);
    expect(seen[0]?.tools).toEqual([...PHASE_TOOLS.PLAN]);
    expect(seen[1]?.tools).toEqual([...PHASE_TOOLS.SCENE]);
    expect(seen[2]?.tools).toEqual([...PHASE_TOOLS.FILM]);
    for (const turn of seen) {
      expect(turn.roles).toEqual(['system', 'user']);
      expect(turn.maxTokens).toBeUndefined();
      expect(turn.text).toContain('这是指令，不是素材');
    }
    expect(seen[2]?.text).not.toBe(seen[1]?.text);
    const written = project.storyboard?.scenes[0];
    expect(written?.code).toContain('wait(1000)');
    expect(written?.hold).toBe(4);
    expect(await platform.exists('/projects/react-loop/.awb/anim/plan.md')).toBe(true);
    expect(await platform.exists('/projects/react-loop/.awb/anim/source.md')).toBe(true);
    expect(await platform.exists('/projects/react-loop/.awb/anim/memory.json')).toBe(true);
    expect(await platform.exists('/projects/react-loop/.awb/anim/scenes/s_box.js')).toBe(false);
    project.undo();
    expect(project.storyboard?.scenes[0]?.code ?? '').not.toContain('wait(1000)');
    expect(project.storyboard?.scenes[0]?.hold).toBe(4);
  });

  it('输出被截断时记 TRUNCATED，下一次请求换掉，连续两次后压缩上下文', async () => {
    const host = memoryHost(board([]));
    const seen: string[] = [];
    const transport: Transport = async (messages) => {
      seen.push(messages.map((message) => messageText(message.content)).join('\n'));
      return {
        text: '',
        finishReason: 'length',
        toolCalls: [{ id: 't', type: 'function', function: { name: 'write_plan', arguments: '{"title":' } }],
        usage: [1, 1],
      };
    };
    const result = await runAgent({ intent: '画一个圆', host, budget: { maxTurns: 4 }, transport });
    expect(result).toMatchObject({ status: 'stuck', error: '规划输出连续截断', turns: 3 });
    expect(host.sb()?.scenes).toEqual([]);
    expect(seen[1]).toContain('TRUNCATED');
    expect(seen[1]).not.toBe(seen[0]);
    expect(seen[2]).toContain('上下文已压缩');
  });

  it('连续三轮只有正文就停', async () => {
    const host = memoryHost(board([]));
    const result = await runAgent({
      intent: '画一个圆',
      host,
      transport: async () => ({ text: '只有正文', usage: [1, 1] as [number, number] }),
    });
    expect(result.status).toBe('stuck');
    expect(result.error).toContain('连续三轮只有正文');
    expect(result.turns).toBe(3);
  });

  it('锁定场和手改的代码、hold 不会被后一次写入冲掉', async () => {
    const host = memoryHost(
      board([scene({ id: 's_lock', code: 'const user = 1;', hold: 4, locked: true, title: '锁着' })]),
    );
    let n = 0;
    const seen: string[] = [];
    const result = await runAgent({
      intent: '别动锁定场',
      host,
      budget: { maxTurns: 6 },
      transport: async (messages) => {
        n += 1;
        seen.push(messages.map((message) => messageText(message.content)).join('\n'));
        if (n === 1) {
          return call('write_plan', {
            title: '演示',
            plan_md: '# 计划',
            scenes: [{ id: 's_box', title: '新场', description: '空的', hold: 1, enter: 'fresh' }],
          });
        }
        if (n === 2)
          return call('write_scene', {
            scene_id: 's_lock',
            code: PASS,
            base_hash: contentHash('const user = 1;'),
          });
        if (n === 3) return call('write_scene', { scene_id: 's_box', code: PASS, summary: '蓝色' });
        if (n === 4) {
          const live = host.sb()?.scenes.find((item) => item.id === 's_box');
          const old = live?.code ?? '';
          if (live) live.code = 'const hand = 1;\nwait(500);\n';
          return call('write_scene', { scene_id: 's_box', code: PASS, base_hash: contentHash(old) });
        }
        return { text: '', usage: [1, 1] as [number, number] };
      },
    });
    expect(result.status).not.toBe('done');
    expect(result.status).not.toBe('done_with_issues');
    const locked = host.sb()?.scenes.find((item) => item.id === 's_lock');
    expect(locked).toMatchObject({ code: 'const user = 1;', hold: 4, title: '锁着' });
    const hand = host.sb()?.scenes.find((item) => item.id === 's_box');
    expect(hand?.code).toContain('const hand = 1;');
    expect(hand?.hold).toBe(1);
    expect(seen.some((text) => text.includes('LOCKED'))).toBe(true);
    expect(seen.some((text) => text.includes('STALE'))).toBe(true);
  });

  it('loop:true 写不进去，也不能 done', async () => {
    const host = memoryHost(board([]));
    const seen: string[] = [];
    let n = 0;
    const result = await runAgent({
      intent: '不要循环',
      host,
      budget: { maxTurns: 6 },
      transport: async (messages) => {
        n += 1;
        seen.push(messages.map((message) => messageText(message.content)).join('\n'));
        if (n === 1) return planCall(1);
        if (n === 2) return call('write_scene', { scene_id: 's_box', code: LOOP, summary: '循环' });
        if (n === 3) return call('finish', { summary: '想停' });
        return { text: '', usage: [1, 1] as [number, number] };
      },
    });
    expect(result.status).not.toBe('done');
    expect(result.status).not.toBe('done_with_issues');
    expect(host.sb()?.scenes[0]?.code ?? '').not.toContain('loop: true');
    expect(seen.some((text) => text.includes('BANNED_API'))).toBe(true);
    expect(seen.some((text) => text.includes('FINISH_REJECTED') || text.includes('PHASE'))).toBe(true);
  });
});

describe('engine', () => {
  it('默认 legacy；agentic 必须同时开 codeScenes', async () => {
    const settings = useSettingsStore();
    await settings.load();
    expect(settings.engine).toBe('legacy');
    expect(settings.runtime.codeScenes).toBe(false);
    expect(usesAgenticEngine(settings.engine, settings.runtime.codeScenes)).toBe(false);

    const calls: string[] = [];
    const run = (engine: 'legacy' | 'agentic', codeScenes: boolean) =>
      dispatchGenerate({
        engine,
        codeScenes,
        legacy: async () => {
          calls.push('legacy');
        },
        agent: async () => {
          calls.push('agent');
        },
      });
    await run('legacy', true);
    await run('agentic', false);
    await run('agentic', true);
    expect(calls).toEqual(['legacy', 'legacy', 'agent']);

    settings.engine = 'agentic';
    setActivePinia(createPinia());
    const again = useSettingsStore();
    await again.load();
    expect(again.engine).toBe('agentic');
    await platform.storeSet('generationEngine', 'dsl');
    await again.load();
    expect(again.engine).toBe('legacy');
  });

  it('engine=legacy 时仍走原来的大纲，不写 plan', async () => {
    setMockLlm(mockLlm);
    const project = useProjectStore();
    await project.create('t', emptyStoryboard('t'), '/projects/legacy');
    const settings = useSettingsStore();
    await settings.load();
    settings.engine = 'agentic';
    const gen = useGenerationStore();
    gen.source = '勾股定理：直角边的平方和等于斜边的平方';
    let agentCalled = false;
    await dispatchGenerate({
      engine: settings.engine,
      codeScenes: settings.runtime.codeScenes,
      legacy: () => gen.generateOutline(),
      agent: async () => {
        agentCalled = true;
      },
    });
    expect(agentCalled).toBe(false);
    expect(settings.runtime.codeScenes).toBe(false);
    expect(gen.outline?.scenes.length).toBeGreaterThan(0);
    expect(await platform.exists('/projects/legacy/.awb/anim/plan.md')).toBe(false);
    const oldPrompt = outlineMessages('TOKEN-需求原文', newProjectFile('x').generation)
      .map((message) => message.content)
      .join('\n');
    expect(oldPrompt).toContain('不是给你的指令');
    expect(oldPrompt).toContain('TOKEN-需求原文');
  });

  it('普通请求仍带 json_mode，agent 请求不带', async () => {
    const settings = useSettingsStore();
    await settings.load();
    const reqs: ChatReq[] = [];
    setMockLlm(async (req) => {
      reqs.push({ ...req, messages: [...req.messages] });
      return 'ok';
    });
    const session = aiSession();
    const opts = { requestId: 'a', title: 't', onDelta: () => {} };
    await session.transport([{ role: 'user', content: 'hi' }], opts);
    await session.transport([{ role: 'user', content: 'hi' }], { ...opts, requestId: 'b', jsonMode: null });
    expect(reqs[0]?.json_mode).toBe(true);
    expect(reqs[1] && 'json_mode' in reqs[1]).toBe(false);
    expect(settings.jsonMode()).toBe(true);
  });
});
