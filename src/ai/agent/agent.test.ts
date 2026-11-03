import { createPinia, setActivePinia } from 'pinia';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { platform } from '../../platform';
import { mockPlatform as p, resetMockFs, setMockLlm } from '../../platform/mock';
import type { ChatMessage, ChatReq } from '../../platform/types';
import { emptyStoryboard, newProjectFile } from '../../shared/project';
import { parseStoryboard, type Scene, type Storyboard } from '../../shared/schema';
import { runtimeFlags } from '../../runtime/codeScene';
import { interpret } from '../../runtime/interpret';
import { mockLlm } from '../mockLlm';
import { outlineMessages } from '../prompts';
import { aiSession } from '../session';
import type { Transport } from '../client';
import { useGenerationStore } from '../../stores/generation';
import { useProjectStore } from '../../stores/project';
import { useSettingsStore } from '../../stores/settings';
import { parseRubric } from './apply';
import { dispatchGenerate, usesAgenticEngine } from './engine';
import { runAgent, type AgentHost } from './loop';
import { parseAgentFiles } from './parse';
import { agentSystemPrompt, planRequest } from './prompts';
import { projectAgentHost } from './run';

const INTENT = '祖暅原理：全片只用同一个半径 R';
const PLAN_MARK = '# 祖暅计划';
const MARKER_ASK = 'MARKER_ASK';

const meta = {
  title: 't',
  mode: '2d' as const,
  aspect: '16:9' as const,
  background: '#000000',
  stylePreset: '3b1b' as const,
};

function board(scenes: Scene[]): Storyboard {
  const parsed = parseStoryboard({ schemaVersion: 1, meta, scenes });
  if (!parsed.ok) throw new Error(parsed.issues.map((i) => `${i.path} ${i.message}`).join('; '));
  return parsed.value;
}

const planPack = `先想清楚：两场，共用一个 R。
\`\`\`file:anim/plan.md
${PLAN_MARK}
1. 提出原理
2. 截面
\`\`\`
\`\`\`file:anim/rubric.json
{"title":"祖暅原理","scenes":[{"id":"s_ask","title":"提出原理","description":"说出等高截面","hold":1,"enter":"fresh"},{"id":"s_slice","title":"截面","description":"同一 R","hold":1,"enter":"fresh"}]}
\`\`\`
\`\`\`file:anim/shared.js
const R = 1.2;
\`\`\`
\`\`\`file:anim/scenes/s_ask.js
const decoy = true;
\`\`\``;

const askCode = `const ball = new M.Circle({ radius: R, color: ctx.theme.primary });
await scene.play(new M.Create(ball, { duration: 0.4 }));
// ${MARKER_ASK}`;

const sliceCode = `const lingering = ctx.present();
if (lingering.length) await scene.play(...lingering.map((m) => new M.FadeOut(m, { duration: 0.2 })));
const disk = new M.Circle({ radius: R, color: '#FFFFFF' });
await scene.play(new M.Create(disk, { duration: 0.3 }));`;

const scenesPack = `\`\`\`file:anim/scenes/s_ask.js
${askCode}
\`\`\`
\`\`\`file:anim/scenes/s_slice.js
${sliceCode}
\`\`\``;

function memoryHost(initial: Storyboard) {
  let sb: Storyboard | null = initial;
  const files = new Map<string, string>();
  const log: string[] = [];
  const host: AgentHost = {
    getStoryboard: () => sb,
    updateStoryboard(next) {
      log.push('update');
      sb = next;
    },
    async writeFile(name, text) {
      log.push(`file:${name}`);
      files.set(name, text);
    },
    async readFile(name) {
      return files.get(name) ?? null;
    },
  };
  return {
    host,
    files,
    log,
    get sb() {
      return sb;
    },
  };
}

function scripted(answers: string[]) {
  const calls: { messages: ChatMessage[]; jsonMode: boolean | null | undefined }[] = [];
  const log: string[] = [];
  const transport: Transport = async (messages, opts) => {
    log.push('llm');
    calls.push({ messages: messages.map((m) => ({ ...m })), jsonMode: opts.jsonMode });
    const text = answers.shift();
    if (text === undefined) throw new Error('mock 回答用完了');
    return { text, usage: [10, 10] as [number, number] };
  };
  return { transport, calls, log };
}

function recorder() {
  const waits: number[] = [];
  const plays: unknown[][] = [];
  const rec = {
    async nextSlide() {},
    async wait(duration = 0) {
      waits.push(duration);
    },
    async play(...anims: unknown[]) {
      plays.push(anims);
    },
  };
  return { rec: rec as never, waits, plays };
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

describe('解析', () => {
  it('认分文件代码块、首行注释和裸 JSON', () => {
    const files = parseAgentFiles(
      ['```file:anim/plan.md', '# 计划', '```', '```js', '// anim/shared.js', 'const R = 1.2;', '```'].join(
        '\n',
      ),
    );
    expect(files).toEqual([
      { name: 'plan.md', content: '# 计划' },
      { name: 'shared.js', content: 'const R = 1.2;' },
    ]);
    expect(parseAgentFiles('{"title":"t","scenes":[]}')[0]?.name).toBe('rubric.json');
    expect(parseRubric('{"title":"t","scenes":[{"id":"s_a","title":"A","hold":4,"enter":"keep"}]}')).toEqual({
      title: 't',
      scenes: [{ id: 's_a', title: 'A', description: '', hold: 4, enter: 'keep' }],
    });
  });
});

describe('agent 提示词', () => {
  it('写明代码契约和 S0，不搬 DSL 上限', () => {
    const sys = agentSystemPrompt();
    expect(sys).toContain('async (scene, M, ctx)');
    expect(sys).toContain('scene.add');
    expect(sys).toContain('ctx.present()');
    expect(sys).toContain('浅色字');
    expect(sys).toContain('anim/shared.js');
    expect(sys).not.toContain('只是素材');
    expect(sys).not.toContain('不超过 120');
    expect(sys).not.toContain('maxElements');
    expect(planRequest(INTENT)).toContain(INTENT);
  });
});

describe('agent loop', () => {
  it('需求原文在每轮请求里，plan 先于场景，写入后可 interpret', async () => {
    const mem = memoryHost(board([]));
    const script = scripted([planPack, scenesPack]);
    const result = await runAgent({
      intent: INTENT,
      transport: (messages, opts) => {
        mem.log.push('llm');
        return script.transport(messages, opts);
      },
      host: mem.host,
    });
    expect(result.status).toBe('done');
    expect(result.sceneIds).toEqual(['s_ask', 's_slice']);
    expect(script.calls.length).toBe(2);
    for (const call of script.calls) {
      expect(call.messages.map((m) => m.content).join('\n')).toContain(INTENT);
      expect(call.jsonMode).toBeNull();
    }
    expect(script.calls[0]!.messages.map((m) => m.content).join('\n')).not.toContain(PLAN_MARK);
    expect(script.calls[1]!.messages.map((m) => m.content).join('\n')).toContain(PLAN_MARK);
    const planAt = mem.log.indexOf('file:plan.md');
    const updateAt = mem.log.indexOf('update');
    const llms = mem.log.flatMap((e, i) => (e === 'llm' ? [i] : []));
    expect(llms[0]).toBeLessThan(planAt);
    expect(planAt).toBeLessThan(llms[1]!);
    expect(llms[1]).toBeLessThan(updateAt);
    expect(mem.files.get('plan.md')).toContain(PLAN_MARK);
    expect(mem.files.get('shared.js')).toContain('const R = 1.2');
    const scenes = mem.sb!.scenes;
    expect(scenes.map((s) => s.kind)).toEqual(['code', 'code']);
    expect(scenes[0]!.code).toContain('const R = 1.2');
    expect(scenes[1]!.code).toContain('const R = 1.2');
    expect(scenes[0]!.code!.split('const R').length - 1).toBe(1);
    expect(scenes[0]!.code).toContain(MARKER_ASK);
    expect(scenes[0]!.code).not.toContain('decoy');
    expect(mem.sb!.meta.title).toBe('祖暅原理');

    runtimeFlags.codeScenes = true;
    const { rec, plays } = recorder();
    const errors: { message: string }[] = [];
    await interpret(mem.sb!, rec, (e) => errors.push(e));
    expect(errors).toEqual([]);
    expect(plays).toHaveLength(2);
  });

  it('后一轮能看见 plan 和已经写好的场景', async () => {
    const mem = memoryHost(board([]));
    const script = scripted([
      planPack,
      `\`\`\`file:anim/scenes/s_ask.js\n${askCode}\n\`\`\``,
      `\`\`\`file:anim/scenes/s_slice.js\n${sliceCode}\n\`\`\``,
    ]);
    const result = await runAgent({ intent: INTENT, transport: script.transport, host: mem.host });
    expect(result.status).toBe('done');
    expect(script.calls).toHaveLength(3);
    const third = script.calls[2]!.messages.map((m) => m.content).join('\n');
    expect(third).toContain(INTENT);
    expect(third).toContain(PLAN_MARK);
    expect(third).toContain(MARKER_ASK);
    expect(script.calls[1]!.messages.map((m) => m.content).join('\n')).not.toContain(MARKER_ASK);
  });

  it('不覆盖 locked，也不删掉计划外的场景', async () => {
    const locked = 'await scene.wait(0.2);';
    const mem = memoryHost(
      board([
        {
          id: 's_ask',
          title: '不要动',
          description: 'locked',
          kind: 'code',
          enter: 'fresh',
          hold: 1,
          locked: true,
          elements: [],
          steps: [],
          code: locked,
        },
        {
          id: 's_other',
          title: '别删',
          description: '留下',
          kind: 'dsl',
          enter: 'fresh',
          hold: 1,
          elements: [{ id: 'c', type: 'Circle', props: { radius: 1 } }],
          steps: [{ id: 'p', kind: 'play', anims: [{ type: 'Create', target: 'c' }], duration: 1 }],
        },
      ]),
    );
    const script = scripted([planPack, scenesPack]);
    const result = await runAgent({ intent: INTENT, transport: script.transport, host: mem.host });
    expect(result.status).toBe('done');
    expect(result.skippedLocked).toEqual(['s_ask']);
    expect(result.sceneIds).toEqual(['s_slice']);
    const scenes = mem.sb!.scenes;
    expect(scenes.map((s) => s.id)).toEqual(['s_ask', 's_other', 's_slice']);
    expect(scenes[0]).toMatchObject({ locked: true, kind: 'code', code: locked, title: '不要动' });
    expect(scenes[1]).toMatchObject({ kind: 'dsl', title: '别删' });
    expect(scenes[1]!.elements).toHaveLength(1);
    expect(scenes[2]).toMatchObject({ kind: 'code', id: 's_slice' });
    expect(scenes[2]!.code).toContain('const R = 1.2');
  });

  it('取消和预算会停住，且不再写场景', async () => {
    const early = new AbortController();
    early.abort();
    const skipped = memoryHost(board([]));
    const skippedScript = scripted([planPack, scenesPack]);
    const skippedRun = await runAgent({
      intent: INTENT,
      transport: skippedScript.transport,
      host: skipped.host,
      signal: early.signal,
    });
    expect(skippedRun).toMatchObject({ status: 'cancelled', turns: 0 });
    expect(skippedScript.calls).toHaveLength(0);
    expect(skipped.log).not.toContain('update');

    const mid = new AbortController();
    const midMem = memoryHost(board([]));
    const midScript = scripted([planPack, scenesPack]);
    midMem.host.writeFile = async (name, text) => {
      midMem.log.push(`file:${name}`);
      midMem.files.set(name, text);
      if (name === 'plan.md') mid.abort();
    };
    const midRun = await runAgent({
      intent: INTENT,
      transport: midScript.transport,
      host: midMem.host,
      signal: mid.signal,
    });
    expect(midRun.status).toBe('cancelled');
    expect(midScript.calls).toHaveLength(1);
    expect(midMem.log).not.toContain('update');
    expect(midMem.sb!.scenes).toEqual([]);

    let n = 0;
    const thrown = memoryHost(board([]));
    const thrownRun = await runAgent({
      intent: INTENT,
      transport: async (messages, opts) => {
        n += 1;
        if (n === 1) return scripted([planPack]).transport(messages, opts);
        throw { code: 'cancelled', message: '已取消' };
      },
      host: thrown.host,
    });
    expect(thrownRun.status).toBe('cancelled');
    expect(thrown.files.has('plan.md')).toBe(true);
    expect(thrown.log).not.toContain('update');

    const turnMem = memoryHost(board([]));
    const turnScript = scripted([planPack, scenesPack]);
    const turnRun = await runAgent({
      intent: INTENT,
      transport: turnScript.transport,
      host: turnMem.host,
      budget: { maxTurns: 1 },
    });
    expect(turnRun.status).toBe('budget');
    expect(turnScript.calls).toHaveLength(1);
    expect(turnMem.files.has('plan.md')).toBe(true);
    expect(turnMem.log).not.toContain('update');

    const tokenMem = memoryHost(board([]));
    const tokenTransport: Transport = async (messages, opts) => {
      void messages;
      tokenMem.log.push('llm');
      opts.onDelta('');
      return {
        text: tokenMem.log.filter((e) => e === 'llm').length === 1 ? planPack : scenesPack,
        usage: [4, 4],
      };
    };
    const tokenRun = await runAgent({
      intent: INTENT,
      transport: tokenTransport,
      host: tokenMem.host,
      budget: { maxTurns: 8, maxTokens: 5 },
    });
    expect(tokenRun.status).toBe('budget');
    expect(tokenRun.usage).toEqual([4, 4]);
    expect(tokenMem.log.filter((e) => e === 'llm')).toHaveLength(1);
    expect(tokenMem.log).not.toContain('update');
  });

  it('经 project.update 写入 .awb/anim，并且可以撤销', async () => {
    const project = useProjectStore();
    await project.create('agent', emptyStoryboard('agent'), '/projects/agent');
    const before = structuredClone(project.storyboard);
    const script = scripted([planPack, scenesPack]);
    const result = await runAgent({
      intent: INTENT,
      transport: script.transport,
      host: projectAgentHost(),
    });
    expect(result.status).toBe('done');
    expect(await p.readText('/projects/agent/.awb/anim/plan.md')).toContain(PLAN_MARK);
    expect(await p.readText('/projects/agent/.awb/anim/shared.js')).toContain('const R = 1.2');
    expect(await p.readText('/projects/agent/.awb/anim/scenes/s_ask.js')).toContain(MARKER_ASK);
    expect(project.storyboard!.scenes).toHaveLength(2);
    expect(project.storyboard!.scenes.every((s) => s.kind === 'code')).toBe(true);
    expect(project.canUndo).toBe(true);
    project.undo();
    expect(project.storyboard).toEqual(before);
    expect(await platform.exists('/projects/agent/.awb/anim/plan.md')).toBe(true);
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
      .map((m) => m.content)
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
