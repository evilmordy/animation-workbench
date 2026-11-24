// @vitest-environment happy-dom
import { createPinia, setActivePinia } from 'pinia';
import { beforeEach, describe, expect, it } from 'vitest';
import { resetMockFs } from '../../platform/mock';
import { messageText } from '../../platform/types';
import type { Transport } from '../client';
import { emptyStoryboard } from '../../shared/project';
import { parseStoryboard, type Scene, type Storyboard } from '../../shared/schema';
import type { Issue } from './check';
import { sceneTrace } from './check/gate';
import { encodePng, solidRaster } from './check/pixels';
import { projectContext } from './context';
import { contentHash } from './hash';
import { runAgent, type AgentHost } from './loop';
import { blankMemory, openMemory } from './memory';
import { projectAgentHost } from './run';
import { durationNote, editRequests, frameTimes, indexCalls, outsideNote, outsideTimes } from './precise';
import { executeTool, type ToolEnv } from './tools/run';

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
    description: '',
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

function hostOf(initial: Storyboard): AgentHost & { sb: () => Storyboard | null; updates: number } {
  let sb: Storyboard | null = initial;
  const host: AgentHost & { sb: () => Storyboard | null; updates: number } = {
    updates: 0,
    sb: () => sb,
    getStoryboard: () => sb,
    updateStoryboard(next) {
      host.updates += 1;
      sb = next;
    },
    async writeFile() {},
    async readFile() {
      return null;
    },
  };
  return host;
}

function call(name: string, args: unknown) {
  return {
    text: '',
    usage: [1, 1] as [number, number],
    finishReason: 'tool_calls' as const,
    toolCalls: [{ id: name, type: 'function' as const, function: { name, arguments: JSON.stringify(args) } }],
  };
}

function issue(over: Pick<Issue, 'id' | 'scene_id' | 'kind'> & { text: string }): Issue {
  return {
    ...over,
    severity: 'major',
    evidence: { text: over.text },
    fingerprint: over.id,
    first_turn: 1,
    last_turn: 1,
    attempts: 1,
    status: 'open',
  };
}

const SPANS = [
  { id: 's1', start: 0, end: 2 },
  { id: 's2', start: 2, end: 4 },
];

describe('精确编辑请求', () => {
  it('跨场区间拆开，点和元素只挂在暂停所在的场', () => {
    const requests = editRequests({
      spans: SPANS,
      time: 1.2,
      range: [1, 3],
      point: { x: 10, y: 20 },
      element: { tag: 'div', text: '甲', bbox: [1, 2, 3, 4], awb_n: 2 },
      instruction: ' 挪开 ',
    });
    expect(requests.map((item) => item.scene_id)).toEqual(['s1', 's2']);
    expect(requests[0]).toMatchObject({
      range_ms: [1000, 2000],
      point: { x: 10, y: 20 },
      element: { awb_n: 2 },
    });
    expect(requests[1]?.point).toBeUndefined();
    expect(requests[1]?.element).toBeUndefined();
    expect(requests[1]?.range_ms).toEqual([0, 1000]);
    expect(requests[0]?.instruction).toBe('挪开');
  });

  it('点在两场交界上时归下一场，单帧区间两端相等', () => {
    const requests = editRequests({
      spans: SPANS,
      time: 2,
      range: null,
      instruction: '改',
    });
    expect(requests).toEqual([{ scene_id: 's2', range_ms: [0, 0], instruction: '改' }]);
  });

  it('区间等分 4 张，单帧再取前后 300ms', () => {
    expect(frameTimes([0, 900], 900)).toEqual([0, 300, 600, 900]);
    expect(frameTimes([100, 100], 2000)).toEqual([0, 100, 400]);
    expect(outsideTimes([400, 800], 2000, [400, 800])).toEqual([200, 1400]);
  });

  it('行号和 data-awb-n 按源码顺序对上，共享块折成一行', async () => {
    const code = "txt('甲', 10, 10, 32);\ntxt('乙', 220, 20, 32);\nwait(800);";
    const traced = await sceneTrace(code);
    const calls = indexCalls(code, traced.trace);
    expect(calls.find((item) => item.text.includes('乙'))).toMatchObject({ line: 2, n: 2 });
    expect(calls.find((item) => item.name === 'wait')).toMatchObject({ line: 3, start: 0, end: 800 });

    const shared = '/* @awb-shared */\nconst MARK = 1;\n/* @awb-shared-end */\nwait(500);';
    expect(
      indexCalls(shared, [{ kind: 'call', name: 'wait', start: 0, end: 500 }]).map((item) => item.line),
    ).toEqual([2]);
  });

  it('时长变化和区间外差异写进说明', () => {
    expect(durationNote(800, 1600)).toBe('本场时长 800ms → 1600ms，后面的场会整体后移');
    expect(durationNote(800, 800)).toBe('');
    const before = solidRaster(8, 8, { r: 0, g: 0, b: 0 });
    const after = solidRaster(8, 8, { r: 0, g: 0, b: 0 });
    after.rgba[0] = 255;
    after.rgba[3] = 255;
    expect(outsideNote([{ tMs: 900, before, after }])).toContain('局部');
    expect(outsideNote([{ tMs: 900, before, after: before }])).toContain('没有差异');
    expect(outsideNote([{ tMs: 900 }])).toContain('没有像素可对');
  });
});

describe('EDIT 上下文', () => {
  it('只给目标场的代码、问题和原文，写后的对比帧换掉改前帧', () => {
    const sb = board([
      scene({ id: 's1', code: "txt('目标', 1, 1, 32);\nwait(400);" }),
      scene({ id: 's2', code: 'const SECRET_OTHER = 1;\nwait(400);' }),
    ]);
    const mem = blankMemory();
    mem.plan = 'PLAN_SECRET';
    mem.issues = [
      issue({ id: 'I1', scene_id: 's1', kind: 'LAYOUT_OVERLAP', text: '目标场问题甲' }),
      issue({ id: 'I2', scene_id: 's2', kind: 'CONTENT', text: '别的场问题乙' }),
    ];
    const messages = projectContext({
      phase: 'EDIT',
      mem,
      storyboard: sb,
      intent: 'INTENT_KEEP',
      source: 'SOURCE_SECRET',
      system: 'SYSTEM',
      edit: {
        sceneId: 's1',
        instruction: '改标题',
        request: { scene_id: 's1', range_ms: [0, 0], instruction: '改标题' },
        frames: [{ dataUrl: 'data:image/png;base64,BB', caption: '目标区间 0ms' }],
      },
    });
    const text = messages.map((message) => messageText(message.content)).join('\n');
    expect(text).toContain('INTENT_KEEP');
    expect(text).toContain('目标');
    expect(text).toContain('目标场问题甲');
    expect(text).toContain(`base_hash: ${contentHash(sb.scenes[0]?.code ?? '')}`);
    expect(text).not.toContain('SECRET_OTHER');
    expect(text).not.toContain('PLAN_SECRET');
    expect(text).not.toContain('SOURCE_SECRET');
    expect(text).not.toContain('别的场问题乙');
    expect(JSON.stringify(messages)).toContain('data:image/png;base64,BB');

    mem.turns.push({
      turn: 1,
      line: '改完',
      detail: '{"gate":"pass"}',
      images: [{ dataUrl: 'data:image/png;base64,QQ', caption: '改后 0ms' }],
    });
    const next = projectContext({
      phase: 'EDIT',
      mem,
      storyboard: sb,
      intent: 'INTENT_KEEP',
      source: 'SOURCE_SECRET',
      system: 'SYSTEM',
      edit: {
        sceneId: 's1',
        instruction: '改标题',
        request: { scene_id: 's1', range_ms: [0, 0], instruction: '改标题' },
        frames: [{ dataUrl: 'data:image/png;base64,BB', caption: '目标区间 0ms' }],
      },
    });
    const packed = JSON.stringify(next);
    expect(packed).toContain('data:image/png;base64,QQ');
    expect(packed).not.toContain('data:image/png;base64,BB');
  });
});

describe('精确编辑循环', () => {
  const color = "const kept = 1;\ntxt('色块', 80, 80, 48, '#ffffff');\nwait(800);";

  it('锁定场和分镜场不调用模型，空需求在精确编辑里可以走', async () => {
    const locked = hostOf(board([scene({ id: 's', code: color, locked: true })]));
    let calls = 0;
    const transport: Transport = async () => {
      calls += 1;
      throw new Error('不该调用');
    };
    const denied = await runAgent({
      intent: '改颜色',
      host: locked,
      budget: { maxTurns: 4 },
      edit: {
        sceneId: 's',
        instruction: '改颜色',
        request: { scene_id: 's', range_ms: [0, 0], instruction: '改颜色' },
      },
      transport,
    });
    expect(calls).toBe(0);
    expect(denied).toMatchObject({ status: 'error', error: '这一场锁着' });
    expect(locked.sb()?.scenes[0]?.code).toBe(color);

    const dsl = hostOf(board([scene({ id: 's', kind: 'dsl', code: '' })]));
    const refused = await runAgent({
      intent: '',
      host: dsl,
      budget: { maxTurns: 2 },
      edit: {
        sceneId: 's',
        instruction: '改',
        request: { scene_id: 's', range_ms: [0, 0], instruction: '改' },
      },
      transport,
    });
    expect(calls).toBe(0);
    expect(refused.error).toBe('这一场还是分镜，精确编辑只改代码场');
  });

  it('base_hash 不对就先重读，手改的 hold 和代码留着，只写一次', async () => {
    const host = hostOf(board([scene({ id: 's', code: color, hold: 2.5 })]));
    const seen: string[] = [];
    const transport: Transport = async (messages) => {
      const text = messages.map((message) => messageText(message.content)).join('\n');
      seen.push(text);
      if (text.includes('"gate":"pass"')) return call('finish', { summary: '改好了' });
      if (text.includes('"code_numbered"') || text.includes('code_numbered')) {
        const hash = /"hash":"([0-9a-f]+)"/.exec(text)?.[1] ?? '';
        const line = text.split('\n').find((item) => item.includes('#ffffff'));
        const n = Number(/(\d+)\|/.exec(line ?? '')?.[1] ?? 0);
        const next = (line ?? '').replace(/^\s*\d+\| /, '').replace('#ffffff', '#3b82f6');
        return call('edit_range', {
          scene_id: 's',
          base_hash: hash,
          start_line: n,
          end_line: n,
          replacement: next,
        });
      }
      if (text.includes('STALE')) return call('read_scene', { scene_id: 's' });
      return call('edit_range', {
        scene_id: 's',
        base_hash: 'stale',
        start_line: 2,
        end_line: 2,
        replacement: "txt('色块', 80, 80, 48, '#ffffff');",
      });
    };
    const result = await runAgent({
      intent: '把这块改成蓝色',
      host,
      budget: { maxTurns: 6 },
      edit: {
        sceneId: 's',
        instruction: '把颜色改成蓝色',
        request: { scene_id: 's', range_ms: [0, 400], instruction: '把颜色改成蓝色' },
      },
      transport,
    });
    expect(result.status === 'done' || result.status === 'done_with_issues').toBe(true);
    expect(seen[1]).toContain('STALE');
    expect(seen[2]).toContain('hash');
    expect(host.updates).toBe(1);
    const next = host.sb()?.scenes[0];
    expect(next?.hold).toBe(2.5);
    expect(next?.code).toContain('const kept = 1');
    expect(next?.code).toContain('#3b82f6');
    expect(next?.code).not.toContain('#ffffff');
  });

  it('改完把同一区间的改前改后交给模型，撤销只退这一步', async () => {
    const code = "txt('旧标题', 80, 80, 64);\nwait(1000);";
    const host = hostOf(board([scene({ id: 's', code, hold: 0 })]));
    let step = 0;
    const transport: Transport = async (messages) => {
      step += 1;
      const text = messages.map((message) => messageText(message.content)).join('\n');
      if (step === 1) {
        expect(text).not.toContain('SECRET_OTHER');
        const hash = /base_hash: ([0-9a-f]+)/.exec(text)?.[1] ?? '';
        return call('edit_range', {
          scene_id: 's',
          base_hash: hash,
          start_line: 1,
          end_line: 1,
          replacement: "txt('直角', 80, 80, 64);",
        });
      }
      const packed = JSON.stringify(messages);
      expect(packed).toContain('改前');
      expect(packed).toContain('改后');
      return call('finish', { summary: '改好了' });
    };
    const before = solidRaster(4, 4, { r: 0, g: 0, b: 0 });
    const after = solidRaster(4, 4, { r: 20, g: 20, b: 20 });
    const png = encodePng(before);
    const result = await runAgent({
      intent: '把标题改成直角',
      host,
      budget: { maxTurns: 4 },
      inspect: async (_sb, req) => ({
        issues: [],
        frames: (req.frames?.[0]?.timesMs ?? []).map((tMs) => ({
          tMs,
          caption: `${tMs}`,
          png,
          raster: tMs === (req.frames?.[0]?.timesMs.at(-1) ?? -1) ? after : before,
          boxes: 0,
        })),
      }),
      edit: {
        sceneId: 's',
        instruction: '把标题改成直角',
        request: { scene_id: 's', range_ms: [0, 400], instruction: '把标题改成直角' },
      },
      transport,
    });
    expect(result.status === 'done' || result.status === 'done_with_issues').toBe(true);
    expect(host.updates).toBe(1);
    expect(host.sb()?.scenes[0]?.code).toContain('直角');
  });
});

describe('一步撤销', () => {
  beforeEach(() => {
    resetMockFs();
    setActivePinia(createPinia());
  });

  it('一次 edit_range 是一次 project.update', async () => {
    const { useProjectStore } = await import('../../stores/project');
    const project = useProjectStore();
    await project.create('t', emptyStoryboard('undo'), '/projects/precise-edit');
    const code = "txt('旧标题', 80, 80, 64);\nwait(1000);";
    const initial = board([scene({ id: 's', code, hold: 0 })]);
    project.update(initial);
    const host = projectAgentHost();
    let updates = 0;
    const update = host.updateStoryboard;
    host.updateStoryboard = (next) => {
      updates += 1;
      update(next);
    };
    const transport: Transport = async (messages) => {
      const text = messages.map((message) => messageText(message.content)).join('\n');
      if (text.includes('"gate":"pass"')) return call('finish', { summary: '改好了' });
      const hash = /base_hash: ([0-9a-f]+)/.exec(text)?.[1] ?? '';
      return call('edit_range', {
        scene_id: 's',
        base_hash: hash,
        start_line: 1,
        end_line: 1,
        replacement: "txt('直角', 80, 80, 64);",
      });
    };
    await runAgent({
      intent: '把标题改成直角',
      host,
      budget: { maxTurns: 4 },
      edit: {
        sceneId: 's',
        instruction: '把标题改成直角',
        request: { scene_id: 's', range_ms: [0, 0], instruction: '把标题改成直角' },
      },
      transport,
    });
    expect(updates).toBe(1);
    expect(project.storyboard?.scenes[0]?.code).toContain('直角');
    project.undo();
    expect(project.storyboard?.scenes[0]?.code).toContain('旧标题');
    expect(project.storyboard?.scenes[0]?.code).not.toContain('直角');
  });
});

describe('写后对比', () => {
  it('观察里带新旧时长和区间外差异，改前改后成对', async () => {
    const code = "txt('慢', 80, 80, 48);\nwait(800);";
    let sb: Storyboard | null = board([scene({ id: 's', code, hold: 0 })]);
    const host: AgentHost = {
      getStoryboard: () => sb,
      updateStoryboard(next) {
        sb = next;
      },
      async writeFile() {},
      async readFile() {
        return null;
      },
    };
    const mem = await openMemory(host, '', sb);
    const before = solidRaster(8, 8, { r: 0, g: 0, b: 0 });
    const changed = solidRaster(8, 8, { r: 0, g: 0, b: 0 });
    changed.rgba[4] = 255;
    changed.rgba[7] = 255;
    const png = encodePng(before);
    const env: ToolEnv = {
      phase: 'EDIT',
      turn: 1,
      host,
      mem,
      source: '',
      editSceneId: 's',
      editRequest: { scene_id: 's', range_ms: [0, 400], instruction: '慢一点' },
      editDurationMs: 800,
      editTimes: [0, 400],
      outsideTimes: [600],
      beforeFrames: [0, 400, 600].map((tMs) => ({ tMs, caption: '', boxes: 0, png, raster: before })),
      inspect: async () => ({
        issues: [],
        frames: [
          { tMs: 0, caption: '0', boxes: 0, png, raster: before },
          { tMs: 400, caption: '400', boxes: 0, png, raster: before },
          { tMs: 600, caption: '600', boxes: 0, png: encodePng(changed), raster: changed },
        ],
      }),
    };
    const outcome = await executeTool(
      'edit_range',
      JSON.stringify({
        scene_id: 's',
        base_hash: contentHash(code),
        start_line: 2,
        end_line: 2,
        replacement: 'wait(1600);',
      }),
      env,
    );
    expect(outcome.wrote).toBe(true);
    expect(outcome.content).toContain('本场时长 800ms → 1600ms，后面的场会整体后移');
    expect(outcome.content).toContain('区间外 600ms');
    expect(outcome.content).toContain('局部');
    expect(outcome.images?.map((image) => image.caption)).toEqual([
      '改前 0ms',
      '改后 0ms',
      '改前 400ms',
      '改后 400ms',
    ]);
    expect(sb?.scenes[0]?.hold).toBe(0);
    expect(sb?.scenes[0]?.code).toContain('wait(1600)');
  });
});
