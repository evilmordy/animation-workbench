import type { ToolDef } from '../../../platform/types';

export const TOOL_NAMES = [
  'read_storyboard',
  'read_source',
  'write_plan',
  'read_scene',
  'write_scene',
  'edit_range',
  'write_shared',
  'capture_frames',
  'check',
  'update_issues',
  'finish',
] as const;

export type ToolName = (typeof TOOL_NAMES)[number];
export type Phase = 'PLAN' | 'SCENE' | 'FILM' | 'EDIT';

const SCENE_TOOLS = [
  'read_scene',
  'write_scene',
  'edit_range',
  'write_shared',
  'capture_frames',
  'check',
  'update_issues',
] as const satisfies readonly ToolName[];

/** 设计书 §5.1。每轮请求只带这一阶段的定义。 */
export const PHASE_TOOLS: Record<Phase, readonly ToolName[]> = {
  PLAN: ['read_storyboard', 'read_source', 'write_plan'],
  SCENE: SCENE_TOOLS,
  FILM: [...SCENE_TOOLS, 'finish'],
  EDIT: ['read_scene', 'edit_range', 'write_scene', 'capture_frames', 'check', 'finish'],
};

const SCENE_ID = { type: 'string', pattern: '^[A-Za-z_][A-Za-z0-9_-]{0,63}$' };

function parameters(properties: Record<string, unknown>, required?: string[]): Record<string, unknown> {
  return {
    type: 'object',
    properties,
    additionalProperties: false,
    ...(required?.length ? { required } : {}),
  };
}

function def(name: ToolName, description: string, schema: Record<string, unknown>): ToolDef {
  return { type: 'function', function: { name, description, parameters: schema } };
}

const ALL: ToolDef[] = [
  def('read_storyboard', '看全片目录：场次、锁定、哈希、一句话摘要。', parameters({})),
  def(
    'read_source',
    '读素材。不传 paragraphs 时只给每段前 40 字；传入段号则给全文，最多 20 段。',
    parameters({
      paragraphs: { type: 'array', items: { type: 'integer', minimum: 1 }, maxItems: 20 },
    }),
  ),
  def(
    'write_plan',
    '定计划并分场。锁定场原样保留，不能删、不能改 id。新场代码为空。',
    parameters(
      {
        title: { type: 'string', maxLength: 80 },
        plan_md: { type: 'string', maxLength: 8000 },
        scenes: {
          type: 'array',
          minItems: 1,
          maxItems: 20,
          items: {
            type: 'object',
            required: ['id', 'title', 'description', 'hold', 'enter'],
            additionalProperties: false,
            properties: {
              id: SCENE_ID,
              title: { type: 'string', maxLength: 80 },
              description: { type: 'string', maxLength: 400 },
              hold: { type: 'number', minimum: 0, maximum: 30 },
              enter: { enum: ['fresh', 'keep'] },
              source_paragraphs: { type: 'array', items: { type: 'integer', minimum: 1 } },
            },
          },
        },
        shared_js: { type: 'string', maxLength: 4000 },
      },
      ['title', 'plan_md', 'scenes'],
    ),
  ),
  def(
    'read_scene',
    '读一场带行号的代码和哈希。共享常量块折叠成一行。改之前先读，STALE 之后也要重读。',
    parameters({ scene_id: { type: 'string' }, with_index: { type: 'boolean', default: true } }, [
      'scene_id',
    ]),
  ),
  def(
    'write_scene',
    '整场重写。已有代码必须带 base_hash。运行门不过则不写入。写入后系统自动体检。',
    parameters(
      {
        scene_id: { type: 'string' },
        code: { type: 'string', maxLength: 40000 },
        base_hash: { type: 'string' },
        summary: { type: 'string', maxLength: 200 },
      },
      ['scene_id', 'code'],
    ),
  ),
  def(
    'edit_range',
    '按 code_numbered 的行号替换。不能改共享常量块。',
    parameters(
      {
        scene_id: { type: 'string' },
        base_hash: { type: 'string' },
        start_line: { type: 'integer', minimum: 1 },
        end_line: { type: 'integer', minimum: 1 },
        replacement: { type: 'string', maxLength: 20000 },
      },
      ['scene_id', 'base_hash', 'start_line', 'end_line', 'replacement'],
    ),
  ),
  def(
    'write_shared',
    '改跨场常量。任一未锁定场因此编译失败则整次回滚。',
    parameters({ code: { type: 'string', maxLength: 4000 }, base_hash: { type: 'string' } }, [
      'code',
      'base_hash',
    ]),
  ),
  def(
    'check',
    '手动体检。film 为 true 时包括换场残留和整片 seek。',
    parameters({
      scene_ids: { type: 'array', items: { type: 'string' } },
      film: { type: 'boolean', default: false },
    }),
  ),
  def(
    'capture_frames',
    '看指定时刻。不传时刻时是本场 25%、60% 和收束。图像在下一条消息里。',
    parameters(
      {
        scene_id: { type: 'string' },
        times_ms: { type: 'array', items: { type: 'number', minimum: 0 }, maxItems: 8 },
        range: {
          type: 'object',
          required: ['from_ms', 'to_ms'],
          additionalProperties: false,
          properties: {
            from_ms: { type: 'number' },
            to_ms: { type: 'number' },
            count: { type: 'integer', minimum: 2, maximum: 8, default: 4 },
          },
        },
        isolated: { type: 'boolean', default: false },
      },
      ['scene_id'],
    ),
  ),
  def(
    'update_issues',
    '补充内容类问题，或对可豁免的机器问题写明理由。编译、运行、时长、黑屏 blocker、后向 seek、同毫秒 seek 不能豁免。',
    parameters({
      add: {
        type: 'array',
        items: {
          type: 'object',
          required: ['scene_id', 'text'],
          additionalProperties: false,
          properties: {
            scene_id: { type: 'string' },
            text: { type: 'string', maxLength: 300 },
            severity: { enum: ['major', 'minor'] },
            t_ms: { type: 'number' },
          },
        },
      },
      waive: {
        type: 'array',
        items: {
          type: 'object',
          required: ['id', 'reason'],
          additionalProperties: false,
          properties: { id: { type: 'string' }, reason: { type: 'string', maxLength: 200 } },
        },
      },
      close: { type: 'array', items: { type: 'string' } },
    }),
  ),
  def(
    'finish',
    '申请结束。还有 blocker、空代码或硬门槛没过时会被拒绝。',
    parameters(
      {
        summary: { type: 'string', maxLength: 1000 },
        known_issues: { type: 'array', items: { type: 'string' } },
      },
      ['summary'],
    ),
  ),
];

export function toolDefs(phase: Phase): ToolDef[] {
  const byName = new Map(ALL.map((tool) => [tool.function.name, tool]));
  return PHASE_TOOLS[phase].flatMap((name) => {
    const tool = byName.get(name);
    return tool ? [tool] : [];
  });
}

export function isToolName(name: string): name is ToolName {
  return (TOOL_NAMES as readonly string[]).includes(name);
}
