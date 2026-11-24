// @vitest-environment happy-dom
import { describe, expect, it } from 'vitest';
import { parseStoryboard, type Scene, type Storyboard } from '../../shared/schema';
import { contentHash } from './hash';
import { openMemory, type AgentHost } from './memory';
import { localInspect, executeTool, type ToolEnv, type ToolOutcome } from './tools/run';
import type { Phase } from './tools/defs';

const meta = {
  title: 't',
  mode: '2d' as const,
  aspect: '16:9' as const,
  background: '#000000',
  stylePreset: '3b1b' as const,
};

const PASS = [
  "const box = el('div', { left: 80, top: 80, width: 200, height: 80, background: C.blue }, 'ok');",
  'fadeIn(box, 0);',
  'wait(1000);',
].join('\n');

function scene(over: Partial<Scene> & Pick<Scene, 'id'>): Scene {
  return {
    title: over.title ?? over.id,
    description: over.description ?? '',
    kind: over.kind ?? 'code',
    enter: over.enter ?? 'fresh',
    hold: over.hold ?? 1,
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

function world(scenes: Scene[] = [], source = '') {
  let sb: Storyboard | null = board(scenes);
  const files = new Map<string, string>();
  const host: AgentHost = {
    getStoryboard: () => sb,
    updateStoryboard(next) {
      sb = next;
    },
    async writeFile(name, text) {
      files.set(name, text);
    },
    async readFile(name) {
      return files.get(name) ?? null;
    },
  };
  return {
    host,
    files,
    get sb() {
      return sb;
    },
    async env(phase: Phase, extra: Partial<ToolEnv> = {}): Promise<ToolEnv> {
      const mem = await openMemory(host, source, sb ?? board([]));
      return { phase, turn: 1, host, mem, source, inspect: localInspect, ...extra };
    },
  };
}

function body(outcome: ToolOutcome): Record<string, unknown> {
  return JSON.parse(outcome.content) as Record<string, unknown>;
}

function errorCode(outcome: ToolOutcome): string {
  const parsed = body(outcome);
  const error = parsed.error as { code?: string } | undefined;
  return error?.code ?? '';
}

describe('read_storyboard', () => {
  it('返回场表和共享哈希', async () => {
    const box = await world([scene({ id: 's_box', code: PASS, hold: 4 })]);
    const outcome = await executeTool('read_storyboard', '{}', await box.env('PLAN'));
    const parsed = body(outcome);
    expect(parsed.ok).toBe(true);
    expect(parsed.scenes).toMatchObject([{ id: 's_box', hold: 4, hash: contentHash(PASS) }]);
  });

  it('SCENE 阶段调用会被拒绝', async () => {
    const box = await world();
    const outcome = await executeTool('read_storyboard', '{}', await box.env('SCENE'));
    expect(errorCode(outcome)).toBe('PHASE');
  });
});

describe('read_source', () => {
  it('缺省只给前 40 字，点名段号才给全文', async () => {
    const source = `${'勾'.repeat(80)}\n\n第二段`;
    const box = await world([], source);
    const catalog = body(await executeTool('read_source', '{}', await box.env('PLAN')));
    const paragraphs = catalog.paragraphs as { n: number; text: string }[];
    expect(paragraphs[0]?.text).toBe(`${'勾'.repeat(40)}…`);
    expect(JSON.stringify(catalog)).not.toContain('勾'.repeat(80));
    const full = body(await executeTool('read_source', '{"paragraphs":[2]}', await box.env('PLAN')));
    expect(full.paragraphs).toEqual([{ n: 2, text: '第二段' }]);
  });

  it('段号不合法或找不到就报错', async () => {
    const box = await world([], '只有一段');
    expect(errorCode(await executeTool('read_source', '{"paragraphs":[0]}', await box.env('PLAN')))).toBe(
      'INVALID_ARGS',
    );
    expect(errorCode(await executeTool('read_source', '{"paragraphs":[3]}', await box.env('PLAN')))).toBe(
      'NOT_FOUND',
    );
  });
});

describe('write_plan', () => {
  it('新场代码为空，已有场的 hold 和手改代码留着，锁定场不能删', async () => {
    const locked = scene({ id: 's_lock', code: 'const user = 1;', hold: 4, locked: true, title: '原来的' });
    const edited = scene({ id: 's_hand', code: 'const hand = 1;', hold: 3, title: '旧标题' });
    const box = await world([locked, edited]);
    const outcome = await executeTool(
      'write_plan',
      JSON.stringify({
        title: '新标题',
        plan_md: '# 计划',
        scenes: [
          { id: 's_hand', title: '新名', description: '改名', hold: 1, enter: 'keep' },
          { id: 's_new', title: '新场', description: '空的', hold: 2, enter: 'fresh' },
        ],
      }),
      await box.env('PLAN'),
    );
    expect(body(outcome)).toMatchObject({ ok: true, created: ['s_new'], kept_locked: ['s_lock'] });
    const scenes = box.sb?.scenes ?? [];
    expect(scenes.find((item) => item.id === 's_lock')).toMatchObject({
      code: 'const user = 1;',
      hold: 4,
      title: '原来的',
    });
    expect(scenes.find((item) => item.id === 's_hand')).toMatchObject({
      code: 'const hand = 1;',
      hold: 3,
      title: '新名',
    });
    expect(scenes.find((item) => item.id === 's_new')?.code).toBe('');
    expect(box.files.get('plan.md')).toContain('# 计划');
  });

  it('没有场就拒绝', async () => {
    const box = await world();
    const outcome = await executeTool(
      'write_plan',
      JSON.stringify({ title: '空', plan_md: '# 空', scenes: [] }),
      await box.env('PLAN'),
    );
    expect(errorCode(outcome)).toBe('INVALID_ARGS');
    expect(box.sb?.scenes).toEqual([]);
  });
});

describe('read_scene', () => {
  it('返回带行号的代码和哈希', async () => {
    const box = await world([scene({ id: 's_box', code: PASS })]);
    const outcome = await executeTool('read_scene', '{"scene_id":"s_box"}', await box.env('SCENE'));
    const parsed = body(outcome);
    expect(parsed.ok).toBe(true);
    expect(parsed.hash).toBe(contentHash(PASS));
    expect(String(parsed.code_numbered)).toContain('1|');
    expect(String(parsed.code_numbered)).toContain('fadeIn');
    const index = parsed.index as { line: number; start_ms: number | null; n?: number }[];
    expect(index.find((item) => item.n === 1)?.line).toBe(1);
    expect(index.find((item) => item.line === 2)?.start_ms).toBe(0);
  });

  it('没有这场', async () => {
    const box = await world();
    expect(
      errorCode(await executeTool('read_scene', '{"scene_id":"s_missing"}', await box.env('SCENE'))),
    ).toBe('NOT_FOUND');
  });
});

describe('write_scene', () => {
  it('空场不用 base_hash，写入后 hold 不变，哈希对得上', async () => {
    const box = await world([scene({ id: 's_box', code: '', hold: 4 })]);
    const env = await box.env('SCENE');
    const outcome = await executeTool(
      'write_scene',
      JSON.stringify({ scene_id: 's_box', code: PASS, summary: '蓝色方块' }),
      env,
    );
    const parsed = body(outcome);
    expect(parsed.ok).toBe(true);
    expect(parsed.gate).toBe('pass');
    const code = box.sb?.scenes[0]?.code ?? '';
    expect(code).toContain('wait(1000)');
    expect(parsed.hash).toBe(contentHash(code));
    expect(box.sb?.scenes[0]?.hold).toBe(4);
    expect(env.mem.scenes.s_box?.summary).toBe('蓝色方块');
  });

  it('锁定场不写，过期哈希不写，loop:true 不写', async () => {
    const locked = scene({ id: 's_lock', code: 'const user = 1;', hold: 4, locked: true });
    const live = scene({ id: 's_box', code: PASS, hold: 2 });
    const box = await world([locked, live]);
    const env = await box.env('SCENE');
    const lockedOut = await executeTool(
      'write_scene',
      JSON.stringify({ scene_id: 's_lock', code: PASS, base_hash: contentHash('const user = 1;') }),
      env,
    );
    expect(errorCode(lockedOut)).toBe('LOCKED');
    expect(box.sb?.scenes.find((item) => item.id === 's_lock')?.code).toBe('const user = 1;');

    const stale = await executeTool(
      'write_scene',
      JSON.stringify({ scene_id: 's_box', code: PASS, base_hash: 'deadbeef' }),
      env,
    );
    expect(errorCode(stale)).toBe('STALE');
    expect(box.sb?.scenes.find((item) => item.id === 's_box')?.code).toBe(PASS);

    box.sb!.scenes.find((item) => item.id === 's_box')!.code = 'const hand = 1;\nwait(500);\n';
    const hand = await executeTool(
      'write_scene',
      JSON.stringify({ scene_id: 's_box', code: PASS, base_hash: contentHash(PASS) }),
      env,
    );
    expect(errorCode(hand)).toBe('STALE');
    expect(box.sb?.scenes.find((item) => item.id === 's_box')?.code).toContain('const hand = 1;');
    expect(box.sb?.scenes.find((item) => item.id === 's_box')?.hold).toBe(2);

    const looped = await executeTool(
      'write_scene',
      JSON.stringify({
        scene_id: 's_box',
        code: "const box = el('div');\ntw(box, { x: [0, 40], duration: 800, loop: true }, 0);\nwait(500);",
        base_hash: contentHash(box.sb?.scenes.find((item) => item.id === 's_box')?.code ?? ''),
      }),
      env,
    );
    expect(errorCode(looped)).toBe('BANNED_API');
    expect(box.sb?.scenes.find((item) => item.id === 's_box')?.code).toContain('const hand = 1;');
  });
});

describe('edit_range', () => {
  it('按行号替换，不能改共享块', async () => {
    const box = await world([scene({ id: 's_box', code: '' })]);
    const env = await box.env('SCENE');
    await executeTool('write_scene', JSON.stringify({ scene_id: 's_box', code: PASS }), env);
    const hash = contentHash(box.sb?.scenes[0]?.code ?? '');
    const outcome = await executeTool(
      'edit_range',
      JSON.stringify({
        scene_id: 's_box',
        base_hash: hash,
        start_line: 3,
        end_line: 3,
        replacement: 'wait(800);',
      }),
      env,
    );
    expect(body(outcome).ok).toBe(true);
    expect(box.sb?.scenes[0]?.code).toContain('wait(800)');
    expect(box.sb?.scenes[0]?.hold).toBe(1);

    const shared = `/* @awb-shared */\nconst MARK = 1;\n/* @awb-shared-end */\n${PASS}`;
    box.sb!.scenes[0]!.code = shared;
    const blocked = await executeTool(
      'edit_range',
      JSON.stringify({
        scene_id: 's_box',
        base_hash: contentHash(shared),
        start_line: 1,
        end_line: 1,
        replacement: 'const MARK = 2;',
      }),
      env,
    );
    expect(errorCode(blocked)).toBe('INVALID_ARGS');
    expect(box.sb?.scenes[0]?.code).toContain('const MARK = 1;');
  });

  it('行号超出或哈希过期', async () => {
    const box = await world([scene({ id: 's_box', code: PASS })]);
    const env = await box.env('SCENE');
    const badLine = await executeTool(
      'edit_range',
      JSON.stringify({
        scene_id: 's_box',
        base_hash: contentHash(PASS),
        start_line: 40,
        end_line: 41,
        replacement: 'wait(1);',
      }),
      env,
    );
    expect(errorCode(badLine)).toBe('INVALID_ARGS');
    const stale = await executeTool(
      'edit_range',
      JSON.stringify({
        scene_id: 's_box',
        base_hash: 'nope',
        start_line: 1,
        end_line: 1,
        replacement: 'wait(1);',
      }),
      env,
    );
    expect(errorCode(stale)).toBe('STALE');
    expect(box.sb?.scenes[0]?.code).toBe(PASS);
  });
});

describe('write_shared', () => {
  it('写进未锁定场，锁定场不动；编译失败整次回滚', async () => {
    const locked = scene({ id: 's_lock', code: PASS, locked: true });
    const live = scene({ id: 's_box', code: `${PASS}\nconst shown = MARK;` });
    const box = await world([locked, live]);
    const env = await box.env('SCENE');
    const first = await executeTool(
      'write_shared',
      JSON.stringify({ code: 'const MARK = 1;', base_hash: contentHash('') }),
      env,
    );
    expect(body(first).ok).toBe(true);
    expect(box.sb?.scenes.find((item) => item.id === 's_box')?.code).toContain('const MARK = 1;');
    expect(box.sb?.scenes.find((item) => item.id === 's_lock')?.code).toBe(PASS);
    const before = box.sb?.scenes.find((item) => item.id === 's_box')?.code ?? '';
    const broken = await executeTool(
      'write_shared',
      JSON.stringify({ code: 'const MARK = ;', base_hash: contentHash('const MARK = 1;') }),
      env,
    );
    expect(body(broken).ok).toBe(false);
    expect(box.sb?.scenes.find((item) => item.id === 's_box')?.code).toBe(before);
    expect(box.files.get('shared.js')).toBe('const MARK = 1;');
  });

  it('base_hash 不对就不写', async () => {
    const box = await world([scene({ id: 's_box', code: PASS })]);
    const outcome = await executeTool(
      'write_shared',
      JSON.stringify({ code: 'const MARK = 1;', base_hash: 'deadbeef' }),
      await box.env('SCENE'),
    );
    expect(errorCode(outcome)).toBe('STALE');
    expect(box.sb?.scenes[0]?.code).toBe(PASS);
  });
});

describe('capture_frames', () => {
  it('把帧交给图像消息，没有这场就拒绝', async () => {
    const png = Uint8Array.from([137, 80, 78, 71]);
    const box = await world([scene({ id: 's_box', code: PASS })]);
    const env = await box.env('FILM', {
      inspect: async () => ({
        issues: [],
        frames: [{ tMs: 250, caption: 's_box 250ms', png, boxes: 1 }],
      }),
    });
    const outcome = await executeTool('capture_frames', '{"scene_id":"s_box","times_ms":[250]}', env);
    expect(body(outcome).ok).toBe(true);
    expect(outcome.images).toHaveLength(1);
    expect(outcome.images?.[0]?.caption).toBe('s_box 250ms');
    expect(errorCode(await executeTool('capture_frames', '{"scene_id":"s_missing"}', env))).toBe('NOT_FOUND');
  });
});

describe('check', () => {
  it('汇总严重度，点名不存在的场就拒绝', async () => {
    const box = await world([scene({ id: 's_box', code: PASS })]);
    const env = await box.env('FILM');
    const outcome = await executeTool('check', '{"film":true}', env);
    expect(body(outcome)).toMatchObject({ ok: true, summary: { blocker: 0, major: 0, minor: 0 } });
    expect(errorCode(await executeTool('check', '{"scene_ids":["s_missing"]}', env))).toBe('NOT_FOUND');
  });

  it('PLAN 阶段不能体检', async () => {
    const box = await world();
    expect(errorCode(await executeTool('check', '{}', await box.env('PLAN')))).toBe('PHASE');
  });
});

describe('update_issues', () => {
  it('能加能关内容问题，不能关机器问题，也不能豁免同毫秒 seek', async () => {
    const box = await world([scene({ id: 's_box', code: PASS })]);
    const env = await box.env('SCENE');
    env.mem.issues.push({
      id: 'S1',
      scene_id: 's_box',
      kind: 'SEEK_SAME_MS',
      severity: 'blocker',
      evidence: { text: '同毫秒' },
      fingerprint: 'SEEK_SAME_MS|s_box|同毫秒|',
      first_turn: 1,
      last_turn: 1,
      attempts: 1,
      status: 'open',
    });
    const added = await executeTool(
      'update_issues',
      JSON.stringify({ add: [{ scene_id: 's_box', text: '字幕太长', severity: 'major' }] }),
      env,
    );
    expect(body(added).ok).toBe(true);
    const content = env.mem.issues.find((issue) => issue.kind === 'CONTENT');
    expect(content?.status).toBe('open');
    const closed = await executeTool('update_issues', JSON.stringify({ close: [content?.id] }), env);
    expect(body(closed).ok).toBe(true);
    expect(env.mem.issues.find((issue) => issue.id === content?.id)?.status).toBe('fixed');
    const machine = await executeTool('update_issues', JSON.stringify({ close: ['S1'] }), env);
    expect(errorCode(machine)).toBe('INVALID_ARGS');
    expect(env.mem.issues.find((issue) => issue.id === 'S1')?.status).toBe('open');
    const waived = await executeTool(
      'update_issues',
      JSON.stringify({ waive: [{ id: 'S1', reason: '算了' }] }),
      env,
    );
    expect(errorCode(waived)).toBe('INVALID_ARGS');
    expect(env.mem.issues.find((issue) => issue.id === 'S1')?.status).toBe('open');
  });
});

describe('finish', () => {
  it('代码能过运行门且没有 blocker 才算完成', async () => {
    const box = await world([scene({ id: 's_box', code: PASS })]);
    const env = await box.env('FILM');
    env.mem.scenes.s_box!.gateOk = true;
    const outcome = await executeTool('finish', JSON.stringify({ summary: '一场完成' }), env);
    expect(outcome.terminal).toBe('done');
  });

  it('空代码或 loop:true 不能结束', async () => {
    const empty = await world([scene({ id: 's_box', code: '' })]);
    const denied = await executeTool(
      'finish',
      JSON.stringify({ summary: '还没写' }),
      await empty.env('FILM'),
    );
    expect(errorCode(denied)).toBe('FINISH_REJECTED');
    expect(denied.terminal).toBeUndefined();

    const looped = await world([
      scene({
        id: 's_box',
        code: "const box = el('div');\ntw(box, { x: [0, 40], duration: 800, loop: true }, 0);\nwait(500);",
      }),
    ]);
    expect(
      errorCode(await executeTool('finish', JSON.stringify({ summary: '想停' }), await looped.env('FILM'))),
    ).toBe('FINISH_REJECTED');
  });
});

describe('阶段和写入上限', () => {
  it('EDIT 改别的场是 OUT_OF_SCOPE', async () => {
    const box = await world([scene({ id: 's_box', code: PASS }), scene({ id: 's_other', code: '' })]);
    const env = await box.env('EDIT', { editSceneId: 's_box' });
    expect(
      errorCode(await executeTool('write_scene', JSON.stringify({ scene_id: 's_other', code: PASS }), env)),
    ).toBe('OUT_OF_SCOPE');
  });

  it('同一场第 9 次写入被拒绝，问题连续三次不变就标 stuck', async () => {
    const box = await world([scene({ id: 's_box', code: '' })]);
    const issue = {
      id: 'L1',
      scene_id: 's_box',
      kind: 'LAYOUT_OVERLAP' as const,
      severity: 'major' as const,
      evidence: { text: '叠' },
      fingerprint: 'LAYOUT_OVERLAP|s_box|叠|',
      first_turn: 1,
      last_turn: 1,
      attempts: 1,
      status: 'open' as const,
    };
    const env = await box.env('SCENE', { inspect: async () => ({ issues: [{ ...issue }], frames: [] }) });
    let hash = '';
    for (let i = 0; i < 8; i++) {
      const outcome = await executeTool(
        'write_scene',
        JSON.stringify({ scene_id: 's_box', code: PASS, ...(hash ? { base_hash: hash } : {}) }),
        env,
      );
      expect(body(outcome).ok).toBe(true);
      hash = String(body(outcome).hash);
    }
    expect(env.mem.scenes.s_box?.status).toBe('stuck');
    const ninth = await executeTool(
      'write_scene',
      JSON.stringify({ scene_id: 's_box', code: PASS, base_hash: hash }),
      env,
    );
    expect(errorCode(ninth)).toBe('INVALID_ARGS');
    expect(String((body(ninth).error as { message: string }).message)).toContain('8');
  });
});
